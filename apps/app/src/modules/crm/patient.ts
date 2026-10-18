import "server-only";
import { APPOINTMENT_STATUS_LABEL, formatWhen, utcToZoned, type Channel, type NoShowRisk } from "@ecosaude/core/crm";
import { and, asc, desc, eq, inArray, inSequence, isNull, schema, type Tx } from "@ecosaude/db";
import type { TimelineItem } from "@/components/crm/patients/PatientTools";
import { describeEvent } from "./format";
import { riskFor } from "./risk";

/**
 * FICHA 360 DO PACIENTE: junta, numa leitura só, tudo o que a recepção
 * precisa saber antes de responder ou ligar.
 */

export async function loadPatient360(tx: Tx, id: string, now: Date, opts: { risk: boolean }) {
  const contact = await tx.query.contacts.findFirst({
    where: eq(schema.contacts.id, id),
    with: { identities: true, owner: { columns: { name: true } } },
  });
  if (!contact) return null;

  const [conversations, appts, tasks, events, nps, waitlist] = await inSequence([
    () => tx.query.conversations.findMany({ where: eq(schema.conversations.contactId, id), orderBy: desc(schema.conversations.lastMessageAt) }),
    () =>
      tx.query.appointments.findMany({
        where: eq(schema.appointments.contactId, id),
        with: { professional: { columns: { name: true } } },
        orderBy: desc(schema.appointments.startsAt),
      }),
    () =>
      tx
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.contactId, id), isNull(schema.tasks.doneAt)))
        .orderBy(asc(schema.tasks.dueDate)),
    () =>
      tx.query.crmEvents.findMany({
        where: eq(schema.crmEvents.contactId, id),
        with: { actor: { columns: { name: true } } },
        orderBy: desc(schema.crmEvents.createdAt),
        limit: 200,
      }),
    () => tx.select().from(schema.npsResponses).where(eq(schema.npsResponses.contactId, id)).orderBy(desc(schema.npsResponses.createdAt)).limit(1),
    () =>
      tx.query.waitlistEntries.findFirst({
        where: and(eq(schema.waitlistEntries.contactId, id), inArray(schema.waitlistEntries.status, ["aguardando", "oferecido"])),
        with: { professional: { columns: { name: true } } },
      }),
  ]);

  const convIds = conversations.map((c) => c.id);
  const messages = convIds.length
    ? await tx.query.messages.findMany({
        where: inArray(schema.messages.conversationId, convIds),
        with: { author: { columns: { name: true } } },
        orderBy: desc(schema.messages.createdAt),
        limit: 200,
      })
    : [];

  const upcoming = appts.filter((a) => a.startsAt > now && (a.status === "agendado" || a.status === "confirmado")).reverse();
  const risks = opts.risk && upcoming.length ? await riskFor(tx, upcoming, now) : new Map<string, NoShowRisk>();

  /* ---------------------------- Linha do tempo ---------------------------- */
  const timeline: TimelineItem[] = [];
  const fmt = (d: Date) => formatWhen(d, now);
  for (const m of messages) {
    timeline.push({
      id: `m-${m.id}`,
      kind: m.direction === "in" ? "in" : m.direction === "out" ? (m.authorId ? "out" : "system") : m.direction === "note" ? "note" : "system",
      at: m.createdAt.toISOString(),
      when: fmt(m.createdAt),
      text: m.body,
      sub: m.direction === "out" && m.status === "falhou" ? "Falhou no envio" : undefined,
      channel: m.channel,
      author: m.direction === "in" ? contact.name : (m.author?.name ?? null),
      conversationId: m.conversationId,
    });
  }
  for (const a of appts) {
    if (a.startsAt > now && a.status !== "cancelado") continue; // futuras aparecem no painel "Próximas"
    timeline.push({
      id: `a-${a.id}`,
      kind: "appointment",
      at: a.startsAt.toISOString(),
      when: fmt(a.startsAt),
      text: `${a.service ?? "Consulta"} com ${a.professional.name}: ${APPOINTMENT_STATUS_LABEL[a.status].toLowerCase()}`,
      sub: a.cancelReason
        ? `Motivo: ${a.cancelReason}`
        : a.status === "agendado" || a.status === "confirmado"
          ? "Já passou e ainda não tem desfecho: marque na agenda se compareceu ou faltou."
          : undefined,
    });
  }
  for (const e of events) {
    timeline.push({
      id: `e-${e.id}`,
      kind: e.type === "note" ? "note" : "event",
      at: e.createdAt.toISOString(),
      when: fmt(e.createdAt),
      text: describeEvent(e.type, e.data, now),
      author: e.actor?.name ?? null,
    });
  }
  timeline.sort((x, y) => (x.at < y.at ? 1 : -1));

  /* ------------------------------ Indicadores ----------------------------- */
  const attended = appts.filter((a) => a.status === "compareceu").length;
  const noShows = appts.filter((a) => a.status === "faltou").length;
  const cancelled = appts.filter((a) => a.status === "cancelado").length;

  return {
    contact,
    conversations,
    upcoming: upcoming.map((a) => ({ ...a, risk: risks.get(a.id) ?? null })),
    tasks,
    timeline,
    lastNps: nps[0] ?? null,
    waitlist,
    stats: {
      attended,
      noShows,
      cancelled,
      attendanceRate: attended + noShows > 0 ? Math.round((attended / (attended + noShows)) * 100) : null,
    },
    bestTime: bestContactWindow(messages.filter((m) => m.direction === "in").map((m) => m.createdAt)),
    responsiveness: averageReplyMinutes(messages),
  };
}

