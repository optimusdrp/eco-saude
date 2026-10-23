import "server-only";
import {
  buildSentimentPrompt,
  checkSentiment,
  decideSentiment,
  detectSentiment,
  SENTIMENT_HINT,
  SENTIMENT_LABEL,
  SENTIMENT_LEVEL,
  SENTIMENT_RESPONSE_SCHEMA,
  SENTIMENT_THRESHOLD,
  SENTIMENTS,
  todayIso,
  type Sentiment,
  type SentimentMessage,
  type SentimentVerdict,
} from "@ecosaude/core/crm";
import { and, asc, desc, eq, inArray, isNotNull, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";
import { logEvent } from "../journey";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * SENTIMENTO DO PACIENTE (fila + plano B), mesmo desenho da intenção
 *
 *  1. Na ENTRADA da mensagem (webhook, rápido): palavras-chave e sinais objetivos
 *     marcam o sentimento NA HORA e a conversa já sobe na fila, se for o caso.
 *     Se a IA puder revisar, a conversa entra na fila da IA e o aviso à gestão
 *     ESPERA a confirmação (evita alarme falso: "processo de clareamento").
 *  2. LOGO DEPOIS (after) e na rotina de 10 min: a IA lê as últimas mensagens FORA
 *     da transação; o resultado só é gravado se nenhuma mensagem nova chegou.
 *  3. PLANO B: IA sem chave, instável, lenta, com pouca certeza ou conversa com
 *     sinal de urgência (não vai para a IA) = valem as palavras-chave. Se as
 *     palavras-chave já indicam caso grave, a regra vale NA HORA (o aviso não
 *     espera); nos casos leves, falha passageira tenta de novo até 3 vezes.
 *  4. AVISO À GESTÃO: tarefa para hoje, atribuída a alguém da gestão. Uma por
 *     conversa; outra só se o caso piorar (ex.: de irritado para ameaça).
 * Toda decisão vai para ai_sentiments (acerto da IA, correções, avisos).
 */

const MAX_ATTEMPTS = 3;

type Cfg = Record<string, unknown> & { enabled: boolean };
type ConvRef = { id: string; contactId: string; sentimentAlertedLevel: number };

const thresholdOf = (cfg: Cfg) => SENTIMENT_THRESHOLD[String(cfg.nivelAlerta)] ?? 3;
const priorityOf = (cfg: Cfg, level: number) => (cfg.subirFila !== false && level >= thresholdOf(cfg) ? level : 0);

async function recentMessages(tx: Tx, conversationId: string): Promise<SentimentMessage[]> {
  const rows = await tx
    .select({ direction: schema.messages.direction, body: schema.messages.body, createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), inArray(schema.messages.direction, ["in", "out"])))
    .orderBy(desc(schema.messages.createdAt))
    .limit(10);
  return rows.reverse().map((m) => ({ from: m.direction === "in" ? "paciente" : "clinica", text: m.body, at: m.createdAt.getTime() }));
}

/**
 * Avisa a gestão (tarefa para hoje), se o nível passou do limite e piorou desde o
 * último aviso. Devolve se avisou.
 */
async function maybeAlert(tx: Tx, cfg: Cfg, conv: ConvRef, sentiment: Sentiment, level: number, reason: string | null): Promise<boolean> {
  if (cfg.avisarGestao === false || level < thresholdOf(cfg) || level <= conv.sentimentAlertedLevel) return false;
  // Dentro da transação: uma consulta de cada vez
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, conv.contactId), columns: { name: true } });
  // Alguém da gestão (perfil Gestão ativo); sem ninguém, a tarefa fica para a equipe
  const [manager] = await tx
    .select({ id: schema.clinicUsers.id })
    .from(schema.clinicUsers)
    .where(and(eq(schema.clinicUsers.role, "gestor"), eq(schema.clinicUsers.active, true)))
    .orderBy(asc(schema.clinicUsers.name))
    .limit(1);
  await tx.insert(schema.tasks).values({
    contactId: conv.contactId,
    title: `${SENTIMENT_LABEL[sentiment]}: falar com ${contact?.name ?? "o paciente"} (${reason ?? SENTIMENT_HINT[sentiment]})`.slice(0, 200),
    dueDate: todayIso(),
    kind: "sentimento",
    assigneeId: manager?.id ?? null,
  });
  await tx.update(schema.conversations).set({ sentimentAlertedLevel: level }).where(eq(schema.conversations.id, conv.id));
  await logEvent(tx, { contactId: conv.contactId, type: "sentiment_alert", data: { sentimento: SENTIMENT_LABEL[sentiment], motivo: reason } });
  return true;
}

