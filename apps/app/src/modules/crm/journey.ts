import "server-only";
import { REACTIVATION_DAYS, type JourneyStage } from "@ecosaude/core/crm";
import { and, eq, gt, inArray, schema, sql, type Tx } from "@ecosaude/db";
import { automationSettings } from "./automation-settings";
import { triggerAutomations } from "./automations";
import { queueAiJob } from "./ai/jobs";

/**
 * Jornada do paciente: a etapa muda SOZINHA conforme o que acontece,
 * para o quadro refletir a realidade sem depender de alguém arrastar cartões.
 *
 *   respondeu pela 1ª vez     -> Em conversa
 *   marcou consulta           -> Agendado
 *   compareceu                -> Paciente ativo
 *   cancelou (sem outra)      -> volta para Em conversa
 *   N dias sem consulta       -> Para reativar (padrão 180, ajustável)
 *   perdido que voltou a falar -> Em conversa
 */

export async function logEvent(tx: Tx, e: { contactId?: string | null; actorId?: string | null; type: string; data?: Record<string, unknown>; clientId?: string }): Promise<void> {
  const inserted = await tx
    .insert(schema.crmEvents)
    .values({ contactId: e.contactId ?? null, actorId: e.actorId ?? null, type: e.type, data: e.data ?? null, clientId: e.clientId ?? null })
    .onConflictDoNothing()
    .returning({ id: schema.crmEvents.id });
  // Regras da clínica com este gatilho entram na fila (evento repetido pelo clientId não dispara de novo)
  if (inserted.length) await triggerAutomations(tx, e);
}

/** Muda a etapa (se for diferente) e registra na linha do tempo. */
export async function setStage(tx: Tx, contactId: string, to: JourneyStage, opts: { actorId: string | null; auto: boolean; reason?: string | null }): Promise<boolean> {
  const [current] = await tx.select({ stage: schema.contacts.stage }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!current || current.stage === to) return false;

  await tx
    .update(schema.contacts)
    .set({
      stage: to,
      stageChangedAt: new Date(),
      lostReason: to === "perdido" ? (opts.reason ?? null) : null,
      version: sql`${schema.contacts.version} + 1`,
    })
    .where(eq(schema.contacts.id, contactId));
  await logEvent(tx, {
    contactId,
    actorId: opts.actorId,
    type: "stage_changed",
    data: { de: current.stage, para: to, auto: opts.auto, motivo: opts.reason ?? null },
  });
  // Motivo da perda organizado (Ajustes > IA): a conversa é lida logo depois (fila)
  if (to === "perdido") await queueAiJob(tx, "perda", contactId);
  return true;
}

async function stageOf(tx: Tx, contactId: string): Promise<JourneyStage | null> {
  const [row] = await tx.select({ stage: schema.contacts.stage }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  return row?.stage ?? null;
}

/** Automação "Jornada automática" ligada? (desligada: a equipe move os cartões à mão) */
async function autoJourney(tx: Tx): Promise<boolean> {
  return (await automationSettings(tx)).jornada_auto?.enabled !== false;
}

export async function onAgentReply(tx: Tx, contactId: string, actorId: string | null) {
  if (!(await autoJourney(tx))) return;
  if ((await stageOf(tx, contactId)) === "novo") await setStage(tx, contactId, "em_conversa", { actorId, auto: true });
}

export async function onInbound(tx: Tx, contactId: string) {
  if (!(await autoJourney(tx))) return;
  const stage = await stageOf(tx, contactId);
  if (stage === "perdido" || stage === "reativar") await setStage(tx, contactId, "em_conversa", { actorId: null, auto: true });
}

export async function onScheduled(tx: Tx, contactId: string, actorId: string | null) {
  if (!(await autoJourney(tx))) return;
  const stage = await stageOf(tx, contactId);
  if (stage && ["novo", "em_conversa", "reativar", "perdido"].includes(stage)) {
    await setStage(tx, contactId, "agendado", { actorId, auto: true });
  }
}

export async function onAttended(tx: Tx, contactId: string, visitAt: Date, actorId: string | null) {
  await tx
    .update(schema.contacts)
    .set({ lastVisitAt: sql`greatest(${schema.contacts.lastVisitAt}, ${visitAt})` })
    .where(eq(schema.contacts.id, contactId));
  if (await autoJourney(tx)) await setStage(tx, contactId, "paciente", { actorId, auto: true });
}

/** Consulta cancelada: se não restou outra marcada, o contato sai de "Agendado". */
export async function onUnscheduled(tx: Tx, contactId: string, actorId: string | null) {
  if (!(await autoJourney(tx))) return;
  if ((await stageOf(tx, contactId)) !== "agendado") return;
  const [future] = await tx
    .select({ id: schema.appointments.id })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.contactId, contactId), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])))
    .limit(1);
  if (future) return;
  const [c] = await tx.select({ lastVisitAt: schema.contacts.lastVisitAt }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  await setStage(tx, contactId, c?.lastVisitAt ? "paciente" : "em_conversa", { actorId, auto: true });
}

/**
 * Pacientes ativos sem consulta há mais de 6 meses (e sem nenhuma marcada)
 * vão para "Para reativar". Roda ao abrir a jornada e na rotina agendada.
 */
export async function recalcReactivation(tx: Tx): Promise<number> {
  const cfg = (await automationSettings(tx)).jornada_auto;
  if (cfg?.enabled === false) return 0;
  const days = typeof cfg?.diasReativar === "number" ? cfg.diasReativar : REACTIVATION_DAYS;
  const moved = await tx.execute<{ id: string }>(sql`
    update contacts c
       set stage = 'reativar', stage_changed_at = now(), version = c.version + 1
     where c.stage = 'paciente'
       and c.last_visit_at < now() - make_interval(days => ${days})
       and not exists (
         select 1 from appointments a
          where a.contact_id = c.id and a.starts_at > now() and a.status in ('agendado', 'confirmado'))
    returning c.id`);
  for (const row of moved.rows) {
    await logEvent(tx, { contactId: row.id, type: "stage_changed", data: { de: "paciente", para: "reativar", auto: true } });
  }
  return moved.rows.length;
}
