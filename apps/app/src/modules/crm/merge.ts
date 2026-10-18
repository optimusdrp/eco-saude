import "server-only";
import { STAGE_PRIORITY } from "@ecosaude/core/crm";
import { and, asc, count, desc, eq, inArray, inSequence, ne, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { logEvent } from "./journey";
import type { CrmScope } from "./scope";

/**
 * UNIFICAÇÃO DE CADASTROS
 *
 * Junta o cadastro "secundário" no "principal" e apaga o secundário.
 * TUDO vai junto: conversas (mensagens de canais iguais viram uma conversa só),
 * consultas, lista de espera, ofertas, tarefas, pesquisas e linha do tempo.
 *
 * Dados do cadastro: valem os do principal; o que estiver vazio nele é
 * completado com o do secundário. Etiquetas somam. Etapa: a mais avançada.
 * LGPD: se qualquer um dos dois pediu SAIR, o unificado continua com SAIR.
 *
 * Roda numa transação só: ou unifica tudo, ou nada muda.
 */

/** O que vai acontecer (mostrado antes de confirmar). */
export async function mergePreview(tx: Tx, contactId: string) {
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  const [conv, appts, tasks, waitlist] = await inSequence([
    () => tx.select({ n: count() }).from(schema.conversations).where(eq(schema.conversations.contactId, contactId)),
    () => tx.select({ n: count() }).from(schema.appointments).where(eq(schema.appointments.contactId, contactId)),
    () => tx.select({ n: count() }).from(schema.tasks).where(eq(schema.tasks.contactId, contactId)),
    () => tx.select({ n: count() }).from(schema.waitlistEntries).where(eq(schema.waitlistEntries.contactId, contactId)),
  ]);
  return { conversations: n(conv), appointments: n(appts), tasks: n(tasks), waitlist: n(waitlist) };
}

export async function mergeContacts(tx: Tx, scope: CrmScope, input: { primaryId: string; secondaryId: string; primaryVersion: number }) {
  if (input.primaryId === input.secondaryId) throw new UserError("Escolha dois cadastros diferentes.");
  const [primary] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, input.primaryId)).for("update");
  const [secondary] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, input.secondaryId)).for("update");
  if (!primary || !secondary) throw new UserError("Um dos cadastros não existe mais (talvez já tenha sido unificado).");
  // LGPD: ficha anonimizada não entra em unificação (traria dados de volta para ela)
  if (primary.anonymizedAt || secondary.anonymizedAt) throw new UserError("Um dos cadastros teve os dados apagados a pedido do paciente (LGPD) e não pode ser unificado.");
  if (primary.version !== input.primaryVersion) throw new UserError("O cadastro principal foi alterado por outra pessoa. Atualize a página e confira antes de unificar.");

  const P = primary.id;
  const S = secondary.id;

  /* 1. Conversas: mesmo canal nos dois = junta as mensagens numa conversa só */
  const pConvs = await tx.select().from(schema.conversations).where(eq(schema.conversations.contactId, P));
  const sConvs = await tx.select().from(schema.conversations).where(eq(schema.conversations.contactId, S));
  for (const sc of sConvs) {
    const pc = pConvs.find((c) => c.channel === sc.channel);
    if (!pc) {
      await tx.update(schema.conversations).set({ contactId: P }).where(eq(schema.conversations.id, sc.id));
      continue;
    }
    await tx.update(schema.messages).set({ conversationId: pc.id }).where(eq(schema.messages.conversationId, sc.id));
    const [last] = await tx
      .select({ body: schema.messages.body, at: schema.messages.createdAt })
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, pc.id), ne(schema.messages.direction, "note")))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);
    const maxDate = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
    const minDate = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));
    await tx
      .update(schema.conversations)
      .set({
        lastMessageAt: last?.at ?? maxDate(pc.lastMessageAt, sc.lastMessageAt),
        lastMessagePreview: last?.body.slice(0, 140) ?? pc.lastMessagePreview,
        lastInboundAt: maxDate(pc.lastInboundAt, sc.lastInboundAt),
        awaitingReplySince: minDate(pc.awaitingReplySince, sc.awaitingReplySince),
        unreadCount: pc.unreadCount + sc.unreadCount,
        status: pc.status === "aberta" || sc.status === "aberta" ? "aberta" : pc.status,
        urgent: pc.urgent || sc.urgent,
        urgentKind: pc.urgentKind ?? sc.urgentKind,
        assigneeId: pc.assigneeId ?? sc.assigneeId,
      })
      .where(eq(schema.conversations.id, pc.id));
    await tx.delete(schema.conversations).where(eq(schema.conversations.id, sc.id));
  }

  /* 2. Tudo o que aponta para o contato passa para o principal */
  await tx.update(schema.contactIdentities).set({ contactId: P }).where(eq(schema.contactIdentities.contactId, S));
  await tx.update(schema.appointments).set({ contactId: P }).where(eq(schema.appointments.contactId, S));
  await tx.update(schema.slotOfferCandidates).set({ contactId: P }).where(eq(schema.slotOfferCandidates.contactId, S));
  await tx.update(schema.slotOffers).set({ filledByContactId: P }).where(eq(schema.slotOffers.filledByContactId, S));
  await tx.update(schema.tasks).set({ contactId: P }).where(eq(schema.tasks.contactId, S));
  await tx.update(schema.npsResponses).set({ contactId: P }).where(eq(schema.npsResponses.contactId, S));
  await tx.update(schema.crmEvents).set({ contactId: P }).where(eq(schema.crmEvents.contactId, S));
  await tx.update(schema.waitlistEntries).set({ contactId: P }).where(eq(schema.waitlistEntries.contactId, S));
  // Na lista de espera, uma vaga ativa por pessoa: fica a mais antiga (não perde o lugar na fila)
  const active = await tx
    .select({ id: schema.waitlistEntries.id })
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.contactId, P), inArray(schema.waitlistEntries.status, ["aguardando", "oferecido"])))
    .orderBy(asc(schema.waitlistEntries.createdAt));
  if (active.length > 1) {
    await tx
      .update(schema.waitlistEntries)
      .set({ status: "removido", resolvedAt: new Date() })
      .where(
        inArray(
          schema.waitlistEntries.id,
          active.slice(1).map((a) => a.id),
        ),
      );
  }
  // Pares "não é a mesma pessoa" envolvendo o secundário deixam de fazer sentido
  await tx.execute(sql`delete from contact_duplicate_dismissals where contact_a = ${S} or contact_b = ${S}`);

  /* 3. Dados do cadastro principal */
  const rank = (s: string) => STAGE_PRIORITY.indexOf(s as (typeof STAGE_PRIORITY)[number]);
  const stage = rank(secondary.stage) < rank(primary.stage) ? secondary.stage : primary.stage;
  const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
  const earlier = (a: Date, b: Date) => (a < b ? a : b);
  await tx
    .update(schema.contacts)
    .set({
      phone: primary.phone ?? secondary.phone,
      email: primary.email ?? secondary.email,
      birthDate: primary.birthDate ?? secondary.birthDate,
      source: primary.source ?? secondary.source,
      preferredChannel: primary.preferredChannel ?? secondary.preferredChannel,
      ownerId: primary.ownerId ?? secondary.ownerId,
      tags: [...new Set([...primary.tags, ...secondary.tags])],
      stage,
      stageChangedAt: stage !== primary.stage ? new Date() : primary.stageChangedAt,
      lostReason: stage === "perdido" ? (primary.lostReason ?? secondary.lostReason) : null,
      consentMarketing: primary.consentMarketing || secondary.consentMarketing,
      consentAt: primary.consentAt ?? secondary.consentAt,
      // SAIR em qualquer um dos dois vale para o unificado
      optedOutAt: later(primary.optedOutAt, secondary.optedOutAt),
      lastInteractionAt: later(primary.lastInteractionAt, secondary.lastInteractionAt),
      lastVisitAt: later(primary.lastVisitAt, secondary.lastVisitAt),
      createdAt: earlier(primary.createdAt, secondary.createdAt),
      version: sql`${schema.contacts.version} + 1`,
    })
    .where(eq(schema.contacts.id, P));

  /* 4. Apaga o secundário e registra na linha do tempo */
  await tx.delete(schema.contacts).where(eq(schema.contacts.id, S));
  await logEvent(tx, {
    contactId: P,
    actorId: scope.actorId,
    type: "contacts_merged",
    data: {
      nome: secondary.name,
      telefone: secondary.phone,
      email: secondary.email,
      // Telefone diferente do principal: fica registrado (a identidade de WhatsApp também foi trazida)
      telefoneDiferente: secondary.phone && primary.phone && secondary.phone !== primary.phone ? secondary.phone : null,
    },
  });
  return { primaryId: P };
}
