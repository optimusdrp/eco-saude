"use server";

import { randomUUID } from "node:crypto";
import { attachmentLabel, CRM_FEATURES, formatBytes, INTENTS, MAX_ATTACHMENT_BYTES, SENTIMENTS } from "@ecosaude/core/crm";
import { sendMessageSchema, startConversationSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { eq, schema, type Tx } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { recordDraftOutcome } from "../ai/draft";
import { notePromiseCandidate, undoPromiseTask } from "../ai/promises";
import { runAiQueues } from "../ai/queue";
import { correctSentiment } from "../ai/sentiment";
import { logEvent } from "../journey";
import { addInternalNote, ensureConversation, queueOutbound, recipientFor } from "../messaging";
import { runCrm } from "../run";
import { storeFile, type StoredFile } from "../files/attachments";
import { getStorage, storageStatus } from "../files/storage";
import type { CrmScope } from "../scope";

/** Ações da mesa de atendimento (conversas). */

/** Mesmo texto ignorando espaços extras (rascunho "usado como veio"). */
const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

function refresh(conversationId?: string) {
  revalidatePath("/crm/conversas", "layout");
  if (conversationId) revalidatePath(`/crm/conversas/${conversationId}`);
  revalidatePath("/hoje");
}

export async function sendMessageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return NOT_ALLOWED;
  const parsed = sendMessageSchema.safeParse({
    conversationId: field(form, "conversationId"),
    body: field(form, "body"),
    internal: form.get("internal") === "on",
    clientId: field(form, "clientId"),
    templateId: field(form, "templateId"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: { body: field(form, "body") } };
  const d = parsed.data;
  const aiDraftId = z.uuid().safeParse(field(form, "aiDraftId")).success ? field(form, "aiDraftId") : null;

  // Anexo (opcional): conferido PELO CONTEÚDO e guardado ANTES da transação (disco/S3 não
  // prende o banco). Se a mensagem não for gravada, o arquivo é removido em seguida.
  const upload = form.get("file");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  if (!d.body && !file) return { ok: false, errors: { body: "Escreva a mensagem ou anexe um arquivo." }, values: { body: d.body } };
  if (file && d.internal) return { ok: false, message: "Notas internas são só texto: o anexo vai apenas em mensagens para o paciente.", values: { body: d.body } };
  let stored: (StoredFile & { id: string }) | null = null;
  if (file) {
    const st = storageStatus();
    if (!st.ok) return { ok: false, message: `Anexos indisponíveis: ${st.reason}`, values: { body: d.body } };
    if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, message: `Arquivo com ${formatBytes(file.size)}: o limite é ${formatBytes(MAX_ATTACHMENT_BYTES)}.`, values: { body: d.body } };
    const id = randomUUID();
    const r = await storeFile(ctx.user.clinicId, id, new Uint8Array(await file.arrayBuffer()), file.type, file.name);
    if (!r.ok) return { ok: false, message: r.reason, values: { body: d.body } };
    stored = { ...r.file, id };
  }
  // Sem texto: a mensagem mostra o tipo do arquivo ("[imagem]", "[documento: laudo.pdf]")
  const body = d.body || (stored ? attachmentLabel(stored.kind, stored.fileName) : "");

  try {
    // Promessa na mensagem ("vou te mandar o orçamento amanhã")? A IA lê logo depois do envio
    const promiseQueued = await runCrm(
      ctx,
      async (tx, scope) => {
        const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, d.conversationId) });
        if (!conv) throw new UserError("Conversa não encontrada.");
        const checkPromise = (messageId: string) => notePromiseCandidate(tx, { conversationId: conv.id, messageId, text: d.body, authorId: scope.actorId, side: "clinica" });
        if (d.internal) {
          // Nota interna também vale ("ligar pra ela amanhã")
          const note = await addInternalNote(tx, conv, d.body, scope.actorId!, d.clientId);
          return note ? checkPromise(note.id) : false;
        }
        // Modelo aprovado (resposta rápida marcada como modelo): liberado fora da janela de 24h
        let templateKey: string | null = null;
        if (d.templateId) {
          const qr = await tx.query.quickReplies.findFirst({ where: eq(schema.quickReplies.id, d.templateId) });
          if (qr?.approvedTemplate) templateKey = qr.shortcut;
        }
        const sent = await queueOutbound(tx, { conversation: conv, body, authorId: scope.actorId, clientId: d.clientId, templateKey, attachment: stored });
        // Veio de um rascunho sugerido? Registra se foi usado como veio ou editado
        if (sent && aiDraftId) {
          const [draft] = await tx.select({ body: schema.aiDrafts.body }).from(schema.aiDrafts).where(eq(schema.aiDrafts.id, aiDraftId));
          if (draft) await recordDraftOutcome(tx, aiDraftId, sameText(draft.body, d.body) ? "usado" : "editado", d.body);
        }
        // Modelo aprovado é texto fixo da clínica: não é promessa de ninguém (nem só um arquivo)
        return sent && !templateKey && d.body ? checkPromise(sent.id) : false;
      },
      { dispatch: !d.internal },
    );
    if (promiseQueued) after(() => runAiQueues(ctx.user.clinicId).then(() => undefined));
  } catch (error) {
    // A mensagem não foi gravada: o arquivo guardado não pode ficar órfão
    if (stored)
      await getStorage()
        .then((st) => st.delete(stored.storageKey))
        .catch((e) => console.error("[anexo órfão]", stored?.storageKey, e));
    return { ...toActionError(error), values: { body: d.body } };
  }
  refresh(d.conversationId);
  return { ok: true };
}

