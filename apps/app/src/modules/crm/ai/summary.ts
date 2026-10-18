import "server-only";
import {
  buildSummaryPrompt,
  checkSummary,
  firstName,
  formatWhen,
  INTENTS,
  JOURNEY_STAGE_LABEL,
  APPOINTMENT_STATUS_LABEL,
  ruleSummary,
  SUMMARY_RESPONSE_SCHEMA,
  type Intent,
  type SummaryContext,
  type SummaryMessage,
  type SummaryResult,
} from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, gte, inArray, inSequence, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { automationSettings } from "../automation-settings";
import type { CrmScope } from "../scope";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * RESUMO DA CONVERSA (orquestração) — botão "Resumir"
 *
 * Mesmo desenho do rascunho: 3 passos para a IA ficar FORA da transação.
 *   1. planSummary (transação): lê as últimas N mensagens (N = ajuste da clínica),
 *      o primeiro nome, a etapa, as etiquetas e a próxima consulta. Decide:
 *        - CACHE: já existe resumo que cobre a última mensagem -> devolve, sem custo;
 *        - BARREIRAS (vai direto ao plano B, nada sai do sistema): IA desligada em
 *          Ajustes, sem chave, conversa com sinal de urgência, limite por pessoa.
 *   2. attemptSummary (fora): IA (principal -> reserva) + conferência (checkSummary).
 *      Qualquer falha, demora ou recusa = PLANO B (ruleSummary), com o motivo visível.
 *   3. saveSummary (transação): grava em ai_summaries. O último resumo aparece para
 *      quem abrir a conversa depois, com "N mensagens novas desde o resumo".
 */

const RATE_LIMIT = 30;
const RATE_WINDOW_MIN = 10;
const DEFAULT_READ = 40;

export interface SummaryView extends SummaryResult {
  id: string;
  source: "ia" | "regras";
  fallbackReason: string | null;
  model: string | null;
  /** "hoje às 14:32" */
  when: string;
  /** Quem pediu o resumo */
  by: string | null;
  /** Mensagens que chegaram depois do resumo (0 = em dia) */
  newSince: number;
  helpful: boolean | null;
  cached: boolean;
}

export interface SummaryPlan {
  conversationId: string;
  lastMessageId: string | null;
  urgent: boolean;
  ctx: SummaryContext;
  blocked: string | null;
  cached: SummaryView | null;
}

type SummaryRow = typeof schema.aiSummaries.$inferSelect;

function toView(row: SummaryRow, by: string | null, newSince: number, now: Date, cached = false): SummaryView {
  return {
    id: row.id,
    source: row.source as "ia" | "regras",
    fallbackReason: row.fallbackReason,
    model: row.model,
    headline: row.headline,
    points: row.points,
    nextStep: row.nextStep,
    warnings: row.warnings,
    when: formatWhen(row.createdAt, now),
    by,
    newSince,
    helpful: row.helpful,
    cached,
  };
}

/** Último resumo da conversa (para mostrar a quem abrir depois), ou null. */
export async function latestSummary(tx: Tx, conversationId: string, now = new Date()): Promise<SummaryView | null> {
  const [hit] = await tx
    .select({ row: schema.aiSummaries, by: schema.clinicUsers.name })
    .from(schema.aiSummaries)
    .leftJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.aiSummaries.requestedBy))
    .where(eq(schema.aiSummaries.conversationId, conversationId))
    .orderBy(desc(schema.aiSummaries.createdAt))
    .limit(1);
  if (!hit) return null;
  // Quantas mensagens chegaram depois da última que o resumo cobriu
  const [n] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        hit.row.lastMessageId
          ? sql`${schema.messages.createdAt} > (select created_at from messages where id = ${hit.row.lastMessageId})`
          : sql`true`,
      ),
    );
  return toView(hit.row, hit.by ? firstName(hit.by) : null, n?.n ?? 0, now);
}

