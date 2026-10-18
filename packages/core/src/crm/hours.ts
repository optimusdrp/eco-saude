/**
 * HORÁRIOS DE ATENDIMENTO DE CADA PROFISSIONAL (totalmente personalizáveis)
 *
 * Cada dia da semana tem os próprios PERÍODOS de atendimento e, se quiser,
 * a própria duração de consulta. Exemplos:
 *   seg: 08:00-12:00 e 14:00-18:00   (o vão entre os períodos é o intervalo)
 *   ter: 13:00-21:00, consultas de 40 min
 *   sáb: 08:00-12:00
 *   dom: sem atendimento (dia ausente do objeto)
 *
 * Além da semana, há AUSÊNCIAS por data (férias, congresso, folga): nesses
 * dias o profissional não tem horários livres, mesmo sendo dia de atendimento.
 *
 * Guardado no banco como JSON (professionals.weekly_schedule). Profissionais
 * antigos (sem esse JSON) continuam funcionando pelas colunas de expediente
 * único: weeklyFromLegacy converte na leitura.
 */

export interface TimePeriod {
  /** "08:00" */
  start: string;
  /** "12:00" */
  end: string;
}

export interface DaySchedule {
  periods: TimePeriod[];
  /** Duração da consulta só neste dia (vazio = a duração padrão do profissional) */
  slotMinutes?: number;
}

/** Chave "0" (domingo) a "6" (sábado). Dia ausente = não atende. */
export type WeeklySchedule = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DaySchedule>>;

/** Período em minutos desde a meia-noite (para contas e desenho da agenda). */
export interface MinutePeriod {
  start: number;
  end: number;
}

export interface DayMinutes {
  periods: MinutePeriod[];
  /** Primeiro início e último fim do dia */
  start: number;
  end: number;
  /** Vãos entre os períodos (intervalos) */
  gaps: MinutePeriod[];
  /** Duração da consulta neste dia */
  slot: number;
}

export interface DateRange {
  /** AAAA-MM-DD (inclusive) */
  startsOn: string;
  /** AAAA-MM-DD (inclusive) */
  endsOn: string;
  reason?: string | null;
}

export const WEEKDAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;
export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
export const WEEKDAY_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Converte o expediente único antigo (colunas work_*) em semana. */
export function weeklyFromLegacy(p: { workDays: number[]; workStart: string; workEnd: string; breakStart?: string | null; breakEnd?: string | null }): WeeklySchedule {
  const periods: TimePeriod[] =
    p.breakStart && p.breakEnd
      ? [
          { start: p.workStart, end: p.breakStart },
          { start: p.breakEnd, end: p.workEnd },
        ]
      : [{ start: p.workStart, end: p.workEnd }];
  const out: WeeklySchedule = {};
  for (const d of p.workDays) out[String(d) as keyof WeeklySchedule] = { periods: periods.map((x) => ({ ...x })) };
  return out;
}

/** Semana do profissional: o JSON novo ou, se ainda não existir, o expediente antigo. */
export function weeklyOf(p: {
  weeklySchedule?: WeeklySchedule | null;
  workDays: number[];
  workStart: string;
  workEnd: string;
  breakStart?: string | null;
  breakEnd?: string | null;
}): WeeklySchedule {
  return p.weeklySchedule && Object.keys(p.weeklySchedule).length ? p.weeklySchedule : weeklyFromLegacy(p);
}

/** Um dia em minutos (null = não atende). */
export function dayMinutes(week: WeeklySchedule, weekday: number, defaultSlot: number): DayMinutes | null {
  const day = week[String(weekday) as keyof WeeklySchedule];
  if (!day || !day.periods.length) return null;
  const periods = day.periods.map((p) => ({ start: toMinutes(p.start), end: toMinutes(p.end) })).sort((a, b) => a.start - b.start);
  const gaps: MinutePeriod[] = [];
  for (let i = 1; i < periods.length; i++) if (periods[i]!.start > periods[i - 1]!.end) gaps.push({ start: periods[i - 1]!.end, end: periods[i]!.start });
  return { periods, start: periods[0]!.start, end: periods[periods.length - 1]!.end, gaps, slot: day.slotMinutes ?? defaultSlot };
}

/** Todos os 7 dias em minutos (para mandar ao navegador). */
export function weekMinutes(week: WeeklySchedule, defaultSlot: number): Record<number, DayMinutes | null> {
  const out: Record<number, DayMinutes | null> = {};
  for (let d = 0; d < 7; d++) out[d] = dayMinutes(week, d, defaultSlot);
  return out;
}

