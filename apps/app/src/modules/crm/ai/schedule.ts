import "server-only";
import {
  buildScheduleCalendar,
  buildSchedulePrompt,
  checkScheduleExtraction,
  describeScheduleRequest,
  findFreeSlots,
  formatWhen,
  hasWhen,
  matchSlots,
  ruleScheduleExtraction,
  SCHEDULE_RESPONSE_SCHEMA,
  utcToZoned,
  type CalendarDay,
  type ScheduleMessage,
  type ScheduleProfessional,
  type ScheduleRequest,
} from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, gte, inArray, inSequence, isNotNull, lt, ne, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import type { FreeSlot, ScheduleSuggestion } from "@/lib/events";
import { automationSettings } from "../automation-settings";
import { loadWorkSchedule } from "../hours";
import type { CrmScope } from "../scope";
import { aiConfigured, AiError, generate } from "./provider";
import { roomFilterFor } from "@/modules/crm/units";

/**
 * AGENDAR PELO PEDIDO (orquestração)
 *
 * Mesmo desenho das outras funcionalidades de IA: 3 passos, IA FORA da transação.
 *   1. planSchedule (transação): últimas 8 mensagens (sem notas internas), lista de
 *      profissionais e serviços, calendário dos próximos N dias. Barreiras que vão
 *      direto ao plano B: IA desligada em Ajustes, sem chave, conversa com sinal de
 *      urgência, limite por pessoa.
 *   2. attemptSchedule (fora): IA + conferência. Falha, demora, resposta recusada ou
 *      certeza abaixo de 40% = PLANO B (expressões do Tropi), com o motivo visível.
 *   3. saveSchedule (transação): calcula os HORÁRIOS LIVRES REAIS do profissional e
 *      filtra pelo pedido; grava o que foi entendido e os horários sugeridos em
 *      ai_schedule_suggestions (auditoria e medição: virou consulta? usou o sugerido?).
 * A tela abre o agendamento preenchido; quem confirma é sempre a recepção.
 */

const RATE_LIMIT = 30;
const RATE_WINDOW_MIN = 10;
const MIN_CONFIDENCE = 40;
const SHOW = 9;

export interface SchedulePlan {
  conversationId: string;
  calendar: CalendarDay[];
  professionals: ScheduleProfessional[];
  services: string[];
  messages: ScheduleMessage[];
  /** Profissional da próxima/última consulta (quando o paciente não citou ninguém) */
  defaultProfessionalId: string | null;
  /** "qui, 23/10 às 14:30 com Dra. Beatriz" (aviso de possível remarcação) */
  existing: string | null;
  urgent: boolean;
  blocked: string | null;
}

