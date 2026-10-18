import "server-only";
import { todayIso, weeklyOf, type DateRange, type WorkSchedule } from "@ecosaude/core/crm";
import { and, asc, gte, inArray, schema, type Tx } from "@ecosaude/db";

/**
 * Horários dos profissionais no servidor: junta a semana (JSON por dia) com
 * as ausências por data. Toda busca de horário livre passa por aqui.
 */

type ProRow = typeof schema.professionals.$inferSelect;

/** Ausências futuras (e em andamento) de vários profissionais, agrupadas. */
export async function absencesByProfessional(tx: Tx, professionalIds: string[], fromDate = todayIso()): Promise<Map<string, DateRange[]>> {
  const out = new Map<string, DateRange[]>();
  if (!professionalIds.length) return out;
  const rows = await tx
    .select({
      professionalId: schema.professionalAbsences.professionalId,
      startsOn: schema.professionalAbsences.startsOn,
      endsOn: schema.professionalAbsences.endsOn,
      reason: schema.professionalAbsences.reason,
    })
    .from(schema.professionalAbsences)
    .where(and(inArray(schema.professionalAbsences.professionalId, professionalIds), gte(schema.professionalAbsences.endsOn, fromDate)))
    .orderBy(asc(schema.professionalAbsences.startsOn));
  for (const r of rows) out.set(r.professionalId, [...(out.get(r.professionalId) ?? []), { startsOn: r.startsOn, endsOn: r.endsOn, reason: r.reason }]);
  return out;
}

/** Agenda de trabalho completa de um profissional (semana + ausências). */
export function workScheduleOf(pro: ProRow, absences: DateRange[] = []): WorkSchedule {
  return { week: weeklyOf(pro), slotMinutes: pro.slotMinutes, absences };
}

/** Atalho para UM profissional (busca as ausências dele). */
export async function loadWorkSchedule(tx: Tx, pro: ProRow): Promise<WorkSchedule> {
  const abs = await absencesByProfessional(tx, [pro.id]);
  return workScheduleOf(pro, abs.get(pro.id));
}
