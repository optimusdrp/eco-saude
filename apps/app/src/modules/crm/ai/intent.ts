import "server-only";
import { buildIntentPrompt, checkIntent, decideIntent, INTENT_RESPONSE_SCHEMA, INTENTS, type Intent, type IntentMessage } from "@ecosaude/core/crm";
import { and, desc, eq, gt, inArray, isNotNull, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * INTENÇÃO COM IA (fila + plano B)
 *
 *  1. Na ENTRADA da mensagem (dentro do webhook, rápido): as palavras-chave marcam
 *     a intenção na hora e, se a IA estiver ligada, a conversa entra na fila
 *     (intent_pending_message_id = a mensagem).
 *  2. LOGO DEPOIS da resposta ao webhook (after) e na rotina de 10 min:
 *     classifyPendingIntents pega a fila, chama a IA FORA da transação e grava
 *     o resultado só se nenhuma mensagem nova chegou nesse meio-tempo.
 *  3. PLANO B: IA desligada, sem chave, instável, lenta ou com pouca certeza =
 *     fica a intenção das palavras-chave (que já estava lá). Falha passageira
 *     tenta de novo na próxima rodada, até 3 vezes; depois desiste.
 * Toda decisão vai para ai_classifications (para medir acerto e discordância).
 */

const MAX_ATTEMPTS = 3;

/** Marca a conversa para a IA revisar a intenção (chamado pela entrada de mensagens). */
export async function queueIntentReview(tx: Tx, conversationId: string, messageId: string): Promise<boolean> {
  if (!(await automationSettings(tx)).ia_intencao?.enabled) return false;
  await tx.update(schema.conversations).set({ intentPendingMessageId: messageId, intentAttempts: 0 }).where(eq(schema.conversations.id, conversationId));
  return true;
}

interface Job {
  conversationId: string;
  messageId: string;
  rulesIntent: Intent | null;
  attempts: number;
  messages: IntentMessage[];
  hasAppointment: boolean;
}

/** Classifica as conversas na fila de uma clínica. Devolve quantas a IA decidiu. */
export async function classifyPendingIntents(clinicId: string, limit = 20): Promise<{ ai: number; rules: number }> {
  // 1. Lê a fila e o contexto (transação curta)
  const { jobs, minConfidence, blocked } = await withTenant(clinicId, async (tx) => {
    const cfg = (await automationSettings(tx)).ia_intencao;
    const rows = await tx
      .select({ id: schema.conversations.id, pending: schema.conversations.intentPendingMessageId, intent: schema.conversations.intent, attempts: schema.conversations.intentAttempts, contactId: schema.conversations.contactId })
      .from(schema.conversations)
      .where(isNotNull(schema.conversations.intentPendingMessageId))
      .limit(limit);
    const jobs: Job[] = [];
    for (const r of rows) {
      const msgs = await tx
        .select({ direction: schema.messages.direction, body: schema.messages.body })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, r.id), inArray(schema.messages.direction, ["in", "out"])))
        .orderBy(desc(schema.messages.createdAt))
        .limit(8);
      const [appt] = await tx
        .select({ id: schema.appointments.id })
        .from(schema.appointments)
        .where(and(eq(schema.appointments.contactId, r.contactId), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])))
        .limit(1);
      jobs.push({
        conversationId: r.id,
        messageId: r.pending!,
        rulesIntent: (INTENTS as readonly string[]).includes(r.intent ?? "") ? (r.intent as Intent) : null,
        attempts: r.attempts,
        messages: msgs.reverse().map((m) => ({ from: m.direction === "in" ? "paciente" : "clinica", text: m.body })),
        hasAppointment: !!appt,
      });
    }
    const blocked = !cfg?.enabled ? "a IA está desligada em Ajustes > Inteligência artificial" : !aiConfigured() ? "IA não configurada no servidor" : null;
    return { jobs, minConfidence: typeof cfg?.confiancaMinima === "number" ? cfg.confiancaMinima : 70, blocked };
  });

  let ai = 0;
  let rules = 0;
  for (const job of jobs) {
    // 2. IA fora da transação
    let verdict: ReturnType<typeof checkIntent> | null = null;
    let fallbackReason = blocked;
    let retry = false;
    let meta: { model: string | null; latencyMs: number | null } = { model: null, latencyMs: null };
    if (!blocked) {
      try {
        const { system, user } = buildIntentPrompt({ messages: job.messages, hasAppointment: job.hasAppointment });
        const out = await generate({ system, user, schema: INTENT_RESPONSE_SCHEMA, temperature: 0 }, { task: "classify" });
        meta = { model: out.model, latencyMs: out.latencyMs };
        verdict = checkIntent(out.text);
        if (!verdict.ok) fallbackReason = verdict.reason;
      } catch (error) {
        fallbackReason = error instanceof AiError ? error.reason : "falha inesperada na IA";
        retry = error instanceof AiError && error.retryable && job.attempts + 1 < MAX_ATTEMPTS;
      }
    }

    // 3. Grava (só se a mensagem na fila ainda é a mesma: nova mensagem = nova classificação)
    await withTenant(clinicId, async (tx) => {
      const stillPending = and(eq(schema.conversations.id, job.conversationId), eq(schema.conversations.intentPendingMessageId, job.messageId));
      if (retry) {
        await tx.update(schema.conversations).set({ intentAttempts: sql`${schema.conversations.intentAttempts} + 1` }).where(stillPending);
        return;
      }
      const ok = verdict?.ok ? verdict.verdict : null;
      const decision = ok ? decideIntent(job.rulesIntent, ok, minConfidence) : { intent: job.rulesIntent, source: "regras" as const };
      const updated = await tx
        .update(schema.conversations)
        .set({
          intent: decision.intent,
          intentSource: decision.source,
          intentConfidence: decision.source === "ia" ? ok!.confidence : null,
          intentReason: decision.source === "ia" ? ok!.reason : null,
          intentPendingMessageId: null,
          intentAttempts: 0,
        })
        .where(stillPending)
        .returning({ id: schema.conversations.id });
      if (!updated.length) return; // chegou mensagem nova: ela terá a própria classificação
      await tx.insert(schema.aiClassifications).values({
        conversationId: job.conversationId,
        messageId: job.messageId,
        rulesIntent: job.rulesIntent,
        aiIntent: ok ? (ok.intent ?? "outro") : null,
        finalIntent: decision.intent,
        confidence: ok?.confidence ?? null,
        source: decision.source,
        model: meta.model,
        latencyMs: meta.latencyMs,
        fallbackReason: ok && decision.source === "regras" ? `certeza da IA abaixo de ${minConfidence}%` : fallbackReason,
      });
      if (decision.source === "ia") ai++;
      else rules++;
    });
  }
  return { ai, rules };
}
