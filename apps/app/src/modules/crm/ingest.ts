import "server-only";
import type { InboundMessage } from "@ecosaude/channels";
import {
  CRM_FEATURES,
  describeOpeningHours,
  detectIntent,
  detectUrgency,
  isAffirmative,
  isDecline,
  isOptIn,
  isOptOut,
  isOpen,
  parseNpsScore,
  todayIso,
  utcToZoned,
  type MessageTemplateKey,
  type TemplateVariables,
  hasProfileCue,
} from "@ecosaude/core/crm";
import { and, desc, eq, gt, isNotNull, schema, sql, type Tx } from "@ecosaude/db";
import { queueInboundAttachments } from "./files/attachments";
import { isScheduleConflict } from "@/lib/server";
import { releaseOfferCandidates } from "./scheduling";
import { logEvent, onInbound, onScheduled } from "./journey";
import { queueIntentReview } from "./ai/intent";
import { queueAiJob } from "./ai/jobs";
import { notePromiseCandidate } from "./ai/promises";
import { markSentimentOnInbound } from "./ai/sentiment";
import { automationSettings } from "./automation-settings";
import { triggerAutomations } from "./automations";
import { queueOutbound, templateVars, type ConversationRow } from "./messaging";
import { renderTemplate } from "./templates";
import type { CrmScope } from "./scope";

/**
 * ENTRADA DE MENSAGENS: o mesmo caminho para o simulador e para os webhooks reais.
 *
 *   1. Descobre (ou cria) o contato pelo identificador do canal
 *   2. Abre a conversa e grava a mensagem (sem duplicar, pelo ID externo)
 *   3. Tenta as automações, nesta ordem:
 *        SAIR/PARAR          -> descadastro (LGPD)
 *        resposta a oferta   -> quem disser SIM primeiro fica com o horário
 *        resposta a confirmação ("1"/"2")
 *        nota da pesquisa (0 a 10)
 *   4. Se nenhuma automação resolveu: marca a conversa como esperando
 *      resposta, com intenção detectada e sinal de urgência
 */
export interface IngestResult {
  contactId: string;
  conversationId: string;
  duplicate: boolean;
  /** Automação que tratou a mensagem (null = precisa de uma pessoa) */
  automation: string | null;
}

