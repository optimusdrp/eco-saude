import "server-only";
import { messagingWindow } from "@ecosaude/channels";
import {
  AI_TONES,
  APPOINTMENT_STATUS_LABEL,
  buildDraftPrompt,
  checkDraft,
  DRAFT_RESPONSE_SCHEMA,
  findFreeSlots,
  firstName,
  formatWhen,
  JOURNEY_STAGE_LABEL,
  ruleDraft,
  urgentDraft,
  type AiTone,
  type Intent,
  type DraftContext,
  type DraftResult,
} from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, gte, inArray, inSequence, ne, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { automationSettings } from "../automation-settings";
import { loadWorkSchedule } from "../hours";
import type { CrmScope } from "../scope";
import { aiConfigured, AiError, generate } from "./provider";
import { roomFilterFor } from "@/modules/crm/units";

/**
 * RASCUNHO DE RESPOSTA (orquestração)
 *
 * Em 3 passos (planDraft -> attemptDraft -> saveDraft) para a chamada à IA ficar
 * FORA da transação do banco.
 *
 *   1. Monta o contexto mínimo: últimas 20 mensagens, primeiro nome, etapa,
 *      próxima consulta, até 6 horários livres reais e as respostas rápidas.
 *   2. Barreiras ANTES da IA (vão direto ao plano B, sem enviar nada para fora):
 *      automação desligada, IA não configurada, conversa com sinal de urgência,
 *      limite de 30 pedidos por pessoa a cada 10 minutos, disjuntor aberto.
 *   3. Mesmo pedido (mesma última mensagem, mesmo tom) nos últimos 30 min: devolve
 *      o rascunho guardado, sem nova chamada (economia), a menos que peça "outro".
 *   4. Chama a IA (modelo principal -> reserva), confere o resultado (checkDraft).
 *   5. Qualquer falha ou recusa: PLANO B por regras, com o motivo visível.
 *   6. Registra em ai_drafts (auditoria e métrica de qualidade).
 */

export interface DraftOutput extends DraftResult {
  id: string;
  source: "ia" | "regras";
  /** Por que não veio da IA (só no plano B) */
  fallbackReason: string | null;
  model: string | null;
  latencyMs: number | null;
  cached: boolean;
  /** Fora da janela de 24h a resposta livre não pode ser enviada */
  windowOpen: boolean;
}

const RATE_LIMIT = 30;
const RATE_WINDOW_MIN = 10;
const CACHE_MIN = 30;

export interface DraftPlan {
  conversationId: string;
  lastMessageId: string | null;
  tone: AiTone;
  urgent: boolean;
  urgentKind: "clinica" | "emocional" | null;
  ctx: DraftContext;
  /** Motivo para NÃO chamar a IA (vai direto ao plano B) */
  blocked: string | null;
  /** Rascunho recente igual (cache) */
  cached: DraftOutput | null;
}

/**
 * PASSO 1 (dentro da transação): monta o contexto e decide se a IA pode ser chamada.
 * A chamada à IA fica FORA da transação: uma IA lenta não pode segurar o banco.
 */
