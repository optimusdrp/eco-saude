/**
 * Formatação de datas e textos no padrão brasileiro.
 * O fuso fixo evita que o servidor (que roda em UTC na Vercel) mostre
 * horários diferentes dos que a equipe vê no relógio.
 */
const TZ = "America/Sao_Paulo";

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("pt-BR", { timeZone: TZ });
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

/** "há 3 dias", "há 2 horas"... */
export function timeAgo(date: Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit);
  }
  return "agora";
}

/** Dias inteiros entre agora e uma data futura (negativo se já passou). */
export function daysUntil(date: Date, now = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** 12345678000190 -> 12.345.678/0001-90 */
export function formatCnpj(cnpj: string | null | undefined): string {
  if (!cnpj) return "—";
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Data de N dias atrás (usada em filtros como "últimos 7 dias"). */
export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}
