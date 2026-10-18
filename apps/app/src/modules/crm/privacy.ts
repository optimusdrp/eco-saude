import "server-only";
import { createHmac } from "node:crypto";
import { ANONYMIZED_MESSAGE, ANONYMIZED_NAME, ANONYMIZED_TASK, normalizeSubjectId, privacyDueDate, privacyProtocol, type PrivacyRequestChannel, type PrivacyRequestKind } from "@ecosaude/core/crm";
import { and, desc, eq, gt, inArray, isNull, or, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { logEvent } from "./journey";

/**
 * PEDIDOS DO TITULAR E ANONIMIZAÇÃO (servidor)
 *
 * Fluxo:
 *  1. A recepção REGISTRA o pedido (protocolo + prazo de 15 dias).
 *  2. A gestão (permissão "pacientes.anonimizar") confere a identidade e EXECUTA,
 *     ou RECUSA por um motivo da lista fechada.
 *  3. A execução roda numa ÚNICA transação: ou apaga tudo, ou nada (sem meio-termo).
 *
 * O que a anonimização faz, tabela por tabela (inventário tirado do banco):
 *  - contacts: nome vira "Paciente anonimizado"; telefone, e-mail, nascimento,
 *    convênio, indicação, motivo de perda e etiquetas são apagados; sem consentimento
 *    e com opt-out (nenhuma automação manda mensagem).
 *  - contact_identities: apagadas (são os números/usuários dos canais). Se a pessoa
 *    escrever de novo, nasce um contato NOVO, sem ligação com o antigo.
 *  - messages: texto trocado por "[apagada a pedido do titular]"; id externo e meta
 *    apagados. Ficam direção, data e autor (tempo de resposta da equipe).
 *    Mensagens ainda NA FILA são canceladas (não podem sair depois do pedido).
 *  - conversations: prévia, destinatário e motivos de intenção/sentimento apagados.
 *  - Leituras da IA (classificação, sentimento, resumo, rascunho, promessas,
 *    agendamento, fila de IA, sugestões de cadastro, opiniões de duplicado): apagadas.
 *  - loss_reasons e service_audits: o trecho citado é apagado; a categoria e as
 *    notas da equipe ficam (não identificam o paciente).
 *  - crm_events: o conteúdo (data) é apagado; ficam tipo e data (linha do tempo vazia).
 *  - tasks: abertas são apagadas; concluídas ficam com título genérico.
 *  - appointments: observações e motivo de cancelamento apagados; ficam data,
 *    profissional, serviço e status (relatórios e modelos de risco).
 *  - automation_runs: pendentes canceladas; conteúdo do evento apagado.
 *  - waitlist_entries: apagadas.
 *  - nps_responses e slot_offer_candidates: só números, ficam.
 *
 * Limite conhecido (fica na tela e no README): o histórico no aparelho do paciente
 * e nos servidores do WhatsApp/Meta não é apagado pelo EcoSaúde; cópias de segurança
 * do banco expiram no prazo da retenção configurada no provedor.
 */

/** Segredo do hash do identificador. Fica só no servidor. */
function hashSecret(): string {
  const s = process.env.LGPD_HASH_SECRET || process.env.TOTP_ENCRYPTION_KEY;
  if (!s) throw new Error("Defina LGPD_HASH_SECRET no ambiente.");
  return s;
}

/** HMAC do telefone ou e-mail (por clínica). Guarda a prova sem guardar o dado. */
export function subjectHash(clinicId: string, value: string | null | undefined): string | null {
  const id = normalizeSubjectId(value);
  return id ? createHmac("sha256", hashSecret()).update(`${clinicId}:${id}`).digest("hex") : null;
}

/** Próximo protocolo da clínica no ano (trava por clínica para não repetir número). */
async function nextProtocol(tx: Tx, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('privacy_protocol:' || current_setting('app.clinic_id', true)))`);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.privacyRequests)
    .where(sql`extract(year from ${schema.privacyRequests.requestedAt} at time zone 'UTC') = ${year}`);
  return privacyProtocol(year, (row?.n ?? 0) + 1);
}

export interface PrivacyRequestRow {
  id: string;
  protocol: string;
  kind: PrivacyRequestKind;
  status: "aberta" | "concluida" | "recusada";
  channel: PrivacyRequestChannel;
  requestedAt: Date;
  dueAt: Date;
  decidedAt: Date | null;
  refusalReason: string | null;
  identityChecked: boolean;
}

/** Pedido de exclusão em aberto para este contato (no máximo um). */
export async function openRequestFor(tx: Tx, contactId: string): Promise<PrivacyRequestRow | null> {
  const [r] = await tx
    .select()
    .from(schema.privacyRequests)
    .where(and(eq(schema.privacyRequests.contactId, contactId), eq(schema.privacyRequests.kind, "exclusao"), eq(schema.privacyRequests.status, "aberta")))
    .limit(1);
  return (r as PrivacyRequestRow | undefined) ?? null;
}

/** Registra um pedido (exclusão em aberto, ou acesso já atendido). */
export async function registerPrivacyRequest(
  tx: Tx,
  input: { contactId: string; clinicId: string; kind: PrivacyRequestKind; channel: PrivacyRequestChannel; actorId: string | null; identityChecked?: boolean; done?: boolean },
): Promise<{ id: string; protocol: string; dueAt: Date }> {
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, input.contactId), columns: { id: true, phone: true, email: true, anonymizedAt: true } });
  if (!contact) throw new UserError("Contato não encontrado.");
  if (contact.anonymizedAt) throw new UserError("Os dados deste paciente já foram apagados.");
  if (input.kind === "exclusao" && (await openRequestFor(tx, input.contactId))) throw new UserError("Já existe um pedido de exclusão em aberto para este paciente.");
  const now = new Date();
  const protocol = await nextProtocol(tx, now);
  const [row] = await tx
    .insert(schema.privacyRequests)
    .values({
      protocol,
      kind: input.kind,
      status: input.done ? "concluida" : "aberta",
      contactId: input.contactId,
      subjectHash: subjectHash(input.clinicId, contact.phone ?? contact.email),
      channel: input.channel,
      requestedAt: now,
      dueAt: privacyDueDate(now),
      createdBy: input.actorId,
      decidedBy: input.done ? input.actorId : null,
      decidedAt: input.done ? now : null,
      identityChecked: !!input.identityChecked,
    })
    .returning({ id: schema.privacyRequests.id, protocol: schema.privacyRequests.protocol, dueAt: schema.privacyRequests.dueAt });
  if (input.kind === "exclusao") await logEvent(tx, { contactId: input.contactId, actorId: input.actorId, type: "privacy_request", data: { protocolo: protocol } });
  return row!;
}

/** O que impede a exclusão agora (a equipe resolve antes, para não deixar ponta solta). */
export async function anonymizeBlockers(tx: Tx, contactId: string): Promise<string[]> {
  const [future] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.contactId, contactId), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])));
  const out: string[] = [];
  if (future?.n)
    out.push(
      `${future.n} ${future.n === 1 ? "consulta marcada" : "consultas marcadas"}: desmarque antes (o paciente pediu para sair, e a agenda não pode ficar com um horário de alguém que não existe mais).`,
    );
  return out;
}

/**
 * Anonimiza o paciente. Uma transação só: se qualquer passo falhar, nada muda.
 * Devolve quantos registros foram apagados ou anonimizados (vai para o registro do pedido).
 */
export async function anonymizeContact(tx: Tx, contactId: string): Promise<Record<string, number>> {
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId), columns: { id: true, anonymizedAt: true } });
  if (!contact) throw new UserError("Contato não encontrado.");
  if (contact.anonymizedAt) throw new UserError("Os dados deste paciente já foram apagados.");
  const blockers = await anonymizeBlockers(tx, contactId);
  if (blockers.length) throw new UserError(blockers.join(" "));

  const convIds = (await tx.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.contactId, contactId))).map((c) => c.id);
  const inConv = <T extends { conversationId: unknown }>(t: T) => (convIds.length ? inArray(t.conversationId as never, convIds) : sql`false`);
  const n = (rows: unknown[]) => rows.length;
  const r: Record<string, number> = {};

  // 1. Mensagens: as da fila são canceladas ANTES (não podem sair depois do pedido)
  r.envios_cancelados = n(
    await tx
      .update(schema.messages)
      .set({ status: "falhou", error: "cancelada: dados apagados a pedido do titular" })
      .where(and(inConv(schema.messages), eq(schema.messages.status, "fila")))
      .returning({ id: schema.messages.id }),
  );
  r.mensagens = n(await tx.update(schema.messages).set({ body: ANONYMIZED_MESSAGE, externalId: null, meta: null, error: null }).where(inConv(schema.messages)).returning({ id: schema.messages.id }));
  r.conversas = n(
    await tx
      .update(schema.conversations)
      .set({
        lastMessagePreview: null,
        replyTo: null,
        intentReason: null,
        sentimentReason: null,
        awaitingReplySince: null,
        unreadCount: 0,
        status: "resolvida",
        snoozedUntil: null,
      })
      .where(eq(schema.conversations.contactId, contactId))
      .returning({ id: schema.conversations.id }),
  );

  // 1b. Anexos (fotos de exame, áudios, PDFs): fichas apagadas; o gatilho do banco põe
  //     os arquivos na fila de remoção, e a ação remove do armazenamento logo depois
  const msgIds = convIds.length ? (await tx.select({ id: schema.messages.id }).from(schema.messages).where(inArray(schema.messages.conversationId, convIds))).map((m) => m.id) : [];
  r.anexos = msgIds.length ? n(await tx.delete(schema.messageAttachments).where(inArray(schema.messageAttachments.messageId, msgIds)).returning({ id: schema.messageAttachments.id })) : 0;

  // 2. Leituras da IA (texto derivado da conversa): apagadas
  r.leituras_ia = 0;
  for (const t of [schema.aiClassifications, schema.aiSentiments, schema.aiSummaries, schema.aiDrafts, schema.aiPromises, schema.aiScheduleSuggestions] as const) {
    r.leituras_ia += n(await tx.delete(t).where(inConv(t)).returning({ id: t.id }));
  }
  r.leituras_ia += n(await tx.delete(schema.aiJobs).where(eq(schema.aiJobs.contactId, contactId)).returning({ id: schema.aiJobs.id }));
  r.sugestoes = n(await tx.delete(schema.contactSuggestions).where(eq(schema.contactSuggestions.contactId, contactId)).returning({ id: schema.contactSuggestions.id }));
  r.duplicados = n(
    await tx
      .delete(schema.duplicateReviews)
      .where(or(eq(schema.duplicateReviews.contactA, contactId), eq(schema.duplicateReviews.contactB, contactId)))
      .returning({ a: schema.duplicateReviews.contactA }),
  );
  await tx.delete(schema.contactDuplicateDismissals).where(or(eq(schema.contactDuplicateDismissals.contactA, contactId), eq(schema.contactDuplicateDismissals.contactB, contactId)));

  // 3. Trechos citados: apagados (categoria e notas da equipe ficam)
  r.trechos = n(await tx.update(schema.lossReasons).set({ quote: null }).where(eq(schema.lossReasons.contactId, contactId)).returning({ id: schema.lossReasons.id }));
  r.trechos += n(await tx.update(schema.serviceAudits).set({ quote: null }).where(inConv(schema.serviceAudits)).returning({ id: schema.serviceAudits.id }));

  // 4. Identificadores dos canais (números, usuários): apagados
  r.identificadores = n(await tx.delete(schema.contactIdentities).where(eq(schema.contactIdentities.contactId, contactId)).returning({ id: schema.contactIdentities.id }));

  // 5. Tarefas: abertas somem; concluídas ficam sem o texto
  r.tarefas = n(
    await tx
      .delete(schema.tasks)
      .where(and(eq(schema.tasks.contactId, contactId), isNull(schema.tasks.doneAt)))
      .returning({ id: schema.tasks.id }),
  );
  r.tarefas += n(await tx.update(schema.tasks).set({ title: ANONYMIZED_TASK }).where(eq(schema.tasks.contactId, contactId)).returning({ id: schema.tasks.id }));

  // 6. Agenda e automações
  r.consultas = n(await tx.update(schema.appointments).set({ notes: null, cancelReason: null }).where(eq(schema.appointments.contactId, contactId)).returning({ id: schema.appointments.id }));
  r.automacoes = n(
    await tx
      .update(schema.automationRuns)
      .set({
        status: sql`case when ${schema.automationRuns.status} = 'pendente' then 'ignorada' else ${schema.automationRuns.status} end`,
        event: {},
        result: sql`case when ${schema.automationRuns.status} = 'pendente' then 'dados apagados a pedido do titular' else ${schema.automationRuns.result} end`,
      })
      .where(eq(schema.automationRuns.contactId, contactId))
      .returning({ id: schema.automationRuns.id }),
  );
  r.lista_espera = n(await tx.delete(schema.waitlistEntries).where(eq(schema.waitlistEntries.contactId, contactId)).returning({ id: schema.waitlistEntries.id }));

  // 7. Linha do tempo: fica só tipo e data
  r.eventos = n(await tx.update(schema.crmEvents).set({ data: null }).where(eq(schema.crmEvents.contactId, contactId)).returning({ id: schema.crmEvents.id }));

  // 8. A ficha
  await tx
    .update(schema.contacts)
    .set({
      name: ANONYMIZED_NAME,
      phone: null,
      email: null,
      birthDate: null,
      insurance: null,
      referredBy: null,
      lostReason: null,
      tags: [],
      consentMarketing: false,
      consentAt: null,
      optedOutAt: sql`coalesce(${schema.contacts.optedOutAt}, now())`,
      anonymizedAt: new Date(),
      version: sql`${schema.contacts.version} + 1`,
    })
    .where(eq(schema.contacts.id, contactId));
  return r;
}

/** Lista dos pedidos para a tela (mais urgentes primeiro). */
export async function listPrivacyRequests(tx: Tx, limit = 200) {
  return tx
    .select({
      id: schema.privacyRequests.id,
      protocol: schema.privacyRequests.protocol,
      kind: schema.privacyRequests.kind,
      status: schema.privacyRequests.status,
      channel: schema.privacyRequests.channel,
      requestedAt: schema.privacyRequests.requestedAt,
      dueAt: schema.privacyRequests.dueAt,
      decidedAt: schema.privacyRequests.decidedAt,
      refusalReason: schema.privacyRequests.refusalReason,
      result: schema.privacyRequests.result,
      contactId: schema.privacyRequests.contactId,
      contactName: schema.contacts.name,
      anonymizedAt: schema.contacts.anonymizedAt,
      decidedByName: schema.clinicUsers.name,
    })
    .from(schema.privacyRequests)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.privacyRequests.contactId))
    .leftJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.privacyRequests.decidedBy))
    .orderBy(sql`case when ${schema.privacyRequests.status} = 'aberta' then 0 else 1 end`, schema.privacyRequests.dueAt, desc(schema.privacyRequests.requestedAt))
    .limit(limit);
}

/** Quantos pedidos de exclusão estão em aberto (e quantos atrasados). */
export async function openPrivacyCounts(tx: Tx): Promise<{ open: number; late: number }> {
  const [r] = await tx
    .select({
      open: sql<number>`count(*)::int`,
      late: sql<number>`count(*) filter (where ${schema.privacyRequests.dueAt} < now())::int`,
    })
    .from(schema.privacyRequests)
    .where(eq(schema.privacyRequests.status, "aberta"));
  return { open: r?.open ?? 0, late: r?.late ?? 0 };
}