export async function planSchedule(tx: Tx, scope: CrmScope, conversationId: string): Promise<SchedulePlan> {
  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!conv) throw new UserError("Conversa não encontrada.");
  const now = new Date();
  const cfg = (await automationSettings(tx)).ia_agendar;
  const days = typeof cfg?.diasAFrente === "number" ? cfg.diasAFrente : 21;

  const [pros, services, msgs, next, last] = await inSequence([
    () => tx.select({ id: schema.professionals.id, name: schema.professionals.name, specialty: schema.professionals.specialty }).from(schema.professionals).where(eq(schema.professionals.active, true)).orderBy(asc(schema.professionals.name)),
    // Serviços que a clínica já usa (os mais comuns dos últimos 6 meses): a IA prefere estes nomes
    () =>
      tx
        .select({ service: schema.appointments.service, n: sql<number>`count(*)::int` })
        .from(schema.appointments)
        .where(and(isNotNull(schema.appointments.service), gt(schema.appointments.startsAt, new Date(Date.now() - 180 * 86_400_000))))
        .groupBy(schema.appointments.service)
        .orderBy(desc(sql`count(*)`))
        .limit(20),
    () =>
      tx
        .select({ direction: schema.messages.direction, body: schema.messages.body })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conv.id), inArray(schema.messages.direction, ["in", "out"])))
        .orderBy(desc(schema.messages.createdAt))
        .limit(8),
    () =>
      tx.query.appointments.findFirst({
        where: and(eq(schema.appointments.contactId, conv.contactId), gt(schema.appointments.startsAt, now), inArray(schema.appointments.status, ["agendado", "confirmado"])),
        with: { professional: true },
        orderBy: asc(schema.appointments.startsAt),
      }),
    () => tx.select({ professionalId: schema.appointments.professionalId }).from(schema.appointments).where(eq(schema.appointments.contactId, conv.contactId)).orderBy(desc(schema.appointments.startsAt)).limit(1),
  ] as const);

  const messages = msgs.reverse().map((m): ScheduleMessage => ({ from: m.direction === "in" ? "paciente" : "clinica", text: m.body.slice(0, 800) }));
  const active = new Set(pros.map((p) => p.id));
  const preferred = [next?.professionalId, last[0]?.professionalId].find((id) => id && active.has(id)) ?? pros[0]?.id ?? null;

  let blocked: string | null = null;
  if (!messages.some((m) => m.from === "paciente")) blocked = "o paciente ainda não escreveu";
  else if (!cfg?.enabled) blocked = "a IA está desligada em Ajustes > Inteligência artificial";
  else if (!aiConfigured()) blocked = "IA não configurada no servidor";
  else if (conv.urgent) blocked = "conversa com sinal de urgência: atenda pessoalmente";
  else if (scope.actorId) {
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.aiScheduleSuggestions)
      .where(and(eq(schema.aiScheduleSuggestions.requestedBy, scope.actorId), eq(schema.aiScheduleSuggestions.source, "ia"), gte(schema.aiScheduleSuggestions.createdAt, new Date(Date.now() - RATE_WINDOW_MIN * 60_000))));
    if ((recent?.n ?? 0) >= RATE_LIMIT) blocked = `limite de ${RATE_LIMIT} leituras com IA a cada ${RATE_WINDOW_MIN} minutos`;
  }

  return {
    conversationId: conv.id,
    calendar: buildScheduleCalendar(utcToZoned(now).date, days),
    professionals: pros,
    services: services.map((s) => s.service!).filter(Boolean),
    messages,
    defaultProfessionalId: preferred,
    existing: next ? `${formatWhen(next.startsAt, now)} com ${next.professional.name}` : null,
    urgent: conv.urgent,
    blocked,
  };
}

export interface ScheduleAttempt {
  request: ScheduleRequest;
  source: "ia" | "regras";
  fallbackReason: string | null;
  confidence: number | null;
  model: string | null;
  latencyMs: number | null;
  tokens: { in: number | null; out: number | null };
}

/** PASSO 2 (fora da transação): IA com conferência; qualquer problema cai no plano B. */
export async function attemptSchedule(plan: SchedulePlan): Promise<ScheduleAttempt> {
  const input = { messages: plan.messages, professionals: plan.professionals, services: plan.services, calendar: plan.calendar };
  const fallback = (reason: string | null, extra: Partial<ScheduleAttempt> = {}): ScheduleAttempt => ({
    request: ruleScheduleExtraction(input),
    source: "regras",
    fallbackReason: reason,
    confidence: null,
    model: null,
    latencyMs: null,
    tokens: { in: null, out: null },
    ...extra,
  });
  if (plan.blocked) return fallback(plan.blocked);
  const started = Date.now();
  try {
    const { system, user } = buildSchedulePrompt(input);
    const out = await generate({ system, user, schema: SCHEDULE_RESPONSE_SCHEMA, temperature: 0 }, { task: "classify" });
    const meta = { model: out.model, latencyMs: out.latencyMs, tokens: { in: out.inputTokens, out: out.outputTokens } };
    const checked = checkScheduleExtraction(out.text, plan);
    if (!checked.ok) return fallback(checked.reason, meta);
    if (checked.confidence < MIN_CONFIDENCE) return fallback(`a IA ficou com pouca certeza (${checked.confidence}%)`, { ...meta, confidence: checked.confidence });
    return { request: checked.request, source: "ia", fallbackReason: null, confidence: checked.confidence, ...meta };
  } catch (error) {
    return fallback(error instanceof AiError ? error.reason : "falha inesperada na IA", { latencyMs: Date.now() - started });
  }
}

