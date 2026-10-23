/**
 * Regras de agenda que não dependem de banco: horários livres e risco de falta.
 * Funções puras (mesma entrada, mesma saída), fáceis de testar e de levar
 * para o modo offline no futuro, pois rodam também no navegador.
 */
import type { WaitlistPeriod } from "./constants";
import { clinicTimeZone } from "./timezones";
import { absenceOn, dayMinutes, toHHMM, type DateRange, type WeeklySchedule } from "./hours";
import { addDaysIso, utcToZoned, zonedToUtc } from "./time";

/* ------------------------------ Horários livres ---------------------------- */

export interface WorkSchedule {
  /** Semana do profissional (períodos por dia): veja hours.ts */
  week: WeeklySchedule;
  /** Duração padrão da consulta em minutos (cada dia pode ter a sua) */
  slotMinutes: number;
  /** Férias, folgas e afastamentos por data */
  absences?: readonly DateRange[];
}

export interface TimeRange {
  startsAt: Date;
  endsAt: Date;
}

/** Dois intervalos se sobrepõem? (encostar não conta: 10:00-10:30 e 10:30-11:00 não conflitam) */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Próximos horários livres de um profissional.
 * - respeita dias e horário de atendimento, intervalo de almoço e consultas já marcadas
 * - não oferece horário que começa em menos de `minLeadMinutes`
 * - `period` filtra manhã (antes das 12h) ou tarde
 */
export function findFreeSlots(opts: {
  schedule: WorkSchedule;
  busy: TimeRange[];
  from: Date;
  days?: number;
  limit?: number;
  period?: WaitlistPeriod;
  minLeadMinutes?: number;
  tz?: string;
  /** Duração desejada (padrão = duração da consulta do profissional). Os inícios seguem a grade do profissional. */
  durationMinutes?: number;
  /**
   * Filtro extra por horário (ex.: há consultório livre? ver roomForSlot em units.ts).
   * Recusado não conta no limite: a busca continua até achar `limit` horários aceitos.
   */
  accept?: (slot: TimeRange) => boolean;
}): TimeRange[] {
  const { schedule, busy, from, days = 14, limit = 6, period = "qualquer", minLeadMinutes = 60, tz = clinicTimeZone() } = opts;
  const earliest = new Date(from.getTime() + minLeadMinutes * 60_000);
  const startDay = utcToZoned(from, tz).date;
  const result: TimeRange[] = [];

  for (let d = 0; d < days && result.length < limit; d++) {
    const date = addDaysIso(startDay, d);
    if (absenceOn(schedule.absences, date)) continue;
    const weekday = utcToZoned(zonedToUtc(date, "12:00", tz), tz).weekday;
    const day = dayMinutes(schedule.week, weekday, schedule.slotMinutes);
    if (!day) continue;
    // Os inícios seguem a grade do dia (duração da consulta naquele dia)
    const length = opts.durationMinutes ?? day.slot;

    for (const block of day.periods) {
      for (let m = block.start; m + length <= block.end && result.length < limit; m += day.slot) {
        const end = m + length;
        if (period === "manha" && m >= 12 * 60) continue;
        if (period === "tarde" && m < 12 * 60) continue;
        const slot = { startsAt: zonedToUtc(date, toHHMM(m), tz), endsAt: zonedToUtc(date, toHHMM(end), tz) };
        if (slot.startsAt < earliest) continue;
        if (busy.some((b) => overlaps(slot, b))) continue;
        if (opts.accept && !opts.accept(slot)) continue;
        result.push(slot);
      }
    }
  }
  return result;
}

/** O horário cabe no período desejado pelo paciente da lista de espera? */
export function matchesPeriod(startsAt: Date, period: WaitlistPeriod, tz = clinicTimeZone()): boolean {
  if (period === "qualquer") return true;
  const minutes = utcToZoned(startsAt, tz).minutes;
  return period === "manha" ? minutes < 12 * 60 : minutes >= 12 * 60;
}

/* ------------------------------- Risco de falta ---------------------------- */

export interface NoShowInput {
  /** Faltas anteriores do paciente */
  pastNoShows: number;
  /** Consultas anteriores em que compareceu */
  pastAttended: number;
  /** Já confirmou esta consulta? */
  confirmed: boolean;
  /** Horas que faltam para a consulta */
  hoursUntil: number;
  /** Dias entre a marcação e a consulta */
  leadTimeDays: number;
}

export type RiskLevel = "baixo" | "medio" | "alto";

export interface NoShowRisk {
  /** 0 a 100 */
  score: number;
  level: RiskLevel;
  /** Motivos em linguagem simples (o risco é explicado, não uma "caixa-preta") */
  reasons: string[];
  /** O que a recepção pode fazer */
  suggestion: string | null;
}

/**
 * Estimativa de risco de falta.
 * Regras simples e transparentes (não é IA): cada fator soma pontos e vira um
 * motivo legível. Quando houver histórico suficiente, o mesmo contrato
 * (entrada -> score + motivos) pode ser alimentado por um modelo estatístico.
 */
export function noShowRisk(input: NoShowInput): NoShowRisk {
  let score = 12;
  const reasons: string[] = [];
  const history = input.pastNoShows + input.pastAttended;

  if (history === 0) {
    score += 12;
    reasons.push("Primeira consulta na clínica");
  } else if (input.pastNoShows > 0) {
    const rate = input.pastNoShows / history;
    score += Math.round(Math.min(45, rate * 70));
    reasons.push(`Faltou ${input.pastNoShows} de ${history} ${history === 1 ? "consulta" : "consultas"}`);
  } else if (input.pastAttended >= 3) {
    score -= 8;
    reasons.push(`Compareceu às últimas ${input.pastAttended} consultas`);
  }

  if (input.confirmed) {
    score -= 22;
    reasons.push("Já confirmou");
  } else if (input.hoursUntil <= 48) {
    score += 20;
    reasons.push("Ainda não confirmou");
  }

  if (input.leadTimeDays >= 21) {
    score += 10;
    reasons.push(`Marcada há ${input.leadTimeDays} dias`);
  }

  score = Math.max(3, Math.min(95, score));
  const level: RiskLevel = score >= 55 ? "alto" : score >= 30 ? "medio" : "baixo";

  let suggestion: string | null = null;
  if (level === "alto") {
    suggestion = input.confirmed ? "Envie um lembrete no dia, pelo canal preferido." : "Peça confirmação agora e deixe um paciente da lista de espera avisado.";
  } else if (level === "medio" && !input.confirmed) {
    suggestion = "Peça confirmação.";
  }

  return { score, level, reasons, suggestion };
}

export const RISK_LABEL: Record<RiskLevel, string> = { baixo: "Risco baixo", medio: "Risco médio", alto: "Risco alto" };
