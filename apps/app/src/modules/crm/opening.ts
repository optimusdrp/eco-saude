import "server-only";
import { clinicTimeZone, effectiveHours, todayIso, type Closure, type OpeningHours } from "@ecosaude/core/crm";
import { and, asc, desc, eq, gte, lte, ne, schema, sql, type Tx } from "@ecosaude/db";

/**
 * HORÁRIO DE FUNCIONAMENTO E FECHAMENTOS no servidor (regras em core/crm/opening.ts).
 *
 *  - loadOpening: unidades com o horário EFETIVO (próprio ou herdado da principal) e os
 *    fechamentos a partir de uma data. Uma consulta por tela/rotina.
 *  - contactUnit: a unidade "do paciente" (próxima consulta; senão a última; senão a principal),
 *    usada na resposta "fora do horário" porque o WhatsApp é um número só para a clínica toda.
 */

export interface OpeningData {
  mainUnitId: string;
  /** Horário efetivo de cada unidade (inclusive as desativadas) */
  hoursOf: (unitId: string | null | undefined) => OpeningHours;
  unitName: (unitId: string | null | undefined) => string;
  /** Fechamentos que terminam a partir de `fromDate` */
  closures: Closure[];
}

export async function loadOpening(tx: Tx, fromDate = todayIso()): Promise<OpeningData> {
  const units = await tx
    .select({ id: schema.clinicUnits.id, name: schema.clinicUnits.name, main: schema.clinicUnits.main, openingHours: schema.clinicUnits.openingHours })
    .from(schema.clinicUnits);
  const main = units.find((u) => u.main) ?? null;
  const byId = new Map(units.map((u) => [u.id, u]));
  const closures = await loadClosures(tx, fromDate);
  return {
    mainUnitId: main?.id ?? "",
    hoursOf: (unitId) => effectiveHours(unitId ? byId.get(unitId) : main, main),
    unitName: (unitId) => (unitId ? byId.get(unitId)?.name : main?.name) ?? "Unidade",
    closures,
  };
}

/** Fechamentos que ainda valem a partir da data (inclusive), em ordem de data */
export async function loadClosures(tx: Tx, fromDate = todayIso(), toDate?: string): Promise<(Closure & { id: string; national: boolean })[]> {
  const rows = await tx
    .select()
    .from(schema.clinicClosures)
    .where(and(gte(schema.clinicClosures.endsOn, fromDate), toDate ? lte(schema.clinicClosures.startsOn, toDate) : undefined))
    .orderBy(asc(schema.clinicClosures.startsOn));
  return rows.map((r) => ({ id: r.id, unitId: r.unitId, startsOn: r.startsOn, endsOn: r.endsOn, reason: r.reason, kind: r.kind, national: r.national }));
}

/** Unidade do paciente: a da próxima consulta; senão a da última; senão null (= principal) */
export async function contactUnit(tx: Tx, contactId: string, now = new Date()): Promise<string | null> {
  const [next] = await tx
    .select({ unitId: schema.appointments.unitId })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.contactId, contactId), ne(schema.appointments.status, "cancelado"), gte(schema.appointments.startsAt, now)))
    .orderBy(asc(schema.appointments.startsAt))
    .limit(1);
  if (next?.unitId) return next.unitId;
  const [last] = await tx
    .select({ unitId: schema.appointments.unitId })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.contactId, contactId), ne(schema.appointments.status, "cancelado")))
    .orderBy(desc(schema.appointments.startsAt))
    .limit(1);
  return last?.unitId ?? null;
}

/** Consultas marcadas (não canceladas) num fechamento: para avisar quem cadastra o feriado */
export async function appointmentsInClosure(tx: Tx, c: { unitId: string | null; startsOn: string; endsOn: string }): Promise<number> {
  const r = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from appointments
     where status in ('agendado', 'confirmado')
       and (starts_at at time zone ${clinicTimeZone()})::date between ${c.startsOn}::date and ${c.endsOn}::date
       ${c.unitId ? sql`and unit_id = ${c.unitId}` : sql``}`);
  return r.rows[0]?.n ?? 0;
}