/** PASSO 3 (transação): horários livres REAIS filtrados pelo pedido + registro. */
export async function saveSchedule(tx: Tx, scope: CrmScope, plan: SchedulePlan, a: ScheduleAttempt): Promise<ScheduleSuggestion> {
  const r = a.request;
  const proId = r.professionalId ?? plan.defaultProfessionalId;
  const warnings: string[] = [];
  let slots: FreeSlot[] = [];

  const pro = proId ? await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, proId) }) : null;
  if (!pro) throw new UserError("Cadastre um profissional ativo em Ajustes > Clínica e profissionais.");
  const now = new Date();
  const until = new Date(now.getTime() + (plan.calendar.length + 1) * 86_400_000);
  const busy = await tx
    .select({ startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.professionalId, pro.id), ne(schema.appointments.status, "cancelado"), gt(schema.appointments.endsAt, now), lt(schema.appointments.startsAt, until)));
  // Só horários com consultório livre (mesma regra da marcação)
  const rooms = await roomFilterFor(tx, pro, now, until);
  const free: FreeSlot[] = findFreeSlots({ schedule: await loadWorkSchedule(tx, pro), busy, from: now, days: plan.calendar.length, limit: 500, period: r.period, accept: rooms.accept }).map((s) => {
    const z = utcToZoned(s.startsAt);
    return { startsAt: s.startsAt.toISOString(), date: z.date, time: z.time, label: formatWhen(s.startsAt, now) };
  });

  const chips = describeScheduleRequest(r, plan);
  if (!hasWhen(r)) {
    slots = free.slice(0, SHOW);
    if (plan.messages.some((m) => m.from === "paciente")) warnings.push("O paciente não disse dia nem período: estes são os próximos horários livres.");
  } else {
    slots = matchSlots(free, r).slice(0, SHOW);
    if (!slots.length) {
      slots = matchSlots(free, r, { strict: false }).slice(0, SHOW);
      warnings.push(
        slots.length
          ? `${pro.name} não tem horário livre ${chips.filter((c) => !c.includes(pro.name)).slice(0, 2).join(" ") || "no pedido"}. Estes são os mais próximos no mesmo período.`
          : `${pro.name} não tem horário livre nesse período nos próximos ${plan.calendar.length} dias.`,
      );
    }
  }
  if (!r.professionalId && plan.professionals.length > 1) warnings.push(`O paciente não citou profissional: mostrando ${pro.name}${proId === plan.defaultProfessionalId ? " (o da última consulta)" : ""}. Troque se precisar.`);
  if (plan.existing) warnings.push(`Já tem consulta ${plan.existing}. Se for remarcação, desmarque a anterior depois de marcar a nova.`);
  if (plan.urgent) warnings.unshift("Sinal de urgência nesta conversa: confira a orientação no topo antes de agendar.");

  // Horário exato pedido e livre: já vem marcado (a recepção ainda confirma)
  const exact = r.time ? slots.find((s) => s.time === r.time && (!r.dates.length || r.dates.includes(s.date))) : undefined;
  if (r.time && !exact) warnings.push(`O horário pedido (${r.time.replace(":00", "h")}) não está livre: veja os mais próximos.`);

  const [row] = await tx
    .insert(schema.aiScheduleSuggestions)
    .values({
      conversationId: plan.conversationId,
      requestedBy: scope.actorId,
      source: a.source,
      model: a.model,
      fallbackReason: a.fallbackReason,
      confidence: a.confidence,
      request: { ...r },
      slots: slots.map((s) => s.startsAt),
      latencyMs: a.latencyMs,
      inputTokens: a.tokens.in === null ? null : Math.round(a.tokens.in),
      outputTokens: a.tokens.out === null ? null : Math.round(a.tokens.out),
    })
    .returning({ id: schema.aiScheduleSuggestions.id });

  return {
    id: row!.id,
    source: a.source,
    fallbackReason: a.fallbackReason,
    chips,
    quote: r.quote,
    warnings,
    professionalId: pro.id,
    period: r.period,
    slots,
    preselect: exact ? { date: exact.date, time: exact.time } : null,
    service: r.service,
  };
}

/** A consulta foi marcada a partir da sugestão: guarda o resultado (mede o acerto). */
export async function recordScheduleOutcome(tx: Tx, suggestionId: string, appointmentId: string, startsAt: Date) {
  await tx
    .update(schema.aiScheduleSuggestions)
    .set({ appointmentId, usedSuggestion: sql`${schema.aiScheduleSuggestions.slots} @> ${JSON.stringify([startsAt.toISOString()])}::jsonb` })
    .where(and(eq(schema.aiScheduleSuggestions.id, suggestionId), sql`${schema.aiScheduleSuggestions.appointmentId} is null`));
}