export async function ingestInbound(tx: Tx, scope: CrmScope, msg: InboundMessage): Promise<IngestResult> {
  /* 1. Contato */
  let contactId: string | null = null;
  const [identity] = await tx
    .select({ contactId: schema.contactIdentities.contactId })
    .from(schema.contactIdentities)
    .where(and(eq(schema.contactIdentities.channel, msg.channel), eq(schema.contactIdentities.externalId, msg.from.externalId)));
  contactId = identity?.contactId ?? null;

  // WhatsApp: o identificador é o telefone. Se a pessoa já existe com esse telefone, é a mesma.
  if (!contactId && msg.from.phone) {
    const [byPhone] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.phone, msg.from.phone)).limit(1);
    contactId = byPhone?.id ?? null;
  }
  let created = false;
  if (!contactId) {
    created = true;
    const [newContact] = await tx
      .insert(schema.contacts)
      .values({
        name: msg.from.name?.trim() || msg.from.externalId,
        phone: msg.from.phone ?? null,
        stage: "novo",
        source: msg.channel,
        preferredChannel: msg.channel,
      })
      .returning({ id: schema.contacts.id });
    contactId = newContact!.id;
    await logEvent(tx, { contactId, type: "contact_created", data: { origem: msg.channel } });
  }
  if (!identity) {
    await tx
      .insert(schema.contactIdentities)
      .values({ contactId, channel: msg.channel, externalId: msg.from.externalId, displayName: msg.from.name ?? null })
      .onConflictDoNothing();
  }

  /* 2. Conversa e mensagem */
  await tx.insert(schema.conversations).values({ contactId, channel: msg.channel }).onConflictDoNothing();
  const [conv] = await tx
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.contactId, contactId), eq(schema.conversations.channel, msg.channel)));
  if (!conv) throw new Error("Falha ao abrir a conversa.");

  const [stored] = await tx
    .insert(schema.messages)
    .values({
      conversationId: conv.id,
      channel: msg.channel,
      direction: "in",
      body: msg.text,
      status: "recebida",
      externalId: msg.externalMessageId,
      createdAt: msg.receivedAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.messages.id });
  if (!stored) return { contactId, conversationId: conv.id, duplicate: true, automation: null };
  // Anexos: só a ficha "pendente" agora; o arquivo é baixado depois (o webhook não espera)
  if (msg.attachments?.length) await queueInboundAttachments(tx, stored.id, msg.attachments);

  // Janela de 24h reabre com a mensagem do paciente
  await tx
    .update(schema.conversations)
    .set({ lastInboundAt: msg.receivedAt, lastMessageAt: msg.receivedAt, lastMessagePreview: msg.text.slice(0, 140), replyTo: msg.from.externalId })
    .where(eq(schema.conversations.id, conv.id));
  await tx.update(schema.contacts).set({ lastInteractionAt: msg.receivedAt }).where(eq(schema.contacts.id, contactId));
  const conversation: ConversationRow = { ...conv, lastInboundAt: msg.receivedAt };
  await onInbound(tx, contactId);

  /* 3. Automações */
  const contact = (await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) }))!;
  const vars = templateVars(contact, scope.clinicName);
  // Resposta automática com o texto da clínica (Ajustes > Mensagens automáticas). Desligada = não envia.
  const reply: Reply = async (key, kind, extra) => {
    const body = await renderTemplate(tx, key, { ...vars, ...extra });
    if (body) await queueOutbound(tx, { conversation, body, authorId: null, templateKey: key, meta: { kind: "automation", automation: kind } });
  };
  const auto = await automationSettings(tx);

  let automation: string | null = null;

  if (isOptOut(msg.text)) {
    await tx.update(schema.contacts).set({ optedOutAt: new Date(), consentMarketing: false }).where(eq(schema.contacts.id, contactId));
    await logEvent(tx, { contactId, type: "opt_out", data: { canal: msg.channel } });
    await reply("descadastro", "descadastro");
    automation = "descadastro";
  } else if (contact.optedOutAt && isOptIn(msg.text)) {
    // O próprio paciente pediu para voltar: é um novo consentimento (registrado com data)
    await tx.update(schema.contacts).set({ optedOutAt: null, consentMarketing: true, consentAt: new Date() }).where(eq(schema.contacts.id, contactId));
    await logEvent(tx, { contactId, type: "opt_in", data: { canal: msg.channel, origem: "paciente" } });
    await reply("reativacao", "reativacao");
    automation = "reativacao";
  }

  if (!automation && scope.has(CRM_FEATURES.waitlist) && auto.espera_oferta?.enabled) automation = await handleOfferReply(tx, scope, contact, msg.text, reply);
  if (!automation && scope.has(CRM_FEATURES.confirmations) && auto.confirmacao_resposta?.enabled)
    automation = await handleConfirmationReply(tx, scope, contact, msg.text, reply, auto.confirmacao_resposta.tarefaRemarcar === true);
  if (!automation && scope.has(CRM_FEATURES.nps) && auto.nps?.enabled) automation = await handleNpsReply(tx, contact, msg.text, reply, auto.nps);

  // Marca a mensagem com a automação que a tratou (aparece na conversa)
  if (automation) {
    await tx
      .update(schema.messages)
      .set({ meta: { handledBy: automation } })
      .where(eq(schema.messages.id, stored.id));
  }

  /* 4. Conversa para a equipe */
  const handled = automation !== null && automation !== "confirmacao_recusada";
  const urgency = detectUrgency(msg.text);
  const intent = automation === "confirmacao_recusada" ? "remarcar" : detectIntent(msg.text);
  await tx
    .update(schema.conversations)
    .set({
      unreadCount: sql`${schema.conversations.unreadCount} + 1`,
      snoozedUntil: null,
      ...(handled
        ? {}
        : {
            status: "aberta" as const,
            awaitingReplySince: sql`coalesce(${schema.conversations.awaitingReplySince}, ${msg.receivedAt})`,
            // Palavras-chave marcam NA HORA; a IA (se ligada) revisa logo depois
            intent,
            intentSource: "regras",
            intentConfidence: null,
            intentReason: null,
          }),
      // Urgência fica marcada até alguém resolver a conversa
      ...(urgency.urgent ? { urgent: true, urgentKind: urgency.kind } : {}),
    })
    .where(eq(schema.conversations.id, conv.id));
  if (urgency.urgent) {
    await logEvent(tx, { contactId, type: "urgency_flag", data: { sinais: urgency.labels, tipo: urgency.kind } });
  }

  // Entra na fila da IA para confirmar ou corrigir a intenção (fora do webhook, sem atrasar a resposta)
  if (!handled) await queueIntentReview(tx, conv.id, stored.id);
  // Sentimento: palavras-chave na hora (a conversa já sobe na fila); a IA confirma logo depois
  if (!handled) await markSentimentOnInbound(tx, conv.id, stored.id);
  // Promessa do PACIENTE ("amanhã te mando os exames"), se a clínica ligou essa opção
  if (!handled) await notePromiseCandidate(tx, { conversationId: conv.id, messageId: stored.id, text: msg.text, authorId: null, side: "paciente" });
  // Cadastro: dado mencionado no chat (nascimento, e-mail, convênio, indicação) vira sugestão para a ficha
  if (hasProfileCue(msg.text)) await queueAiJob(tx, "cadastro", contactId);
  // Etiquetas por comportamento: só com conversa nova suficiente (5 mensagens do paciente
  // desde a última análise) e no máximo uma análise por dia por paciente (custo).
  const [lastTags] = await tx
    .select({ at: schema.aiJobs.createdAt })
    .from(schema.aiJobs)
    .where(and(eq(schema.aiJobs.kind, "etiquetas"), eq(schema.aiJobs.contactId, contactId)))
    .orderBy(desc(schema.aiJobs.createdAt))
    .limit(1);
  if (!lastTags || lastTags.at.getTime() < Date.now() - 86_400_000) {
    const [seen] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(and(eq(schema.conversations.contactId, contactId), eq(schema.messages.direction, "in"), lastTags ? gt(schema.messages.createdAt, lastTags.at) : undefined));
    if ((seen?.n ?? 0) >= 5) await queueAiJob(tx, "etiquetas", contactId);
  }

  /* 5. Boas-vindas e fora do horário (nunca em urgência: aí uma pessoa precisa responder) */
  if (!automation && !urgency.urgent && scope.has(CRM_FEATURES.inbox)) {
    const z = utcToZoned(msg.receivedAt);
    const fh = auto.fora_horario;
    const hours = fh ? { dias: fh.dias as number[], inicio: String(fh.inicio), fim: String(fh.fim) } : null;
    if (fh?.enabled && hours && !isOpen(hours, z.weekday, z.minutes)) {
      // No máximo uma resposta "fora do horário" a cada 12h por conversa
      const [recent] = await tx
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.templateKey, "fora_horario"), gt(schema.messages.createdAt, new Date(msg.receivedAt.getTime() - 12 * 3_600_000))))
        .limit(1);
      if (!recent) {
        await reply("fora_horario", "fora_horario", { horario_atendimento: describeOpeningHours(hours.dias, hours.inicio, hours.fim) });
        await logEvent(tx, { contactId, type: "after_hours_reply", data: { canal: msg.channel } });
      }
    } else if (auto.boas_vindas?.enabled && created) {
      await reply("boas_vindas", "boas_vindas");
      await logEvent(tx, { contactId, type: "welcome_sent", data: { canal: msg.channel } });
    }
  }

  /* 6. Regras da clínica com o gatilho "o paciente mandou mensagem" */
  await triggerAutomations(tx, { type: "message_in", contactId, data: { texto: msg.text.slice(0, 500), canal: msg.channel } });

  return { contactId, conversationId: conv.id, duplicate: false, automation };
}