/**
 * PASSO 1 (dentro do webhook): marca pelas palavras-chave e põe na fila da IA.
 * Desligado em Ajustes = não faz nada.
 */
export async function markSentimentOnInbound(tx: Tx, conversationId: string, messageId: string): Promise<void> {
  const cfg = (await automationSettings(tx)).ia_sentimento as Cfg | undefined;
  if (!cfg?.enabled) return;
  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!conv) return;
  const messages = await recentMessages(tx, conversationId);
  const rules = detectSentiment(messages, Date.now());

  // A IA revisa, salvo: sem chave, conversa com sinal de urgência (fica no Tropi) ou mensagem curta e tranquila (economia)
  const lastText = messages.filter((m) => m.from === "paciente").pop()?.text.trim() ?? "";
  const trivial = rules.level === 0 && lastText.length < 4;
  const fallback = !aiConfigured() ? "IA não configurada no servidor" : conv.urgent ? "conversa com sinal de urgência: fica no Tropi, sem IA" : null;
  const review = !fallback && !trivial;

  await tx
    .update(schema.conversations)
    .set({
      sentiment: rules.sentiment,
      sentimentSource: "regras",
      sentimentConfidence: null,
      sentimentReason: rules.signals.join("; ") || null,
      sentimentLevel: rules.level,
      sentimentPriority: priorityOf(cfg, rules.level),
      sentimentPendingMessageId: review ? messageId : null,
      sentimentAttempts: 0,
    })
    .where(eq(schema.conversations.id, conversationId));

  // Sem revisão da IA, a regra é a decisão final: registra e (se for o caso) avisa agora
  if (!review && !trivial) {
    const alerted = await maybeAlert(tx, cfg, conv, rules.sentiment, rules.level, rules.signals[0] ?? null);
    await tx.insert(schema.aiSentiments).values({ conversationId, messageId, rulesSentiment: rules.sentiment, finalSentiment: rules.sentiment, level: rules.level, source: "regras", fallbackReason: fallback, alerted });
  }
}

interface Job {
  conversationId: string;
  messageId: string;
  attempts: number;
  conv: ConvRef;
  messages: SentimentMessage[];
  rules: SentimentVerdict;
}