export async function planDraft(tx: Tx, scope: CrmScope, conversationId: string, opts: { regenerate?: boolean } = {}): Promise<DraftPlan> {
  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId), with: { contact: true } });
  if (!conv) throw new UserError("Conversa não encontrada.");

  const cfg = (await automationSettings(tx)).ia_rascunho;
  const tone: AiTone = AI_TONES.includes(cfg?.tom as AiTone) ? (cfg!.tom as AiTone) : "acolhedor";
  const ctx = await buildContext(tx, conv, scope.clinicName, tone);
  const [lastIn] = await tx
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.direction, "in")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  const lastMessageId = lastIn?.id ?? null;
  const base = { conversationId: conv.id, lastMessageId, tone, urgent: conv.urgent, urgentKind: (conv.urgentKind as "clinica" | "emocional" | null) ?? null, ctx };

  // Cache: mesmo pedido há pouco tempo (mesma última mensagem e tom)
  if (!opts.regenerate && lastMessageId) {
    const [hit] = await tx
      .select()
      .from(schema.aiDrafts)
      .where(
        and(
          eq(schema.aiDrafts.conversationId, conv.id),
          eq(schema.aiDrafts.lastMessageId, lastMessageId),
          eq(schema.aiDrafts.tone, tone),
          eq(schema.aiDrafts.source, "ia"),
          gte(schema.aiDrafts.createdAt, new Date(Date.now() - CACHE_MIN * 60_000)),
        ),
      )
      .orderBy(desc(schema.aiDrafts.createdAt))
      .limit(1);
    if (hit) {
      const cached: DraftOutput = { id: hit.id, text: hit.body, intent: null, needsHuman: hit.needsHuman, reason: null, warnings: hit.warnings, source: "ia", fallbackReason: null, model: hit.model, latencyMs: 0, cached: true, windowOpen: ctx.windowOpen };
      return { ...base, blocked: null, cached };
    }
  }

  // Barreiras antes da IA
  let blocked: string | null = null;
  if (!cfg?.enabled) blocked = "a IA está desligada em Ajustes > Inteligência artificial";
  else if (!aiConfigured()) blocked = "IA não configurada no servidor";
  else if (conv.urgent) blocked = "conversa com sinal de urgência: responda pessoalmente";
  else if (!lastMessageId) blocked = "o paciente ainda não escreveu";
  else if (scope.actorId) {
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.aiDrafts)
      .where(and(eq(schema.aiDrafts.requestedBy, scope.actorId), eq(schema.aiDrafts.source, "ia"), gte(schema.aiDrafts.createdAt, new Date(Date.now() - RATE_WINDOW_MIN * 60_000))));
    if ((recent?.n ?? 0) >= RATE_LIMIT) blocked = `limite de ${RATE_LIMIT} rascunhos com IA a cada ${RATE_WINDOW_MIN} minutos`;
  }
  return { ...base, blocked, cached: null };
}

export interface DraftAttempt {
  result: DraftResult;
  source: "ia" | "regras";
  fallbackReason: string | null;
  model: string | null;
  provider: string | null;
  latencyMs: number | null;
  tokens: { in: number | null; out: number | null };
}

/** PASSO 2 (fora da transação): IA com conferência; qualquer falha cai no plano B. */
export async function attemptDraft(plan: DraftPlan): Promise<DraftAttempt> {
  const fallback = (reason: string | null, extra: Partial<DraftAttempt> = {}): DraftAttempt => ({
    result: ruleDraft(plan.ctx),
    source: "regras",
    fallbackReason: reason,
    model: null,
    provider: null,
    latencyMs: null,
    tokens: { in: null, out: null },
    ...extra,
  });
  let attempt: DraftAttempt;
  if (plan.blocked) attempt = fallback(plan.blocked);
  else {
    const started = Date.now();
    try {
      const { system, user } = buildDraftPrompt(plan.ctx);
      const out = await generate({ system, user, schema: DRAFT_RESPONSE_SCHEMA });
      const meta = { model: out.model, provider: out.provider, latencyMs: out.latencyMs, tokens: { in: out.inputTokens, out: out.outputTokens } };
      const checked = checkDraft(out.text, plan.ctx);
      attempt = checked.ok ? { result: checked.result, source: "ia", fallbackReason: null, ...meta } : fallback(checked.reason, meta);
    } catch (error) {
      attempt = fallback(error instanceof AiError ? error.reason : "falha inesperada na IA", { latencyMs: Date.now() - started });
    }
  }
  // Urgência: nunca um texto comum; só a orientação fixa e segura, para a equipe revisar
  if (plan.urgent) {
    attempt.result = {
      ...urgentDraft(plan.ctx.patientFirstName, plan.urgentKind),
      warnings: ["Sinal de urgência nesta conversa: avise o profissional ou a gestão e responda pessoalmente."],
    };
  }
  return attempt;
}

/** PASSO 3 (nova transação): registra o rascunho (auditoria + métrica). */
export async function saveDraft(tx: Tx, scope: CrmScope, plan: DraftPlan, a: DraftAttempt): Promise<DraftOutput> {
  const [row] = await tx
    .insert(schema.aiDrafts)
    .values({
      conversationId: plan.conversationId,
      lastMessageId: plan.lastMessageId,
      requestedBy: scope.actorId,
      source: a.source,
      provider: a.provider,
      model: a.model,
      tone: plan.tone,
      fallbackReason: a.fallbackReason,
      body: a.result.text,
      needsHuman: a.result.needsHuman,
      warnings: a.result.warnings,
      latencyMs: a.latencyMs,
      inputTokens: a.tokens.in === null ? null : Math.round(a.tokens.in),
      outputTokens: a.tokens.out === null ? null : Math.round(a.tokens.out),
    })
    .returning({ id: schema.aiDrafts.id });
  return { ...a.result, id: row!.id, source: a.source, fallbackReason: a.fallbackReason, model: a.model, latencyMs: a.latencyMs, cached: false, windowOpen: plan.ctx.windowOpen };
}