/**
 * MELHOR HORÁRIO PARA FALAR: em que faixa do dia o paciente costuma
 * escrever. Funcionalidade simples e pouco explorada: mandar mensagem
 * quando a pessoa está disponível aumenta muito a taxa de resposta.
 * Precisa de pelo menos 3 mensagens para não "inventar" padrão.
 */
export function bestContactWindow(dates: Date[]): { label: string; share: number } | null {
  if (dates.length < 3) return null;
  const buckets = [
    { label: "de manhã (6h às 12h)", from: 6, to: 12 },
    { label: "à tarde (12h às 18h)", from: 12, to: 18 },
    { label: "à noite (18h às 23h)", from: 18, to: 23 },
    { label: "de madrugada", from: 23, to: 30 },
  ];
  const counts = buckets.map(() => 0);
  for (const d of dates) {
    const h = Math.floor(utcToZoned(d).minutes / 60);
    const hh = h < 6 ? h + 24 : h;
    const i = buckets.findIndex((b) => hh >= b.from && hh < b.to);
    counts[i === -1 ? 3 : i]!++;
  }
  const max = Math.max(...counts);
  const idx = counts.indexOf(max);
  return { label: buckets[idx]!.label, share: Math.round((max / dates.length) * 100) };
}

/** Quanto tempo, em média, o PACIENTE leva para responder a clínica. */
export function averageReplyMinutes(msgs: { direction: string; createdAt: Date; conversationId: string }[]): number | null {
  const sorted = [...msgs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const gaps: number[] = [];
  const lastOut = new Map<string, Date>();
  for (const m of sorted) {
    if (m.direction === "out") lastOut.set(m.conversationId, m.createdAt);
    if (m.direction === "in") {
      const out = lastOut.get(m.conversationId);
      if (out) {
        const gap = (m.createdAt.getTime() - out.getTime()) / 60_000;
        if (gap >= 0 && gap < 72 * 60) gaps.push(gap);
        lastOut.delete(m.conversationId);
      }
    }
  }
  if (gaps.length < 2) return null;
  // Mediana: resiste a um "respondeu 2 dias depois" isolado
  gaps.sort((a, b) => a - b);
  return Math.round(gaps[Math.floor(gaps.length / 2)]!);
}

/**
 * LGPD (art. 18): cópia dos dados do paciente em formato legível por máquina.
 */
export async function exportPatientData(tx: Tx, id: string) {
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, id), with: { identities: true } });
  if (!contact) return null;
  const [conversations, appointments, events, nps, waitlist] = await inSequence([
    () => tx.query.conversations.findMany({ where: eq(schema.conversations.contactId, id), with: { messages: { orderBy: asc(schema.messages.createdAt) } } }),
    () => tx.query.appointments.findMany({ where: eq(schema.appointments.contactId, id), with: { professional: { columns: { name: true } } }, orderBy: asc(schema.appointments.startsAt) }),
    () => tx.select().from(schema.crmEvents).where(eq(schema.crmEvents.contactId, id)).orderBy(asc(schema.crmEvents.createdAt)),
    () => tx.select().from(schema.npsResponses).where(eq(schema.npsResponses.contactId, id)),
    () => tx.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.contactId, id)),
  ]);
  // Dados INFERIDOS sobre o titular também entram (LGPD: o acesso cobre o que a clínica concluiu sobre ele)
  const convIds = conversations.map((c) => c.id);
  // Anexos (fotos, áudios, PDFs): a lista vai no arquivo; os próprios arquivos a clínica baixa na conversa e entrega junto
  const msgIds = conversations.flatMap((c) => c.messages.map((m) => m.id));
  const files = msgIds.length
    ? await tx
        .select({
          messageId: schema.messageAttachments.messageId,
          tipo: schema.messageAttachments.kind,
          nome: schema.messageAttachments.fileName,
          bytes: schema.messageAttachments.sizeBytes,
          situacao: schema.messageAttachments.status,
          em: schema.messageAttachments.createdAt,
        })
        .from(schema.messageAttachments)
        .where(inArray(schema.messageAttachments.messageId, msgIds))
    : [];
  const [tasks, losses, suggestions, summaries, sentiments] = await inSequence([
    () => tx.select({ titulo: schema.tasks.title, prazo: schema.tasks.dueDate, concluida: schema.tasks.doneAt }).from(schema.tasks).where(eq(schema.tasks.contactId, id)),
    () => tx.select({ categoria: schema.lossReasons.category, em: schema.lossReasons.lostAt }).from(schema.lossReasons).where(eq(schema.lossReasons.contactId, id)),
    () =>
      tx
        .select({ tipo: schema.contactSuggestions.kind, campo: schema.contactSuggestions.field, valor: schema.contactSuggestions.value, situacao: schema.contactSuggestions.status })
        .from(schema.contactSuggestions)
        .where(eq(schema.contactSuggestions.contactId, id)),
    () =>
      convIds.length
        ? tx
            .select({ resumo: schema.aiSummaries.headline, em: schema.aiSummaries.createdAt, origem: schema.aiSummaries.source })
            .from(schema.aiSummaries)
            .where(inArray(schema.aiSummaries.conversationId, convIds))
        : Promise.resolve([]),
    () =>
      convIds.length
        ? tx
            .select({ sentimento: schema.aiSentiments.finalSentiment, em: schema.aiSentiments.createdAt, origem: schema.aiSentiments.source })
            .from(schema.aiSentiments)
            .where(inArray(schema.aiSentiments.conversationId, convIds))
        : Promise.resolve([]),
  ]);
  return {
    gerado_em: new Date().toISOString(),
    titular: {
      nome: contact.name,
      telefone: contact.phone,
      email: contact.email,
      nascimento: contact.birthDate,
      origem: contact.source,
      convenio: contact.insurance,
      indicado_por: contact.referredBy,
      etapa_no_relacionamento: contact.stage,
      etiquetas: contact.tags,
      consentimento_mensagens: contact.consentMarketing,
      consentimento_em: contact.consentAt,
      pediu_sair_em: contact.optedOutAt,
      cadastrado_em: contact.createdAt,
    },
    canais: contact.identities.map((i) => ({ canal: i.channel as Channel, identificador: i.externalId })),
    consultas: appointments.map((a) => ({ inicio: a.startsAt, profissional: a.professional.name, servico: a.service, situacao: a.status, motivo_cancelamento: a.cancelReason })),
    conversas: conversations.map((c) => ({
      canal: c.channel,
      // Notas internas da equipe não fazem parte das mensagens trocadas com o titular
      mensagens: c.messages.filter((m) => m.direction === "in" || m.direction === "out").map((m) => ({ em: m.createdAt, de: m.direction === "in" ? "paciente" : "clinica", texto: m.body })),
    })),
    pesquisas_satisfacao: nps.map((n) => ({ nota: n.score, em: n.createdAt })),
    lista_espera: waitlist.map((w) => ({ situacao: w.status, desde: w.createdAt })),
    registros: events.filter((e) => e.type !== "note").map((e) => ({ tipo: e.type, em: e.createdAt })),
    anexos: files.map((f) => ({ tipo: f.tipo, nome: f.nome, bytes: f.bytes, situacao: f.situacao, em: f.em })),
    tarefas_da_equipe: tasks,
    // O que o sistema (regras ou IA) concluiu a partir das conversas
    inferencias: {
      motivo_da_perda: losses,
      sugestoes_para_a_ficha: suggestions,
      resumos_de_conversa: summaries,
      sentimento_detectado: sentiments,
    },
  };
}
