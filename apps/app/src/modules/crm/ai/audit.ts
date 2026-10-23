import "server-only";
import {
  AUDIT_SCHEMA,
  auditFacts,
  buildAuditPrompt,
  checkAudit,
  firstName,
  openStatus,
  isoWeek,
  pickSample,
  ruleAudit,
  todayIso,
  utcToZoned,
  type AuditMessage,
  type AuditVerdict,
} from "@ecosaude/core/crm";
import { and, eq, gt, inArray, schema, sql, withTenant } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";
import { logEvent } from "../journey";
import { aiConfigured, AiError, generate } from "./provider";
import { loadOpening } from "../opening";

/**
 * AUDITORIA DE ATENDIMENTO POR AMOSTRAGEM (servidor)
 *
 *  1. Sorteia conversas da última semana em que a EQUIPE respondeu (mensagens
 *     automáticas não contam), dividindo entre as pessoas.
 *  2. O sistema mede o tempo de resposta (só no horário de atendimento).
 *  3. A IA lê só as falas, SEM nome do paciente e com dados pessoais ocultados,
 *     e dá cordialidade, clareza, se ofereceu horário, um ponto forte e uma dica.
 *     Conversa com sinal de urgência não vai para a IA (vale a avaliação pelas regras).
 *  4. Plano B: sinais objetivos (cumprimento, nome, agradecimento, despedida).
 *
 * A rotina completa a amostra da semana em lotes de 8 (a partir de segunda, 7h).
 * O botão "Auditar agora" adianta o próximo lote.
 */

const MIN_CONFIDENCE = 50;
const BATCH = 8;
export const AUDIT_EVENT = "service_audit_run";

export interface AuditRunResult {
  /** Quantas faltam para completar a amostra da semana */
  remaining?: number;
  audited: number;
  ai: number;
  rules: number;
  reason: string | null;
}

/** Semana atual (fuso da clínica) */
export const currentWeek = (now = new Date()) => isoWeek(todayIso(now));

