import "server-only";
import { serviceKey, summarizeDurations, type DurationRow } from "@ecosaude/core/crm";
import { and, eq, inArray, isNotNull, schema, sql, type Tx } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";

/**
 * DURAÇÃO REAL (dados do servidor)
 *  - durationRows: estatística dos últimos 6 meses por profissional e procedimento,
 *    com a duração já aplicada pela equipe (service_durations) ao lado.
 *  - durationFor: o que o agendamento deve sugerir (aplicada > sugerida > nada).
 */

const MONTHS = 6;

export interface DurationView extends DurationRow {
  professionalName: string;
  /** Duração padrão da agenda do profissional */
  professionalSlot: number;
  /** Já aplicada pela equipe para este procedimento */
  applied: number | null;
}

export async function durationRows(tx: Tx): Promise<{ rows: DurationView[]; measured: number; percentile: number }> {
  const cfg = (await automationSettings(tx)).ia_duracao;
  const percentile = Number(cfg?.percentil) || 75;
  const appts = await tx
    .select({
      professionalId: schema.appointments.professionalId,
      service: schema.appointments.service,
      startsAt: schema.appointments.startsAt,
      endsAt: schema.appointments.endsAt,
      arrivedAt: schema.appointments.arrivedAt,
      finishedAt: schema.appointments.finishedAt,
    })
    .from(schema.appointments)
    .where(and(isNotNull(schema.appointments.arrivedAt), isNotNull(schema.appointments.finishedAt), sql`${schema.appointments.startsAt} > now() - make_interval(months => ${MONTHS})`));
  const stats = summarizeDurations(
    appts.map((a) => ({
      professionalId: a.professionalId,
      service: a.service,
      scheduledMin: (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000,
      startsAt: a.startsAt.getTime(),
      arrivedAt: a.arrivedAt!.getTime(),
      finishedAt: a.finishedAt!.getTime(),
    })),
    { percentile },
  );
  const proIds = [...new Set(stats.map((s) => s.professionalId))];
  const pros = proIds.length
    ? await tx
        .select({ id: schema.professionals.id, name: schema.professionals.name, slot: schema.professionals.slotMinutes })
        .from(schema.professionals)
        .where(inArray(schema.professionals.id, proIds))
    : [];
  const applied = await tx.select().from(schema.serviceDurations);
  return {
    measured: appts.length,
    percentile,
    rows: stats.map((s) => {
      const p = pros.find((x) => x.id === s.professionalId);
      return {
        ...s,
        professionalName: p?.name ?? "Profissional",
        professionalSlot: p?.slot ?? 30,
        applied: applied.find((a) => a.professionalId === s.professionalId && a.serviceKey === s.serviceKey)?.minutes ?? null,
      };
    }),
  };
}

/** Duração a sugerir ao agendar (null = usa a padrão do profissional). */
export async function durationFor(tx: Tx, professionalId: string, service: string | null): Promise<{ minutes: number; source: "aplicada" | "sugerida"; n?: number } | null> {
  const cfg = (await automationSettings(tx)).ia_duracao;
  if (!cfg?.enabled) return null;
  const key = serviceKey(service);
  // 1. A que a equipe aplicou (procedimento; senão a geral do profissional)
  const applied = await tx
    .select({ key: schema.serviceDurations.serviceKey, minutes: schema.serviceDurations.minutes })
    .from(schema.serviceDurations)
    .where(and(eq(schema.serviceDurations.professionalId, professionalId), inArray(schema.serviceDurations.serviceKey, key ? [key, ""] : [""])));
  const hit = applied.find((a) => a.key === key) ?? applied.find((a) => a.key === "");
  if (hit) return { minutes: hit.minutes, source: "aplicada" };
  // 2. A sugerida pelas medições (só com amostra suficiente)
  if (!key) return null;
  const { rows } = await durationRows(tx);
  const row = rows.find((r) => r.professionalId === professionalId && r.serviceKey === key && r.suggestion);
  return row ? { minutes: row.suggestion!, source: "sugerida", n: row.n } : null;
}