/** PASSO 1 (dentro da transação): contexto mínimo + cache + barreiras. */
export async function planSummary(tx: Tx, scope: CrmScope, conversationId: string, opts: { regenerate?: boolean } = {}): Promise<SummaryPlan> {
  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId), with: { contact: true } });
  if (!conv) throw new UserError("Conversa não encontrada.");
  const now = new Date();
  const cfg = (await automationSettings(tx)).ia_resumo;
  const read = typeof cfg?.mensagens === "number" ? cfg.mensagens : DEFAULT_READ;

  const [messages, total, next] = await inSequence([
    () =>
      tx
        .select({ id: schema.messages.id, direction: schema.messages.direction, body: schema.messages.body, createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conv.id))
        .orderBy(desc(schema.messages.createdAt))
        .limit(read),
    () => tx.select({ n: sql<number>`count(*)::int` }).from(schema.messages).where(eq(schema.messages.conversationId, conv.id)),
    () =>
      tx.query.appointments.findFirst({
        where: and(eq(schema.appointments.contactId, conv.contactId), gt(schema.appointments.startsAt, now), inArray(schema.appointments.status, ["agendado", "confirmado"])),
        with: { professional: true },
        orderBy: asc(schema.appointments.startsAt),
      }),
  ] as const);
  const lastMessageId = messages[0]?.id ?? null;
  if (!lastMessageId) throw new UserError("Ainda não há mensagens para resumir.");

  const c = conv.contact;
  const ctx: SummaryContext = {
    patientFirstName: firstName(c.name),
    stage: JOURNEY_STAGE_LABEL[c.stage],
    tags: c.tags.slice(0, 8),
    nextAppointment: next ? `${formatWhen(next.startsAt, now)} com ${next.professional.name} (${APPOINTMENT_STATUS_LABEL[next.status].toLowerCase()})` : null,
    intent: (INTENTS as readonly string[]).includes(conv.intent ?? "") ? (conv.intent as Intent) : null,
    optedOut: !!c.optedOutAt,
    messages: messages.reverse().map(
      (m): SummaryMessage => ({ from: m.direction === "in" ? "paciente" : m.direction === "note" ? "nota" : "clinica", text: m.body.slice(0, 1200), when: formatWhen(m.createdAt, now), at: m.createdAt.getTime() }),
    ),
    totalMessages: total[0]?.n ?? messages.length,
    now: now.getTime(),
  };
  const base = { conversationId: conv.id, lastMessageId, urgent: conv.urgent, ctx };

  // Cache: o último resumo já cobre a última mensagem (economia: nenhuma chamada nova)
  if (!opts.regenerate) {
    const last = await latestSummary(tx, conv.id, now);
    if (last && last.newSince === 0) return { ...base, blocked: null, cached: { ...last, cached: true } };
  }

  let blocked: string | null = null;
  if (!cfg?.enabled) blocked = "a IA está desligada em Ajustes > Inteligência artificial";
  else if (!aiConfigured()) blocked = "IA não configurada no servidor";
  else if (conv.urgent) blocked = "conversa com sinal de urgência: o resumo fica no CRM, sem IA";
  else if (scope.actorId) {
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.aiSummaries)
      .where(and(eq(schema.aiSummaries.requestedBy, scope.actorId), eq(schema.aiSummaries.source, "ia"), gte(schema.aiSummaries.createdAt, new Date(Date.now() - RATE_WINDOW_MIN * 60_000))));
    if ((recent?.n ?? 0) >= RATE_LIMIT) blocked = `limite de ${RATE_LIMIT} resumos com IA a cada ${RATE_WINDOW_MIN} minutos`;
  }
  return { ...base, blocked, cached: null };
}

export interface SummaryAttempt {
  result: SummaryResult;
  source: "ia" | "regras";
  fallbackReason: string | null;
  model: string | null;
  latencyMs: number | null;
  tokens: { in: number | null; out: number | null };
}

/** PASSO 2 (fora da transação): IA com conferência; qualquer falha cai no plano B. */
export async function attemptSummary(plan: SummaryPlan): Promise<SummaryAttempt> {
  const fallback = (reason: string | null, extra: Partial<SummaryAttempt> = {}): SummaryAttempt => ({
    result: ruleSummary(plan.ctx),
    source: "regras",
    fallbackReason: reason,
    model: null,
    latencyMs: null,
    tokens: { in: null, out: null },
    ...extra,
  });
  let attempt: SummaryAttempt;
  if (plan.blocked) attempt = fallback(plan.blocked);
  else {
    const started = Date.now();
    try {
      const { system, user } = buildSummaryPrompt(plan.ctx);
      const out = await generate({ system, user, schema: SUMMARY_RESPONSE_SCHEMA, temperature: 0.2 });
      const meta = { model: out.model, latencyMs: out.latencyMs, tokens: { in: out.inputTokens, out: out.outputTokens } };
      const checked = checkSummary(out.text, plan.ctx);
      attempt = checked.ok ? { result: checked.result, source: "ia", fallbackReason: null, ...meta } : fallback(checked.reason, meta);
    } catch (error) {
      attempt = fallback(error instanceof AiError ? error.reason : "falha inesperada na IA", { latencyMs: Date.now() - started });
    }
  }
  if (plan.urgent) attempt.result.warnings = ["Sinal de urgência nesta conversa: confira a orientação no topo antes de qualquer coisa.", ...attempt.result.warnings];
  return attempt;
}

/** PASSO 3 (nova transação): grava o resumo (auditoria, métrica e "último resumo" da conversa). */
export async function saveSummary(tx: Tx, scope: CrmScope, plan: SummaryPlan, a: SummaryAttempt): Promise<SummaryView> {
  const [row] = await tx
    .insert(schema.aiSummaries)
    .values({
      conversationId: plan.conversationId,
      lastMessageId: plan.lastMessageId,
      messagesRead: plan.ctx.messages.length,
      requestedBy: scope.actorId,
      source: a.source,
      model: a.model,
      fallbackReason: a.fallbackReason,
      headline: a.result.headline,
      points: a.result.points,
      nextStep: a.result.nextStep,
      warnings: a.result.warnings,
      latencyMs: a.latencyMs,
      inputTokens: a.tokens.in === null ? null : Math.round(a.tokens.in),
      outputTokens: a.tokens.out === null ? null : Math.round(a.tokens.out),
    })
    .returning();
  const me = scope.actorId ? await tx.query.clinicUsers.findFirst({ where: eq(schema.clinicUsers.id, scope.actorId), columns: { name: true } }) : null;
  return toView(row!, me ? firstName(me.name) : null, 0, new Date());
}

/** "Ajudou" / "Não ajudou" (mede se vale manter a IA ligada). */
export async function rateSummary(tx: Tx, summaryId: string, helpful: boolean) {
  await tx.update(schema.aiSummaries).set({ helpful }).where(eq(schema.aiSummaries.id, summaryId));
}