export async function runServiceAudit(clinicId: string, opts: { force?: boolean; actorId?: string | null } = {}): Promise<AuditRunResult | null> {
  const now = new Date();
  const week = currentWeek(now);
  const plan = await withTenant(clinicId, async (tx) => {
    const auto = await automationSettings(tx);
    const cfg = auto.ia_auditoria;
    if (!cfg?.enabled) return null;
    const target = typeof cfg.amostraSemanal === "number" ? cfg.amostraSemanal : 10;
    const [done] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.serviceAudits)
      .where(eq(schema.serviceAudits.week, week));
    const already = done?.n ?? 0;
    // Rotina: completa a amostra da semana aos poucos (a partir de segunda, 7h).
    // Lotes de até 8 conversas: a rotina tem 60 s e cada leitura da IA leva alguns segundos.
    const z = utcToZoned(now);
    if (!opts.force && z.weekday === 1 && z.minutes < 7 * 60) return null;
    const missing = Math.min(BATCH, target - already);
    if (missing <= 0) return { picked: [], hours: null, week };

    // Candidatas: a equipe respondeu nos últimos 7 dias e não foi avaliada nos últimos 30
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const rows = await tx.execute<{ id: string; agent_id: string }>(sql`
      select m.conversation_id as id,
             (array_agg(m.author_id order by m.n desc))[1] as agent_id
        from (select conversation_id, author_id, count(*) as n
                from messages
               where direction = 'out' and author_id is not null and created_at > ${since}
               group by conversation_id, author_id) m
       where exists (select 1 from messages i where i.conversation_id = m.conversation_id and i.direction = 'in' and i.created_at > ${since})
         and not exists (select 1 from service_audits a where a.conversation_id = m.conversation_id and a.created_at > now() - interval '30 days')
       group by m.conversation_id`);
    const picked = pickSample(
      rows.rows.map((r) => ({ id: r.id, agentId: r.agent_id })),
      missing,
      week,
    );
    if (!picked.length) return { picked: [], hours: null, week };

    const convs = await tx
      .select({ id: schema.conversations.id, urgent: schema.conversations.urgent, contactName: schema.contacts.name })
      .from(schema.conversations)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .where(
        inArray(
          schema.conversations.id,
          picked.map((p) => p.id),
        ),
      );
    const msgs = await tx
      .select({ conversationId: schema.messages.conversationId, direction: schema.messages.direction, body: schema.messages.body, at: schema.messages.createdAt, authorId: schema.messages.authorId })
      .from(schema.messages)
      .where(
        and(
          inArray(
            schema.messages.conversationId,
            picked.map((p) => p.id),
          ),
          gt(schema.messages.createdAt, since),
          inArray(schema.messages.direction, ["in", "out"]),
        ),
      );
    // Horário de atendimento: o da unidade principal (Ajustes > Unidades), com os feriados e
    // fechamentos da clínica inteira. Fora dele, a demora para responder não pesa na auditoria.
    const opening = await loadOpening(tx, "2000-01-01");
    const hours = { week: opening.hoursOf(opening.mainUnitId), closures: opening.closures, mainUnitId: opening.mainUnitId };
    return {
      week,
      hours,
      picked: picked.map((p) => {
        const c = convs.find((x) => x.id === p.id)!;
        const list: AuditMessage[] = msgs
          .filter((m) => m.conversationId === p.id)
          // Mensagem automática (sem autor) não é atendimento da equipe
          .filter((m) => m.direction === "in" || m.authorId)
          .map((m) => ({ from: m.direction === "in" ? ("paciente" as const) : ("equipe" as const), at: m.at, text: m.body, authorId: m.authorId }));
        return { id: p.id, agentId: p.agentId, urgent: c.urgent, contactName: c.contactName, msgs: list };
      }),
    };
  });
  if (!plan) return null;
  if (!plan.picked.length) return { audited: 0, ai: 0, rules: 0, reason: null };

  const hours = plan.hours!;
  const openAt = (d: Date) => {
    const z = utcToZoned(d);
    return openStatus({ hours: hours.week, closures: hours.closures, unitId: hours.mainUnitId, date: z.date, weekday: z.weekday, minutes: z.minutes }).open;
  };
  type Row = {
    conversationId: string;
    agentId: string;
    verdict: AuditVerdict;
    source: "ia" | "regras";
    confidence: number | null;
    model: string | null;
    reason: string | null;
    facts: ReturnType<typeof auditFacts>;
  };
  const rows: Row[] = [];
  let lastReason: string | null = null;
  for (const c of plan.picked) {
    const facts = auditFacts(c.msgs, firstName(c.contactName), openAt);
    const rules = (reason: string | null, model: string | null = null): Row => ({
      conversationId: c.id,
      agentId: c.agentId,
      verdict: ruleAudit(facts),
      source: "regras",
      confidence: null,
      model,
      reason,
      facts,
    });
    if (!aiConfigured()) {
      rows.push(rules("IA não configurada no servidor"));
      continue;
    }
    if (c.urgent) {
      rows.push(rules("conversa com sinal de urgência não vai para a IA"));
      continue;
    }
    try {
      const { system, user } = buildAuditPrompt(c.msgs, c.contactName, facts);
      const out = await generate({ system, user, schema: AUDIT_SCHEMA, temperature: 0 }, { task: "classify" });
      const checked = checkAudit(out.text, c.msgs, c.contactName, facts);
      if (!checked.ok) rows.push(rules(checked.reason, out.model));
      else if (checked.confidence < MIN_CONFIDENCE) rows.push(rules(`certeza da IA baixa (${checked.confidence}%)`, out.model));
      else rows.push({ conversationId: c.id, agentId: c.agentId, verdict: checked.verdict, source: "ia", confidence: checked.confidence, model: out.model, reason: null, facts });
    } catch (error) {
      rows.push(rules(error instanceof AiError ? error.reason : "falha inesperada na IA"));
    }
    if (rows.at(-1)!.reason) lastReason = rows.at(-1)!.reason;
  }

  await withTenant(clinicId, async (tx) => {
    for (const r of rows) {
      const s = r.verdict.scores;
      await tx
        .insert(schema.serviceAudits)
        .values({
          conversationId: r.conversationId,
          agentId: r.agentId,
          week: plan.week,
          tempo: s.tempo,
          cordialidade: s.cordialidade,
          clareza: s.clareza,
          horario: s.horario,
          total: s.total,
          firstResponseMin: r.facts.firstResponseMin,
          wantedSchedule: r.facts.wantedSchedule,
          offeredSlot: r.facts.offeredSlot,
          strength: r.verdict.strength,
          tip: r.verdict.tip,
          quote: r.verdict.quote,
          source: r.source,
          confidence: r.confidence,
          model: r.model,
          fallbackReason: r.reason,
        })
        .onConflictDoNothing();
    }
    await logEvent(tx, { actorId: opts.actorId ?? null, type: AUDIT_EVENT, data: { semana: plan.week, avaliadas: rows.length, ia: rows.filter((r) => r.source === "ia").length } });
  });
  return { audited: rows.length, ai: rows.filter((r) => r.source === "ia").length, rules: rows.filter((r) => r.source === "regras").length, reason: lastReason };
}