/** PASSOS 2 a 4: classifica a fila de uma clínica. Devolve quantas a IA decidiu. */
export async function classifyPendingSentiments(clinicId: string, limit = 20): Promise<{ ai: number; rules: number; alerts: number }> {
  const { jobs, cfg } = await withTenant(clinicId, async (tx) => {
    const cfg = (await automationSettings(tx)).ia_sentimento as Cfg | undefined;
    const rows = await tx
      .select({ id: schema.conversations.id, pending: schema.conversations.sentimentPendingMessageId, attempts: schema.conversations.sentimentAttempts, contactId: schema.conversations.contactId, alerted: schema.conversations.sentimentAlertedLevel })
      .from(schema.conversations)
      .where(isNotNull(schema.conversations.sentimentPendingMessageId))
      .limit(limit);
    const jobs: Job[] = [];
    for (const r of rows) {
      const messages = await recentMessages(tx, r.id);
      jobs.push({ conversationId: r.id, messageId: r.pending!, attempts: r.attempts, conv: { id: r.id, contactId: r.contactId, sentimentAlertedLevel: r.alerted }, messages, rules: detectSentiment(messages, Date.now()) });
    }
    return { jobs, cfg };
  });

  let ai = 0;
  let rules = 0;
  let alerts = 0;
  for (const job of jobs) {
    // Desligaram no meio do caminho: só limpa a fila
    if (!cfg?.enabled) {
      await withTenant(clinicId, (tx) => tx.update(schema.conversations).set({ sentimentPendingMessageId: null }).where(eq(schema.conversations.id, job.conversationId)));
      continue;
    }
    // IA fora da transação
    let verdict: ReturnType<typeof checkSentiment> | null = null;
    let fallbackReason: string | null = aiConfigured() ? null : "IA não configurada no servidor";
    let retry = false;
    let meta: { model: string | null; latencyMs: number | null } = { model: null, latencyMs: null };
    if (!fallbackReason) {
      try {
        const { system, user } = buildSentimentPrompt({ messages: job.messages, now: Date.now() });
        const out = await generate({ system, user, schema: SENTIMENT_RESPONSE_SCHEMA, temperature: 0 }, { task: "classify" });
        meta = { model: out.model, latencyMs: out.latencyMs };
        verdict = checkSentiment(out.text);
        if (!verdict.ok) fallbackReason = verdict.reason;
      } catch (error) {
        fallbackReason = error instanceof AiError ? error.reason : "falha inesperada na IA";
        // Caso grave pelas palavras-chave: não espera nova tentativa (a gestão é avisada já, pela regra).
        // Só tenta de novo quando a IA poderia achar algo que as palavras não pegaram (ex.: ironia).
        retry = error instanceof AiError && error.retryable && job.attempts + 1 < MAX_ATTEMPTS && job.rules.level < thresholdOf(cfg);
      }
    }

    await withTenant(clinicId, async (tx) => {
      const stillPending = and(eq(schema.conversations.id, job.conversationId), eq(schema.conversations.sentimentPendingMessageId, job.messageId));
      if (retry) {
        await tx.update(schema.conversations).set({ sentimentAttempts: sql`${schema.conversations.sentimentAttempts} + 1` }).where(stillPending);
        return;
      }
      const minConfidence = typeof cfg.confiancaMinima === "number" ? cfg.confiancaMinima : 70;
      const ok = verdict?.ok ? verdict.verdict : null;
      const decision = ok ? decideSentiment(job.rules, ok, minConfidence) : { sentiment: job.rules.sentiment, level: job.rules.level, source: "regras" as const };
      const reason = decision.source === "ia" ? ok!.reason : job.rules.signals.join("; ") || null;
      const updated = await tx
        .update(schema.conversations)
        .set({
          sentiment: decision.sentiment,
          sentimentSource: decision.source,
          sentimentConfidence: decision.source === "ia" ? ok!.confidence : null,
          sentimentReason: reason,
          sentimentLevel: decision.level,
          sentimentPriority: priorityOf(cfg, decision.level),
          sentimentPendingMessageId: null,
          sentimentAttempts: 0,
        })
        .where(stillPending)
        .returning({ id: schema.conversations.id });
      if (!updated.length) return; // chegou mensagem nova: ela terá a própria análise
      const alerted = await maybeAlert(tx, cfg, job.conv, decision.sentiment, decision.level, reason);
      await tx.insert(schema.aiSentiments).values({
        conversationId: job.conversationId,
        messageId: job.messageId,
        rulesSentiment: job.rules.sentiment,
        aiSentiment: ok?.sentiment ?? null,
        finalSentiment: decision.sentiment,
        level: decision.level,
        confidence: ok?.confidence ?? null,
        source: decision.source,
        model: meta.model,
        latencyMs: meta.latencyMs,
        fallbackReason: ok && decision.source === "regras" ? `certeza da IA abaixo do mínimo (${ok.confidence}%)` : fallbackReason,
        alerted,
      });
      if (alerted) alerts++;
      if (decision.source === "ia") ai++;
      else rules++;
    });
  }
  return { ai, rules, alerts };
}

/** Correção pela equipe: vale na hora, mexe na fila e pode avisar a gestão. */
export async function correctSentiment(tx: Tx, actorId: string | null, conversationId: string, sentiment: Sentiment | null): Promise<void> {
  const cfg = ((await automationSettings(tx)).ia_sentimento as Cfg | undefined) ?? { enabled: false };
  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!conv) return;
  const s: Sentiment = sentiment && (SENTIMENTS as readonly string[]).includes(sentiment) ? sentiment : "calmo";
  const level = SENTIMENT_LEVEL[s];
  await tx
    .update(schema.conversations)
    .set({ sentiment: s, sentimentSource: "equipe", sentimentConfidence: null, sentimentReason: null, sentimentLevel: level, sentimentPriority: priorityOf(cfg, level), sentimentPendingMessageId: null })
    .where(eq(schema.conversations.id, conversationId));
  const alerted = cfg.enabled ? await maybeAlert(tx, cfg, conv, s, level, "marcado pela equipe") : false;
  await tx.insert(schema.aiSentiments).values({
    conversationId,
    rulesSentiment: conv.sentimentSource === "regras" ? conv.sentiment : null,
    aiSentiment: conv.sentimentSource === "ia" ? conv.sentiment : null,
    finalSentiment: s,
    level,
    source: "equipe",
    alerted,
    correctedBy: actorId,
  });
}