/** Contexto MÍNIMO para a IA (e para o plano B). */
async function buildContext(
  tx: Tx,
  conv: typeof schema.conversations.$inferSelect & { contact: typeof schema.contacts.$inferSelect },
  clinicName: string,
  tone: AiTone,
): Promise<DraftContext> {
  const now = new Date();
  const [messages, next, replies] = await inSequence([
    () =>
      tx
      .select({ direction: schema.messages.direction, body: schema.messages.body, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conv.id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20),
    () =>
      tx.query.appointments.findFirst({
      where: and(eq(schema.appointments.contactId, conv.contactId), gt(schema.appointments.startsAt, now), inArray(schema.appointments.status, ["agendado", "confirmado"])),
      with: { professional: true },
      orderBy: asc(schema.appointments.startsAt),
    }),
    // Respostas rápidas comuns (as de modelo da Meta são avisos de saída, não informação)
    () =>
      tx
      .select({ title: schema.quickReplies.title, body: schema.quickReplies.body })
      .from(schema.quickReplies)
      .where(eq(schema.quickReplies.approvedTemplate, false))
      .orderBy(asc(schema.quickReplies.shortcut))
      .limit(15),
  ] as const);

  // Horários livres: profissional da próxima consulta, senão da última, senão o primeiro ativo
  let pro = next?.professional ?? null;
  if (!pro) {
    const [last] = await tx
      .select({ id: schema.appointments.professionalId })
      .from(schema.appointments)
      .where(eq(schema.appointments.contactId, conv.contactId))
      .orderBy(desc(schema.appointments.startsAt))
      .limit(1);
    pro =
      (last ? await tx.query.professionals.findFirst({ where: and(eq(schema.professionals.id, last.id), eq(schema.professionals.active, true)) }) : null) ??
      (await tx.query.professionals.findFirst({ where: eq(schema.professionals.active, true), orderBy: asc(schema.professionals.name) })) ??
      null;
  }
  let freeSlots: string[] = [];
  if (pro) {
    const busy = await tx
      .select({ startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.professionalId, pro.id), ne(schema.appointments.status, "cancelado"), gt(schema.appointments.endsAt, now)));
    // Só horários com consultório livre (a busca padrão olha 14 dias)
    const rooms = await roomFilterFor(tx, pro, now, new Date(now.getTime() + 15 * 86_400_000));
    freeSlots = findFreeSlots({ schedule: await loadWorkSchedule(tx, pro), busy, from: now, limit: 6, accept: rooms.accept }).map((s) => formatWhen(s.startsAt, now));
  }

  const c = conv.contact;
  return {
    clinicName,
    tone,
    patientFirstName: firstName(c.name),
    stage: JOURNEY_STAGE_LABEL[c.stage],
    tags: c.tags.slice(0, 8),
    optedOut: !!c.optedOutAt,
    nextAppointment: next ? `${formatWhen(next.startsAt, now)} com ${next.professional.name} (${APPOINTMENT_STATUS_LABEL[next.status].toLowerCase()})` : null,
    lastVisit: c.lastVisitAt ? formatWhen(c.lastVisitAt, now) : null,
    freeSlots,
    slotsProfessional: pro?.name ?? null,
    quickReplies: replies,
    messages: messages.reverse().map((m) => ({ from: m.direction === "in" ? "paciente" : m.direction === "note" ? "nota" : "clinica", text: m.body.slice(0, 1200), when: formatWhen(m.createdAt, now) })),
    windowOpen: messagingWindow(conv.channel, conv.lastInboundAt).open,
    // Intenção entendida pela IA (ou corrigida pela equipe) vale mais que as palavras-chave
    knownIntent: conv.intentSource === "ia" || conv.intentSource === "equipe" ? ((conv.intent as Intent | null) ?? null) : undefined,
  };
}

/** O atendente usou, editou ou descartou o rascunho (métrica de qualidade). */
export async function recordDraftOutcome(tx: Tx, draftId: string, outcome: "usado" | "editado" | "descartado", sentBody?: string) {
  await tx
    .update(schema.aiDrafts)
    .set({ outcome, sentBody: sentBody?.slice(0, 2000) ?? null, decidedAt: new Date() })
    .where(and(eq(schema.aiDrafts.id, draftId), sql`${schema.aiDrafts.outcome} is null`));
}
