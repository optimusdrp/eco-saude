/**
 * Datas e horários no fuso da clínica.
 *
 * O banco guarda tudo em UTC (timestamptz). A clínica pensa em horário local
 * ("quinta às 14h em Porto Alegre"). Estas funções convertem entre os dois
 * sem depender do fuso do servidor (a Vercel roda em UTC).
 */
import { clinicTimeZone } from "./timezones";

/** Diferença (em minutos) entre o fuso e o UTC naquele instante. Ex.: São Paulo = -180. */
export function tzOffsetMinutes(instant: Date, tz = clinicTimeZone()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** "2026-10-09" + "14:30" no fuso da clínica -> instante UTC. */
export function zonedToUtc(dateIso: string, time: string, tz = clinicTimeZone()): Date {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, min);
  // Calcula o deslocamento no próprio instante (funciona mesmo com horário de verão)
  const offset = tzOffsetMinutes(new Date(guess), tz);
  return new Date(guess - offset * 60_000);
}

export interface ZonedParts {
  /** "2026-10-09" */
  date: string;
  /** "14:30" */
  time: string;
  /** 0 = domingo ... 6 = sábado */
  weekday: number;
  /** minutos desde a meia-noite local (14:30 = 870) */
  minutes: number;
}

/** Instante UTC -> partes no fuso da clínica. */
export function utcToZoned(instant: Date, tz = clinicTimeZone()): ZonedParts {
  const local = new Date(instant.getTime() + tzOffsetMinutes(instant, tz) * 60_000);
  const date = local.toISOString().slice(0, 10);
  const hh = local.getUTCHours();
  const mm = local.getUTCMinutes();
  return {
    date,
    time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    weekday: local.getUTCDay(),
    minutes: hh * 60 + mm,
  };
}

/** Data de hoje ("2026-10-09") no fuso da clínica. */
export function todayIso(now = new Date(), tz = clinicTimeZone()): string {
  return utcToZoned(now, tz).date;
}

/** Soma dias a uma data "AAAA-MM-DD". */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Início e fim (UTC) de um dia local, para consultas "do dia" no banco. */
export function dayRangeUtc(dateIso: string, tz = clinicTimeZone()): { start: Date; end: Date } {
  return { start: zonedToUtc(dateIso, "00:00", tz), end: zonedToUtc(addDaysIso(dateIso, 1), "00:00", tz) };
}

/* -------------------------------- Formatação ------------------------------- */

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "qui, 09/10" */
export function formatDayShort(instant: Date, tz = clinicTimeZone()): string {
  const p = utcToZoned(instant, tz);
  const [, m, d] = p.date.split("-");
  return `${WEEKDAYS[p.weekday]}, ${d}/${m}`;
}

/** "14:30" */
export function formatTime(instant: Date, tz = clinicTimeZone()): string {
  return utcToZoned(instant, tz).time;
}

/** "hoje", "amanhã", "ontem" ou "qui, 09/10". */
export function relativeDay(instant: Date, now = new Date(), tz = clinicTimeZone()): string {
  const target = utcToZoned(instant, tz).date;
  const today = todayIso(now, tz);
  if (target === today) return "hoje";
  if (target === addDaysIso(today, 1)) return "amanhã";
  if (target === addDaysIso(today, -1)) return "ontem";
  return formatDayShort(instant, tz);
}

/** "hoje às 14:30", "amanhã às 09:00", "qui, 09/10 às 10:00" */
export function formatWhen(instant: Date, now = new Date(), tz = clinicTimeZone()): string {
  return `${relativeDay(instant, now, tz)} às ${formatTime(instant, tz)}`;
}

/** Dias inteiros entre duas datas (b - a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
