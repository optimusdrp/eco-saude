/**
 * HORÁRIO DE FUNCIONAMENTO, FERIADOS E FECHAMENTOS (regras puras)
 *
 * Decisões (22/10/2026):
 *  - O horário de funcionamento é da UNIDADE. A unidade principal tem o horário da clínica;
 *    as outras usam o da principal até a clínica definir um próprio ("herdar").
 *  - O horário da unidade NÃO corta os horários livres dos profissionais (a semana de cada
 *    profissional continua mandando). Ele serve para a resposta "fora do horário" e para AVISAR
 *    quando um período do profissional cai fora do funcionamento da unidade.
 *  - FECHAMENTOS (feriados, recessos) bloqueiam de verdade: o dia some dos horários livres da
 *    unidade fechada, a marcação avisa e a resposta automática diz que hoje está fechado.
 *    Fechamento sem unidade = a clínica inteira.
 *  - Feriados NACIONAIS vêm de uma conta (fixos + Sexta-feira Santa, que depende da Páscoa).
 *    Carnaval e Corpus Christi são ponto facultativo: entram só se a clínica pedir.
 *    Feriados estaduais e municipais a clínica cadastra.
 */
import { toMinutes, WEEKDAY_SHORT, type WeeklySchedule } from "./hours";

/** Horário de funcionamento: os mesmos dias e períodos da semana do profissional (sem unidade e sala) */
export type OpeningHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", { periods: { start: string; end: string }[] }>>;

/** Padrão quando nada foi definido: segunda a sexta, 8h às 18h */
export const DEFAULT_OPENING_HOURS: OpeningHours = Object.fromEntries(["1", "2", "3", "4", "5"].map((k) => [k, { periods: [{ start: "08:00", end: "18:00" }] }]));

export const CLOSURE_KINDS = ["feriado", "recesso", "outro"] as const;
export type ClosureKind = (typeof CLOSURE_KINDS)[number];
export const CLOSURE_KIND_LABEL: Record<ClosureKind, string> = { feriado: "Feriado", recesso: "Recesso", outro: "Fechamento" };

export interface Closure {
  id?: string;
  /** null = a clínica inteira */
  unitId: string | null;
  /** AAAA-MM-DD (inclusive) */
  startsOn: string;
  endsOn: string;
  reason: string;
  kind: ClosureKind;
}

/* ------------------------------ Horário efetivo ------------------------------ */

/**
 * Horário que vale para a unidade: o próprio; sem próprio, o da principal; sem nada, o padrão.
 * `unit.openingHours` vazio ({}) significa "fechada todos os dias" e é respeitado (não herda).
 */
export function effectiveHours(unit: { openingHours: OpeningHours | null } | null | undefined, main: { openingHours: OpeningHours | null } | null | undefined): OpeningHours {
  return unit?.openingHours ?? main?.openingHours ?? DEFAULT_OPENING_HOURS;
}

/** Aberto neste dia da semana e minuto do dia? (só o horário; fechamentos ficam em openStatus) */
export function isOpenAt(hours: OpeningHours, weekday: number, minutes: number): boolean {
  const day = hours[String(weekday) as keyof OpeningHours];
  return !!day?.periods.some((p) => minutes >= toMinutes(p.start) && minutes < toMinutes(p.end));
}

/** Fechamento que cobre a data para a unidade (os da clínica inteira valem para todas) */
export function closureOn(closures: readonly Closure[], unitId: string | null, date: string): Closure | null {
  return closures.find((c) => (c.unitId === null || c.unitId === unitId) && c.startsOn <= date && c.endsOn >= date) ?? null;
}

export type OpenStatus = { open: true } | { open: false; reason: "fechamento"; closure: Closure } | { open: false; reason: "fora_horario" };

/** A unidade está atendendo agora? Fechamento tem prioridade sobre o horário. */
export function openStatus(p: { hours: OpeningHours; closures: readonly Closure[]; unitId: string | null; date: string; weekday: number; minutes: number }): OpenStatus {
  const closure = closureOn(p.closures, p.unitId, p.date);
  if (closure) return { open: false, reason: "fechamento", closure };
  return isOpenAt(p.hours, p.weekday, p.minutes) ? { open: true } : { open: false, reason: "fora_horario" };
}

/* ------------------------------ Textos ------------------------------ */

/** "8h", "8h30" */
function hourLabel(t: string): string {
  const [h, m] = t.split(":");
  return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

/**
 * Horário legível para o paciente, juntando dias iguais em faixas:
 * "seg a sex, 8h às 12h e 14h às 18h; sáb, 8h às 12h". Sem nenhum dia: "fechado".
 */
export function describeHours(hours: OpeningHours): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const text = (k: number) =>
    (hours[String(k) as keyof OpeningHours]?.periods ?? [])
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((p) => `${hourLabel(p.start)} às ${hourLabel(p.end)}`)
      .join(" e ");
  const groups: { from: number; to: number; text: string }[] = [];
  for (const k of order) {
    const t = text(k);
    if (!t) continue;
    const last = groups[groups.length - 1];
    // Junta com o grupo anterior se for o dia seguinte na ordem seg..dom e tiver o mesmo horário
    if (last && last.text === t && order.indexOf(k) === order.indexOf(last.to) + 1) last.to = k;
    else groups.push({ from: k, to: k, text: t });
  }
  if (!groups.length) return "fechado";
  const day = (k: number) => WEEKDAY_SHORT[k]!.toLowerCase();
  return groups.map((g) => `${g.from === g.to ? day(g.from) : `${day(g.from)} a ${day(g.to)}`}, ${g.text}`).join("; ");
}