type Reply = (key: MessageTemplateKey, kind: string, extra?: TemplateVariables) => Promise<unknown>;
type Contact = typeof schema.contacts.$inferSelect;

/* ------------------------ Oferta de horário (lista de espera) ---------------- */

async function handleOfferReply(tx: Tx, scope: CrmScope, contact: Contact, text: string, reply: Reply): Promise<string | null> {
  const yes = isAffirmative(text);
  const no = isDecline(text);
  if (!yes && !no) return null;

  const [candidate] = await tx
    .select({ offer: schema.slotOffers, entryId: schema.slotOfferCandidates.waitlistEntryId })
    .from(schema.slotOfferCandidates)
    .innerJoin(schema.slotOffers, eq(schema.slotOfferCandidates.offerId, schema.slotOffers.id))
    .where(and(eq(schema.slotOfferCandidates.contactId, contact.id), eq(schema.slotOfferCandidates.outcome, "enviada"), gt(schema.slotOffers.createdAt, new Date(Date.now() - 86_400_000))))
    .orderBy(desc(schema.slotOffers.createdAt))
    .limit(1);
  if (!candidate) return null;
  const { offer } = candidate;
  const setOutcome = (outcome: string) =>
    tx
      .update(schema.slotOfferCandidates)
      .set({ outcome, respondedAt: new Date() })
      .where(and(eq(schema.slotOfferCandidates.offerId, offer.id), eq(schema.slotOfferCandidates.contactId, contact.id)));

  if (no) {
    await setOutcome("recusou");
    await tx.update(schema.waitlistEntries).set({ status: "aguardando" }).where(eq(schema.waitlistEntries.id, candidate.entryId));
    await reply("oferta_recusada", "oferta_recusada");
    return "oferta_recusada";
  }

  const pro = await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, offer.professionalId) });
  const vars = templateVars(contact, scope.clinicName, { startsAt: offer.startsAt, professionalName: pro?.name ?? "" });

  if (offer.status !== "aberta" || offer.expiresAt < new Date()) {
    await setOutcome("atrasado");
    await tx.update(schema.waitlistEntries).set({ status: "aguardando" }).where(eq(schema.waitlistEntries.id, candidate.entryId));
    await reply("oferta_perdida", "oferta_atrasada", vars);
    return "oferta_atrasada";
  }

  // Tenta reservar. Savepoint: se outro paciente ganhou no mesmo instante, o banco recusa e só esta parte é desfeita.
  try {
    const appt = await tx.transaction(async (sp) => {
      const [created] = await sp
        .insert(schema.appointments)
        .values({ contactId: contact.id, professionalId: offer.professionalId, startsAt: offer.startsAt, endsAt: offer.endsAt, source: "lista_espera", status: "confirmado", confirmedAt: new Date() })
        .returning({ id: schema.appointments.id });
      return created!;
    });
    await tx.update(schema.slotOffers).set({ status: "preenchida", filledAppointmentId: appt.id, filledByContactId: contact.id }).where(eq(schema.slotOffers.id, offer.id));
    await setOutcome("aceitou");
    await tx.update(schema.waitlistEntries).set({ status: "agendado", resolvedAt: new Date() }).where(eq(schema.waitlistEntries.id, candidate.entryId));
    // Os outros candidatos voltam a "aguardando" na lista
    await tx.execute(sql`
      update waitlist_entries w set status = 'aguardando'
        from slot_offer_candidates c
       where c.offer_id = ${offer.id} and c.waitlist_entry_id = w.id
         and c.contact_id <> ${contact.id} and w.status = 'oferecido'`);
    await onScheduled(tx, contact.id, null);
    await logEvent(tx, { contactId: contact.id, type: "slot_filled", data: { offerId: offer.id, appointmentId: appt.id, startsAt: offer.startsAt.toISOString() } });
    await reply("oferta_aceita", "oferta_aceita", vars);
    return "oferta_aceita";
  } catch (error) {
    if (!isScheduleConflict(error)) throw error;
    await tx.update(schema.slotOffers).set({ status: "cancelada" }).where(eq(schema.slotOffers.id, offer.id));
    await setOutcome("atrasado");
    // TODOS os candidatos desta oferta (inclusive quem respondeu) voltam para a fila
    await releaseOfferCandidates(tx, [offer.id]);
    await reply("oferta_perdida", "oferta_atrasada", vars);
    return "oferta_atrasada";
  }
}

