import { addDaysIso } from "@ecosaude/core/crm";

/**
 * Datas das tarefas (AAAA-MM-DD, já no fuso da clínica): rótulos e atalhos.
 */
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "hoje", "amanhã", "ontem" ou "qua, 14/10" */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "hoje";
  if (date === addDaysIso(today, 1)) return "amanhã";
  if (date === addDaysIso(today, -1)) return "ontem";
  return `${WEEKDAYS[weekdayOf(date)]}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

const utc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/** Dias entre hoje e a data (negativo = atrasada) */
export function daysFrom(today: string, date: string): number {
  return Math.round((utc(date) - utc(today)) / 86_400_000);
}

/** Próxima segunda-feira (a partir de amanhã) */
export function nextMonday(today: string): string {
  const diff = (1 - weekdayOf(today) + 7) % 7 || 7;
  return addDaysIso(today, diff);
}