/**
 * Texto da variável {{horario_atendimento}} da resposta automática. O modelo padrão diz
 * "Nosso atendimento é {{horario_atendimento}}", e clínicas podem ter personalizado o texto
 * nessa forma: por isso a variável continua sendo O HORÁRIO, e o fechamento vem entre
 * parênteses no fim: "seg a sex, 8h às 18h (hoje estamos fechados: Natal)".
 */
export function afterHoursText(status: OpenStatus, hours: OpeningHours): string {
  const normal = describeHours(hours);
  if (!status.open && status.reason === "fechamento") {
    const c = status.closure;
    const until = c.endsOn !== c.startsOn ? `, até ${c.endsOn.slice(8, 10)}/${c.endsOn.slice(5, 7)}` : "";
    return `${normal} (hoje estamos fechados: ${c.reason}${until})`;
  }
  return normal;
}

/* ------------------------------ Validação ------------------------------ */

/** Erros do horário: "seg: 18:00 deve ser depois de 08:00", "ter: períodos sobrepostos" */
export function validateOpeningHours(hours: OpeningHours): string[] {
  const errors: string[] = [];
  for (const [k, day] of Object.entries(hours)) {
    const label = WEEKDAY_SHORT[Number(k)]?.toLowerCase() ?? k;
    const ps = [...(day?.periods ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    for (const p of ps) {
      if (!/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end)) errors.push(`${label}: horário inválido`);
      else if (toMinutes(p.end) <= toMinutes(p.start)) errors.push(`${label}: ${p.end} deve ser depois de ${p.start}`);
    }
    for (let i = 1; i < ps.length; i++) if (toMinutes(ps[i]!.start) < toMinutes(ps[i - 1]!.end)) errors.push(`${label}: períodos sobrepostos`);
  }
  return errors;
}

/**
 * Períodos da semana do profissional que caem FORA do funcionamento da unidade em que ele
 * atende (só para avisar; não bloqueia). `hoursOf` devolve o horário efetivo de cada unidade.
 * Ex.: ["sáb 08:00-12:00 (Unidade Centro fecha)", "seg 18:00-20:00 (Unidade Moinhos fecha às 18h)"]
 */
export function periodsOutsideHours(week: WeeklySchedule, mainUnitId: string, hoursOf: (unitId: string) => OpeningHours, unitName: (unitId: string) => string): string[] {
  const out: string[] = [];
  for (const [k, day] of Object.entries(week)) {
    for (const p of day?.periods ?? []) {
      const unitId = p.unitId ?? mainUnitId;
      const hours = hoursOf(unitId)[k as keyof OpeningHours];
      const start = toMinutes(p.start);
      const end = toMinutes(p.end);
      // Cabe inteiro em algum período de funcionamento do dia?
      const fits = hours?.periods.some((h) => start >= toMinutes(h.start) && end <= toMinutes(h.end));
      if (!fits) out.push(`${WEEKDAY_SHORT[Number(k)]!.toLowerCase()} ${p.start}-${p.end} (${unitName(unitId)} ${hours?.periods.length ? "fechada em parte desse horário" : "não abre nesse dia"})`);
    }
  }
  return out;
}

/* ------------------------------ Feriados nacionais ------------------------------ */

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). AAAA-MM-DD */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface Holiday {
  date: string;
  name: string;
  /** Ponto facultativo (Carnaval, Corpus Christi): só entra se a clínica pedir */
  optional: boolean;
}

/**
 * Feriados nacionais do Brasil no ano (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023) e a
 * Sexta-feira Santa. Com `optional`, também os pontos facultativos mais comuns.
 */
export function nationalHolidays(year: number, opts: { optional?: boolean } = {}): Holiday[] {
  const easter = easterSunday(year);
  const fixed: [string, string][] = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"],
    ["12-25", "Natal"],
  ];
  const list: Holiday[] = [
    ...fixed.map(([md, name]) => ({ date: `${year}-${md}`, name, optional: false })),
    { date: shiftDays(easter, -2), name: "Sexta-feira Santa", optional: false },
  ];
  if (opts.optional) {
    list.push(
      { date: shiftDays(easter, -48), name: "Carnaval (segunda)", optional: true },
      { date: shiftDays(easter, -47), name: "Carnaval (terça)", optional: true },
      { date: shiftDays(easter, 60), name: "Corpus Christi", optional: true },
    );
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}