type ConversationOp = "resolver" | "reabrir" | "assumir" | "adiar" | "limpar_urgencia" | "atribuir";

/**
 * Aplica UMA operação numa conversa (usada pela ação individual e pela em lote).
 * Devolve o nome de quem recebeu a conversa (op "atribuir").
 */
async function applyConversationOp(tx: Tx, scope: CrmScope, id: string, op: ConversationOp, opts: { hours?: number; assigneeId?: string | null }): Promise<string | null> {
  if (op === "atribuir") {
    const target = opts.assigneeId || null;
    let assigneeName: string | null = null;
    if (target) {
      // RLS: só encontra usuários desta clínica; desativado não recebe conversa
      const [u] = await tx.select({ name: schema.clinicUsers.name, active: schema.clinicUsers.active }).from(schema.clinicUsers).where(eq(schema.clinicUsers.id, target));
      if (!u?.active) throw new UserError("Usuário não encontrado ou desativado.");
      assigneeName = u.name;
    }
    const [conv] = await tx.update(schema.conversations).set({ assigneeId: target }).where(eq(schema.conversations.id, id)).returning({ contactId: schema.conversations.contactId });
    if (conv) await logEvent(tx, { contactId: conv.contactId, actorId: scope.actorId, type: "conversation_assigned", data: { para: assigneeName } });
    return assigneeName;
  }
  const set: Partial<typeof schema.conversations.$inferInsert> = {};
  if (op === "resolver")
    Object.assign(set, {
      status: "resolvida",
      awaitingReplySince: null,
      unreadCount: 0,
      urgent: false,
      urgentKind: null,
      intent: null,
      intentSource: null,
      intentConfidence: null,
      intentReason: null,
      intentPendingMessageId: null,
      snoozedUntil: null,
      sentiment: null,
      sentimentSource: null,
      sentimentConfidence: null,
      sentimentReason: null,
      sentimentLevel: 0,
      sentimentPriority: 0,
      sentimentAlertedLevel: 0,
      sentimentPendingMessageId: null,
    });
  if (op === "reabrir") Object.assign(set, { status: "aberta" });
  if (op === "assumir") Object.assign(set, { assigneeId: scope.actorId });
  if (op === "adiar") Object.assign(set, { snoozedUntil: new Date(Date.now() + (opts.hours ?? 2) * 3_600_000) });
  if (op === "limpar_urgencia") Object.assign(set, { urgent: false, urgentKind: null });
  await tx.update(schema.conversations).set(set).where(eq(schema.conversations.id, id));
  return null;
}

