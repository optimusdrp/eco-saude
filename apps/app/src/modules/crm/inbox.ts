import "server-only";
import { FIRST_RESPONSE_TARGET_MIN, findFreeSlots, formatWhen, type Channel } from "@ecosaude/core/crm";
import { loadWorkSchedule } from "./hours";
import { containsText } from "./search";
import { and, asc, desc, eq, gt, inArray, inSequence, isNotNull, isNull, lt, ne, or, schema, sql, type SQL, type Tx } from "@ecosaude/db";
import { roomFilterFor } from "./units";

/**
 * Consultas da mesa de atendimento.
 */

export const INBOX_FILTERS = {
  esperando: "Esperando",
  abertas: "Abertas",
  minhas: "Minhas",
  sem_dono: "Sem responsável",
  adiadas: "Adiadas",
  resolvidas: "Resolvidas",
} as const;
export type InboxFilter = keyof typeof INBOX_FILTERS;

/** Ordem da lista: quem espera há mais tempo primeiro, ou as mais recentes */
export const INBOX_SORTS = { espera: "Maior espera", recentes: "Mais recentes" } as const;
export type InboxSort = keyof typeof INBOX_SORTS;

/** Conversas por "página" da lista (o botão "Carregar mais" soma outra página) */
export const INBOX_PAGE = 60;

export async function listConversations(tx: Tx, opts: { filter: InboxFilter; channel?: Channel; userId: string; q?: string; limit?: number; sort?: InboxSort }) {
  const now = new Date();
  const notSnoozed = or(isNull(schema.conversations.snoozedUntil), lt(schema.conversations.snoozedUntil, now))!;
  const conditions: SQL[] = [];
  if (opts.filter === "esperando") conditions.push(eq(schema.conversations.status, "aberta"), isNotNull(schema.conversations.awaitingReplySince), notSnoozed);
  if (opts.filter === "abertas") conditions.push(ne(schema.conversations.status, "resolvida"));
  if (opts.filter === "minhas") conditions.push(eq(schema.conversations.assigneeId, opts.userId), ne(schema.conversations.status, "resolvida"));
  if (opts.filter === "sem_dono") conditions.push(isNull(schema.conversations.assigneeId), ne(schema.conversations.status, "resolvida"));
  if (opts.filter === "adiadas") conditions.push(gt(schema.conversations.snoozedUntil, now), ne(schema.conversations.status, "resolvida"));
  if (opts.filter === "resolvidas") conditions.push(eq(schema.conversations.status, "resolvida"));
  if (opts.channel) conditions.push(eq(schema.conversations.channel, opts.channel));
  // Busca por nome (sem acento) ou telefone do paciente
  if (opts.q) {
    const digits = opts.q.replace(/\D/g, "");
    conditions.push(
      sql`exists (select 1 from contacts ct where ct.id = ${schema.conversations.contactId} and (${containsText(sql`ct.name`, opts.q)}${
        digits.length >= 4 ? sql` or ct.phone like ${`%${digits}%`}` : sql``
      }))`,
    );
  }
  const limit = opts.limit ?? INBOX_PAGE;

  // Busca uma a mais para saber se há "mais" para carregar
  const rows = await tx.query.conversations.findMany({
    where: and(...conditions, isNotNull(schema.conversations.lastMessageAt)),
    with: { contact: { columns: { id: true, name: true, stage: true } }, assignee: { columns: { id: true, name: true } } },
    // Urgências sempre primeiro; depois quem está irritado/ameaçando (Ajustes > IA > Sentimento). Depois: quem espera há mais tempo (esperando
    // resposta antes das demais) ou as mais recentes, conforme a ordem escolhida.
    orderBy: (c) =>
      (opts.sort ?? defaultSort(opts.filter)) === "espera"
        ? [desc(c.urgent), desc(c.sentimentPriority), sql`${c.awaitingReplySince} asc nulls last`, sql`${c.lastMessageAt} desc nulls last`]
        : [desc(c.urgent), desc(c.sentimentPriority), sql`${c.lastMessageAt} desc nulls last`],
    limit: limit + 1,
  });
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** Ordem padrão de cada filtro */
export function defaultSort(filter: InboxFilter): InboxSort {
  return filter === "esperando" || filter === "sem_dono" ? "espera" : "recentes";
}

/**
 * Contagem por filtro (números nas abas) + medidor da meta de 1ª resposta:
 * quantos esperam há mais de FIRST_RESPONSE_TARGET_MIN e desde quando espera o mais antigo.
 */
export async function inboxCounts(tx: Tx, userId: string) {
  const now = new Date();
  const late = new Date(now.getTime() - FIRST_RESPONSE_TARGET_MIN * 60_000);
  const waiting = sql`${schema.conversations.status} = 'aberta' and ${schema.conversations.awaitingReplySince} is not null and (${schema.conversations.snoozedUntil} is null or ${schema.conversations.snoozedUntil} < ${now})`;
  const [row] = await tx
    .select({
      atrasadas: sql<number>`count(*) filter (where ${waiting} and ${schema.conversations.awaitingReplySince} < ${late})::int`,
      maisAntiga: sql<Date | null>`min(${schema.conversations.awaitingReplySince}) filter (where ${waiting})`,
      naoLidas: sql<number>`coalesce(sum(${schema.conversations.unreadCount}) filter (where ${schema.conversations.status} <> 'resolvida'), 0)::int`,
      sem_dono: sql<number>`count(*) filter (where ${schema.conversations.assigneeId} is null and ${schema.conversations.status} <> 'resolvida')::int`,
      adiadas: sql<number>`count(*) filter (where ${schema.conversations.snoozedUntil} > ${now} and ${schema.conversations.status} <> 'resolvida')::int`,
      esperando: sql<number>`count(*) filter (where ${schema.conversations.status} = 'aberta' and ${schema.conversations.awaitingReplySince} is not null and (${schema.conversations.snoozedUntil} is null or ${schema.conversations.snoozedUntil} < ${now}))::int`,
      abertas: sql<number>`count(*) filter (where ${schema.conversations.status} <> 'resolvida')::int`,
      minhas: sql<number>`count(*) filter (where ${schema.conversations.assigneeId} = ${userId} and ${schema.conversations.status} <> 'resolvida')::int`,
    })
    .from(schema.conversations)
    .where(isNotNull(schema.conversations.lastMessageAt));
  const r = row ?? { esperando: 0, abertas: 0, minhas: 0, sem_dono: 0, adiadas: 0, atrasadas: 0, maisAntiga: null, naoLidas: 0 };
  // O driver devolve a data do "min" como texto: converte
  return { ...r, maisAntiga: r.maisAntiga ? new Date(r.maisAntiga) : null };
}

/** Conversa com mensagens, contato, próxima consulta e horários livres sugeridos. */
export async function loadThread(tx: Tx, id: string) {
  const conversation = await tx.query.conversations.findFirst({
    where: eq(schema.conversations.id, id),
    with: { contact: true, assignee: { columns: { id: true, name: true } } },
  });
  if (!conversation) return null;

  const [messages, next, otherChannels] = await inSequence([
    () => tx.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      with: { author: { columns: { name: true } } },
      orderBy: desc(schema.messages.createdAt),
      limit: 120,
    }),
    () => tx.query.appointments.findFirst({
      where: and(eq(schema.appointments.contactId, conversation.contactId), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])),
      with: { professional: { columns: { id: true, name: true } } },
      orderBy: asc(schema.appointments.startsAt),
    }),
    () => tx
      .select({ id: schema.conversations.id, channel: schema.conversations.channel })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.contactId, conversation.contactId), ne(schema.conversations.id, id)))]);

  // Profissional para sugerir horários: o da próxima consulta, ou o da última, ou o primeiro ativo
  let professionalId = next?.professional.id;
  if (!professionalId) {
    const [last] = await tx
      .select({ id: schema.appointments.professionalId })
      .from(schema.appointments)
      .where(eq(schema.appointments.contactId, conversation.contactId))
      .orderBy(desc(schema.appointments.startsAt))
      .limit(1);
    professionalId = last?.id;
  }
  const pro = professionalId
    ? await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, professionalId) })
    : await tx.query.professionals.findFirst({ where: eq(schema.professionals.active, true), orderBy: asc(schema.professionals.name) });

  let slots: string[] = [];
  if (pro) {
    const now = new Date();
    const busy = await tx
      .select({ startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.professionalId, pro.id), ne(schema.appointments.status, "cancelado"), gt(schema.appointments.endsAt, now)));
    // Só horários com consultório livre (a busca padrão olha 14 dias)
    const rooms = await roomFilterFor(tx, pro, now, new Date(now.getTime() + 15 * 86_400_000));
    slots = findFreeSlots({
      schedule: await loadWorkSchedule(tx, pro),
      busy,
      from: now,
      limit: 3,
      accept: rooms.accept,
    }).map((s) => formatWhen(s.startsAt, now));
  }

  return {
    conversation,
    messages: messages.reverse(),
    next,
    otherChannels,
    suggestionPro: pro ? { id: pro.id, name: pro.name } : null,
    slots,
  };
}