/* ----------------------------- Resposta de confirmação ---------------------- */

async function handleConfirmationReply(tx: Tx, scope: CrmScope, contact: Contact, text: string, reply: Reply, taskOnDecline: boolean): Promise<string | null> {
  const yes = isAffirmative(text);
  const no = isDecline(text);
  if (!yes && !no) return null;

  const appt = await tx.query.appointments.findFirst({
    where: and(
      eq(schema.appointments.contactId, contact.id),
      eq(schema.appointments.status, "agendado"),
      isNotNull(schema.appointments.confirmationRequestedAt),
      gt(schema.appointments.startsAt, new Date()),
    ),
    with: { professional: true },
    orderBy: (a, { asc }) => asc(a.startsAt),
  });
  if (!appt) return null;
  const vars = templateVars(contact, scope.clinicName, { startsAt: appt.startsAt, professionalName: appt.professional.name });

  if (yes) {
    await tx
      .update(schema.appointments)
      .set({ status: "confirmado", confirmedAt: new Date(), version: sql`${schema.appointments.version} + 1` })
      .where(eq(schema.appointments.id, appt.id));
    await logEvent(tx, { contactId: contact.id, type: "appointment_status", data: { appointmentId: appt.id, de: "agendado", para: "confirmado", auto: true } });
    await reply("confirmacao_ok", "confirmacao", vars);
    await logEvent(tx, { contactId: contact.id, type: "confirmation_reply", data: { appointmentId: appt.id, resposta: "confirmou" } });
    return "confirmacao";
  }
  // "2" / "remarcar": a equipe precisa agir (a conversa fica marcada como "quer remarcar")
  await reply("confirmacao_remarcar", "confirmacao_recusada", vars);
  await logEvent(tx, { contactId: contact.id, type: "confirmation_reply", data: { appointmentId: appt.id, resposta: "remarcar" } });
  if (taskOnDecline) {
    await tx.insert(schema.tasks).values({ contactId: contact.id, title: `Remarcar ${contact.name}: pediu pela confirmação`, dueDate: todayIso(), kind: "remarcar" });
  }
  return "confirmacao_recusada";
}