const opSchema = z.enum(["resolver", "reabrir", "assumir", "adiar", "limpar_urgencia", "atribuir"]);
const hoursText = (h?: number) => (h && h >= 24 ? `${Math.round(h / 24)} dia${h >= 48 ? "s" : ""}` : `${h ?? 2} h`);

/** Status, responsável, adiar, limpar urgência. */
export async function updateConversationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({
      id: z.uuid(),
      op: opSchema,
      hours: z.coerce.number().int().min(1).max(72).optional(),
      /** Transferir para um colega ("" = ninguém) */
      assigneeId: z.union([z.uuid(), z.literal("")]).optional(),
    })
    .safeParse({ id: field(form, "id"), op: field(form, "op"), hours: field(form, "hours") || undefined, assigneeId: field(form, "assigneeId") });
  if (!parsed.success) return { ok: false, message: "Ação inválida." };
  const { id, op, hours } = parsed.data;
  let assigneeName: string | null = null;

  try {
    await runCrm(ctx, async (tx, scope) => {
      assigneeName = await applyConversationOp(tx, scope, id, op, { hours, assigneeId: parsed.data.assigneeId });
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh(id);
  const messages = {
    resolver: "Conversa resolvida.",
    reabrir: "Conversa reaberta.",
    assumir: "Você assumiu esta conversa.",
    adiar: `Conversa adiada por ${hoursText(hours)}. Ela volta para a fila sozinha.`,
    limpar_urgencia: "Alerta de urgência removido.",
    atribuir: assigneeName ? `Conversa transferida para ${assigneeName}.` : "Conversa sem responsável.",
  };
  return { ok: true, message: messages[op], data: { op } };
}

/**
 * AÇÕES EM LOTE: resolver, assumir, adiar ou transferir várias conversas
 * de uma vez (ex.: limpar a fila depois de um aviso geral). Tudo numa
 * transação: ou todas mudam, ou nenhuma.
 */
export async function bulkConversationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.massa");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({
      ids: z.array(z.uuid()).min(1).max(200),
      op: z.enum(["resolver", "reabrir", "assumir", "adiar", "atribuir"]),
      hours: z.coerce.number().int().min(1).max(72).optional(),
      assigneeId: z.union([z.uuid(), z.literal("")]).optional(),
    })
    .safeParse({ ids: form.getAll("id"), op: field(form, "op"), hours: field(form, "hours") || undefined, assigneeId: field(form, "assigneeId") });
  if (!parsed.success) return { ok: false, message: "Escolha ao menos uma conversa." };
  const { ids, op, hours, assigneeId } = parsed.data;
  let assigneeName: string | null = null;
  try {
    await runCrm(ctx, async (tx, scope) => {
      for (const id of ids) assigneeName = await applyConversationOp(tx, scope, id, op, { hours, assigneeId });
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  const n = ids.length;
  const plural = n === 1 ? "conversa" : "conversas";
  const messages = {
    resolver: `${n} ${plural} resolvida${n === 1 ? "" : "s"}.`,
    reabrir: `${n} ${plural} reaberta${n === 1 ? "" : "s"}.`,
    assumir: `Você assumiu ${n} ${plural}.`,
    adiar: `${n} ${plural} adiada${n === 1 ? "" : "s"} por ${hoursText(hours)}.`,
    atribuir: assigneeName ? `${n} ${plural} transferida${n === 1 ? "" : "s"} para ${assigneeName}.` : `${n} ${plural} sem responsável.`,
  };
  return { ok: true, message: messages[op] };
}

/** Ao abrir a conversa, zera o contador de não lidas. */
export async function markConversationReadAction(conversationId: string): Promise<void> {
  const ctx = await authorizeCrm("conversas.ver");
  if (!ctx || !z.uuid().safeParse(conversationId).success) return;
  await runCrm(ctx, (tx) => tx.update(schema.conversations).set({ unreadCount: 0 }).where(eq(schema.conversations.id, conversationId)));
}

/**
 * INICIAR CONVERSA pela ficha do paciente (ou pelo trilho).
 * Abre (ou reaproveita) a conversa do canal escolhido e leva para ela.
 * Só canais pelos quais dá para alcançar a pessoa: identidade conhecida no
 * canal ou, no WhatsApp, o celular do cadastro. Telegram/Instagram/Messenger
 * só permitem escrever para quem já falou com a clínica (regra dos provedores).
 * Como o paciente ainda não escreveu, a janela de 24h está fechada: a caixa
 * de mensagem já mostra só os modelos aprovados.
 */
export async function startConversationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.iniciar", CRM_FEATURES.inbox);
  if (!ctx) return NOT_ALLOWED;
  const parsed = startConversationSchema.safeParse({ contactId: field(form, "contactId"), channel: field(form, "channel") });
  if (!parsed.success) return { ok: false, message: "Escolha o canal." };
  const { contactId, channel } = parsed.data;

  let conversationId: string;
  try {
    conversationId = await runCrm(ctx, async (tx, scope) => {
      const to = await recipientFor(tx, contactId, channel);
      if (!to) throw new UserError(channel === "whatsapp" ? "Cadastre o celular do paciente para falar pelo WhatsApp." : "Este paciente ainda não falou com a clínica por este canal.");
      const conv = await ensureConversation(tx, contactId, channel);
      await logEvent(tx, { contactId, actorId: scope.actorId, type: "conversation_started", data: { canal: channel } });
      return conv.id;
    });
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/crm/conversas");
  redirect(`/crm/conversas/${conversationId}`);
}

/**
 * A equipe corrige a intenção (ex.: a IA ou as palavras-chave erraram).
 * A correção vale na hora e fica registrada para medir o acerto da IA.
 */
export async function setIntentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z.object({ id: z.uuid(), intent: z.union([z.enum(INTENTS), z.literal("")]) }).safeParse({ id: field(form, "id"), intent: field(form, "intent") });
  if (!parsed.success) return { ok: false, message: "Escolha uma intenção." };
  const { id, intent } = parsed.data;
  try {
    await runCrm(ctx, async (tx, scope) => {
      const [before] = await tx.select({ intent: schema.conversations.intent, source: schema.conversations.intentSource }).from(schema.conversations).where(eq(schema.conversations.id, id));
      if (!before) throw new UserError("Conversa não encontrada.");
      await tx
        .update(schema.conversations)
        .set({ intent: intent || null, intentSource: "equipe", intentConfidence: null, intentReason: null, intentPendingMessageId: null })
        .where(eq(schema.conversations.id, id));
      await tx.insert(schema.aiClassifications).values({
        conversationId: id,
        rulesIntent: before.source === "regras" ? before.intent : null,
        aiIntent: before.source === "ia" ? (before.intent ?? "outro") : null,
        finalIntent: intent || null,
        source: "equipe",
        correctedBy: scope.actorId,
      });
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh(id);
  return { ok: true, message: "Intenção corrigida." };
}

/**
 * A equipe corrige o sentimento ("na verdade está irritado", "já se acalmou").
 * Vale na hora, mexe na fila, pode avisar a gestão e entra na medição da IA.
 */
export async function setSentimentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z.object({ id: z.uuid(), sentiment: z.enum(SENTIMENTS) }).safeParse({ id: field(form, "id"), sentiment: field(form, "sentiment") });
  if (!parsed.success) return { ok: false, message: "Escolha um sentimento." };
  try {
    await runCrm(ctx, (tx, scope) => correctSentiment(tx, scope.actorId, parsed.data.id, parsed.data.sentiment));
  } catch (error) {
    return toActionError(error);
  }
  refresh(parsed.data.id);
  return { ok: true, message: "Sentimento corrigido." };
}

/** "Não era promessa": apaga a tarefa criada automaticamente (e conta como falso positivo). */
export async function undoPromiseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Tarefa inválida." };
  const ok = await runCrm(ctx, (tx, scope) => undoPromiseTask(tx, scope.actorId, id.data));
  const conv = z.uuid().safeParse(field(form, "conversationId"));
  if (conv.success) refresh(conv.data);
  return ok ? { ok: true, message: "Lembrete apagado." } : { ok: false, message: "Esta tarefa já foi concluída ou apagada." };
}