export async function quickReplies(tx: Tx) {
  return tx.select().from(schema.quickReplies).orderBy(asc(schema.quickReplies.shortcut));
}

/**
 * Contexto do paciente para o painel lateral da conversa:
 * histórico recente (linha do tempo) e números de consultas.
 */
export async function threadContext(tx: Tx, contactId: string) {
  const [events, stats] = await inSequence([
    () =>
      tx
        .select({ id: schema.crmEvents.id, type: schema.crmEvents.type, data: schema.crmEvents.data, createdAt: schema.crmEvents.createdAt })
        .from(schema.crmEvents)
        .where(eq(schema.crmEvents.contactId, contactId))
        .orderBy(desc(schema.crmEvents.createdAt))
        .limit(10),
    () =>
      tx
        .select({
          compareceu: sql<number>`count(*) filter (where ${schema.appointments.status} = 'compareceu')::int`,
          faltou: sql<number>`count(*) filter (where ${schema.appointments.status} = 'faltou')::int`,
          cancelado: sql<number>`count(*) filter (where ${schema.appointments.status} = 'cancelado')::int`,
        })
        .from(schema.appointments)
        .where(eq(schema.appointments.contactId, contactId)),
  ]);
  return { events, stats: stats[0] ?? { compareceu: 0, faltou: 0, cancelado: 0 } };
}