/* ---------------------------- Pesquisa de satisfação ------------------------ */

async function handleNpsReply(tx: Tx, contact: Contact, text: string, reply: Reply, cfg: Record<string, unknown>): Promise<string | null> {
  const score = parseNpsScore(text);
  if (score === null) return null;

  const appt = await tx.query.appointments.findFirst({
    where: and(
      eq(schema.appointments.contactId, contact.id),
      isNotNull(schema.appointments.npsRequestedAt),
      gt(schema.appointments.npsRequestedAt, new Date(Date.now() - 7 * 86_400_000)),
      sql`not exists (select 1 from nps_responses n where n.appointment_id = ${schema.appointments.id})`,
    ),
    orderBy: (a, { desc }) => desc(a.npsRequestedAt),
  });
  if (!appt) return null;

  await tx.insert(schema.npsResponses).values({ contactId: contact.id, appointmentId: appt.id, score });
  await logEvent(tx, { contactId: contact.id, type: "nps", data: { nota: score, appointmentId: appt.id } });
  const limit = typeof cfg.limiteAlerta === "number" ? cfg.limiteAlerta : 6;

  if (score <= limit) {
    // Detrator: tarefa para a gestão entrar em contato antes que vire avaliação negativa pública
    if (cfg.criarTarefa !== false) {
      await tx.insert(schema.tasks).values({
        contactId: contact.id,
        title: `Recuperar experiência de ${contact.name} (nota ${score})`,
        dueDate: todayIso(),
        kind: "nps_baixo",
      });
    }
    await tx
      .update(schema.contacts)
      .set({ tags: sql`array(select distinct unnest(${schema.contacts.tags} || array['nps-detrator']::text[]))` })
      .where(eq(schema.contacts.id, contact.id));
    await reply("nps_detrator", "nps");
  } else {
    // Promotor (9 ou 10) recebe o link de avaliação, se a clínica cadastrou
    const link = score >= 9 && typeof cfg.linkAvaliacao === "string" ? cfg.linkAvaliacao : "";
    await reply("nps_obrigado", "nps", { link_avaliacao: link });
  }
  return "nps";
}