/** A data (AAAA-MM-DD) cai numa ausência? Devolve a ausência. */
export function absenceOn(absences: readonly DateRange[] | undefined, date: string): DateRange | null {
  return absences?.find((a) => a.startsOn <= date && date <= a.endsOn) ?? null;
}

/** Minutos de atendimento no dia (soma dos períodos). */
export const dayLength = (d: DayMinutes) => d.periods.reduce((s, p) => s + (p.end - p.start), 0);

/** Capacidade semanal: horas e número de consultas. */
export function weeklyCapacity(week: WeeklySchedule, defaultSlot: number): { minutes: number; slots: number; days: number } {
  let minutes = 0;
  let slots = 0;
  let days = 0;
  for (let d = 0; d < 7; d++) {
    const day = dayMinutes(week, d, defaultSlot);
    if (!day) continue;
    days++;
    minutes += dayLength(day);
    slots += day.periods.reduce((s, p) => s + Math.floor((p.end - p.start) / day.slot), 0);
  }
  return { minutes, slots, days };
}

/**
 * O horário [start, end) (minutos) cabe no dia? Devolve o motivo quando não cabe.
 * Usado para avisar ao marcar fora do expediente (o aviso não impede).
 */
export function fitsDay(day: DayMinutes | null, start: number, end: number): { ok: true } | { ok: false; reason: "dia" | "fora" | "intervalo" } {
  if (!day) return { ok: false, reason: "dia" };
  if (day.periods.some((p) => start >= p.start && end <= p.end)) return { ok: true };
  if (start < day.start || end > day.end) return { ok: false, reason: "fora" };
  return { ok: false, reason: "intervalo" };
}

/** "08:00 às 12:00 e 14:00 às 18:00" */
export function describePeriods(day: DayMinutes | DaySchedule): string {
  const list = "start" in day && typeof day.start === "number" ? (day as DayMinutes).periods.map((p) => [toHHMM(p.start), toHHMM(p.end)]) : (day as DaySchedule).periods.map((p) => [p.start, p.end]);
  const parts = list.map(([a, b]) => `${a} às ${b}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/**
 * Colunas antigas (expediente único) derivadas da semana, para quem ainda lê
 * work_start/work_end/break_*: primeiro início, último fim e o primeiro intervalo.
 */
export function legacyFromWeekly(week: WeeklySchedule): { workDays: number[]; workStart: string; workEnd: string; breakStart: string | null; breakEnd: string | null } {
  const days = WEEKDAY_KEYS.filter((k) => week[k]?.periods.length).map(Number);
  const all = days.map((d) => dayMinutes(week, d, 30)!);
  const start = Math.min(...all.map((d) => d.start));
  const end = Math.max(...all.map((d) => d.end));
  const gap = all.find((d) => d.gaps.length)?.gaps[0] ?? null;
  return { workDays: days, workStart: toHHMM(start), workEnd: toHHMM(end), breakStart: gap ? toHHMM(gap.start) : null, breakEnd: gap ? toHHMM(gap.end) : null };
}

/**
 * Valida uma semana vinda do formulário. Devolve a lista de problemas
 * (vazia = válida), em português, prontos para a tela.
 */
export function validateWeekly(week: WeeklySchedule, defaultSlot: number): string[] {
  const issues: string[] = [];
  const days = WEEKDAY_KEYS.filter((k) => week[k]);
  if (!days.length) issues.push("Marque pelo menos um dia de atendimento.");
  for (const k of days) {
    const day = week[k]!;
    const name = WEEKDAY_LONG[Number(k)];
    const slot = day.slotMinutes ?? defaultSlot;
    if (!day.periods.length) issues.push(`${name}: inclua pelo menos um período.`);
    if (day.periods.length > 4) issues.push(`${name}: no máximo 4 períodos.`);
    if (day.slotMinutes !== undefined && (day.slotMinutes < 5 || day.slotMinutes > 240)) issues.push(`${name}: duração entre 5 minutos e 4 horas.`);
    const ps = day.periods.map((p) => ({ s: toMinutes(p.start), e: toMinutes(p.end), raw: p })).sort((a, b) => a.s - b.s);
    ps.forEach((p, i) => {
      if (p.e <= p.s) issues.push(`${name}: ${p.raw.start} às ${p.raw.end}, o fim precisa ser depois do início.`);
      else if (p.e - p.s < slot) issues.push(`${name}: ${p.raw.start} às ${p.raw.end} é menor que uma consulta (${slot} min).`);
      const prev = ps[i - 1];
      if (prev && p.s < prev.e) issues.push(`${name}: os períodos ${prev.raw.start}-${prev.raw.end} e ${p.raw.start}-${p.raw.end} se sobrepõem.`);
    });
  }
  return issues;
}
