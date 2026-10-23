/**
 * UNIDADES DE ATENDIMENTO E CONSULTÓRIOS (regras sem banco)
 *
 *   Clínica ──< Unidade (endereço) ──< Consultório / sala
 *
 * - Toda clínica tem pelo menos uma unidade (a principal). Clínica de um endereço só nem
 *   percebe: a unidade principal é criada sozinha e as telas escondem a escolha.
 * - A semana do profissional diz, em CADA PERÍODO, em qual unidade ele atende e, se quiser,
 *   em qual consultório fixo (ex.: seg de manhã no Centro, consultório 2; à tarde no Bairro).
 * - Ao marcar, a consulta herda a unidade e o consultório do período. Sem consultório fixo,
 *   o Tropi escolhe um livre da unidade. O banco impede duas consultas no mesmo consultório
 *   ao mesmo tempo (restrição de exclusão, migração 0032).
 */
import { toMinutes, WEEKDAY_KEYS, WEEKDAY_LONG, type TimePeriod, type WeeklySchedule } from "./hours";
import { closureOn, type Closure } from "./opening";
import { utcToZoned } from "./time";

export const ROOM_KINDS = ["consultorio", "procedimento", "exame", "triagem", "outro"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const ROOM_KIND_LABEL: Record<RoomKind, string> = {
  consultorio: "Consultório",
  procedimento: "Sala de procedimentos",
  exame: "Sala de exames",
  triagem: "Triagem / enfermagem",
  outro: "Outra sala",
};

/** Só estes tipos recebem consultas automaticamente (os demais são escolhidos à mão) */
export const BOOKABLE_ROOM_KINDS: readonly RoomKind[] = ["consultorio", "procedimento", "exame"];

export interface UnitRef {
  id: string;
  name: string;
  main: boolean;
  active: boolean;
}

export interface RoomRef {
  id: string;
  unitId: string;
  name: string;
  kind: RoomKind;
  active: boolean;
}

/** O período da semana que contém o horário [start, end) em minutos (null = fora do expediente) */
export function periodAt(week: WeeklySchedule, weekday: number, start: number, end: number): TimePeriod | null {
  const day = week[String(weekday) as keyof WeeklySchedule];
  return day?.periods.find((p) => start >= toMinutes(p.start) && end <= toMinutes(p.end)) ?? null;
}

/**
 * Unidade em que o profissional atende num dia/horário. Fora do expediente: a unidade do
 * período mais próximo do dia; sem nada no dia, a principal.
 */
export function unitAt(week: WeeklySchedule, weekday: number, start: number, end: number, mainUnitId: string): string {
  const exact = periodAt(week, weekday, start, end);
  if (exact) return exact.unitId ?? mainUnitId;
  const day = week[String(weekday) as keyof WeeklySchedule];
  if (!day?.periods.length) return mainUnitId;
  const nearest = [...day.periods].sort((a, b) => Math.abs(toMinutes(a.start) - start) - Math.abs(toMinutes(b.start) - start))[0]!;
  return nearest.unitId ?? mainUnitId;
}

/** Unidades em que o profissional atende ao longo da semana */
export function unitsOfWeek(week: WeeklySchedule, mainUnitId: string): string[] {
  const set = new Set<string>();
  for (const k of WEEKDAY_KEYS) for (const p of week[k]?.periods ?? []) set.add(p.unitId ?? mainUnitId);
  return [...set];
}

/**
 * Confere unidades e consultórios da semana: existem, estão ativos e o consultório é da
 * unidade do período. Devolve problemas em português (vazio = ok).
 */
export function validateWeekPlaces(week: WeeklySchedule, units: readonly UnitRef[], rooms: readonly RoomRef[]): string[] {
  const issues: string[] = [];
  for (const k of WEEKDAY_KEYS) {
    for (const p of week[k]?.periods ?? []) {
      const where = `${WEEKDAY_LONG[Number(k)]} ${p.start}-${p.end}`;
      const unit = p.unitId ? units.find((u) => u.id === p.unitId) : units.find((u) => u.main);
      if (p.unitId && (!unit || !unit.active)) issues.push(`${where}: unidade desativada ou inexistente.`);
      if (p.roomId) {
        const room = rooms.find((r) => r.id === p.roomId);
        if (!room || !room.active) issues.push(`${where}: consultório desativado ou inexistente.`);
        else if (unit && room.unitId !== unit.id) issues.push(`${where}: o consultório ${room.name} é de outra unidade.`);
      }
    }
  }
  return issues;
}

export interface FixedRoomClash {
  roomId: string;
  weekday: number;
  /** "08:00-12:00" */
  mine: string;
  /** Profissional com quem o consultório fica dividido */
  other: string;
  theirs: string;
}

/**
 * Consultório FIXO usado por dois profissionais no mesmo dia e horário da semana.
 * Não é proibido (a clínica pode revezar), mas a agenda vai recusar a segunda consulta
 * que cair no mesmo horário: o ajuste do profissional avisa antes de salvar.
 */
export function fixedRoomClashes(week: WeeklySchedule, others: readonly { name: string; week: WeeklySchedule }[]): FixedRoomClash[] {
  const out: FixedRoomClash[] = [];
  for (const k of WEEKDAY_KEYS) {
    for (const p of week[k]?.periods ?? []) {
      if (!p.roomId) continue;
      const a = { s: toMinutes(p.start), e: toMinutes(p.end) };
      for (const o of others) {
        for (const q of o.week[k]?.periods ?? []) {
          if (q.roomId !== p.roomId) continue;
          if (a.s < toMinutes(q.end) && toMinutes(q.start) < a.e) out.push({ roomId: p.roomId, weekday: Number(k), mine: `${p.start}-${p.end}`, other: o.name, theirs: `${q.start}-${q.end}` });
        }
      }
    }
  }
  return out;
}

/** Endereço em uma linha: "Rua X, 100, Centro, Porto Alegre - RS, CEP 90000-000" */
export function formatAddress(u: { address?: string | null; district?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string {
  const cityUf = [u.city, u.state].filter(Boolean).join(" - ");
  const zip = u.zip && /^\d{8}$/.test(u.zip) ? `CEP ${u.zip.slice(0, 5)}-${u.zip.slice(5)}` : null;
  return [u.address, u.district, cityUf, zip].filter(Boolean).join(", ");
}

/**
 * Troca de unidade no mesmo dia com pouco tempo entre os períodos (ex.: sai do Centro às
 * 12:00 e começa no Bairro às 12:15). Não é proibido, mas o ajuste avisa: deslocamento.
 */
export function tightUnitChanges(week: WeeklySchedule, mainUnitId: string, minGap = 30): { weekday: number; from: string; to: string; gap: number }[] {
  const out: { weekday: number; from: string; to: string; gap: number }[] = [];
  for (const k of WEEKDAY_KEYS) {
    const ps = [...(week[k]?.periods ?? [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1]!;
      const b = ps[i]!;
      if ((a.unitId ?? mainUnitId) === (b.unitId ?? mainUnitId)) continue;
      const gap = toMinutes(b.start) - toMinutes(a.end);
      if (gap < minGap) out.push({ weekday: Number(k), from: a.end, to: b.start, gap });
    }
  }
  return out;
}

/** Só os períodos da semana numa unidade (ex.: horários livres da agenda da Unidade Centro) */
export function weekInUnit(week: WeeklySchedule, unitId: string, mainUnitId: string): WeeklySchedule {
  const out: WeeklySchedule = {};
  for (const k of WEEKDAY_KEYS) {
    const day = week[k];
    if (!day) continue;
    const periods = day.periods.filter((p) => (p.unitId ?? mainUnitId) === unitId);
    if (periods.length) out[k] = { ...day, periods };
  }
  return out;
}

/* --------------------------- Horários x consultórios --------------------------- */

/**
 * Tudo que é preciso para saber se um horário livre do profissional também tem consultório.
 * Montado uma vez por busca (no servidor) e usado em cada horário candidato.
 */
export interface RoomSlotContext {
  /** Semana do profissional (unidade e consultório fixo por período) */
  week: WeeklySchedule;
  mainUnitId: string;
  /** Unidades ativas (unidade desativada cai na principal, como na marcação) */
  activeUnitIds: ReadonlySet<string>;
  /** Consultórios ATIVOS de todas as unidades, já na ordem de preferência (ordem e nome) */
  rooms: readonly Pick<RoomRef, "id" | "unitId" | "name" | "kind">[];
  /** Consultas não canceladas com consultório, no intervalo da busca */
  roomBusy: readonly { roomId: string; startsAt: Date; endsAt: Date }[];
  /** Fuso da clínica (padrão: o da sessão) */
  tz?: string;
  /** Feriados e fechamentos: unidade fechada no dia não tem horário (opening.ts) */
  closures?: readonly Closure[];
}

/** Onde o horário aconteceria. roomId null = unidade sem controle de consultórios. */
export interface RoomPick {
  unitId: string;
  roomId: string | null;
  roomName: string | null;
}

/**
 * Consultório para um horário livre do profissional. MESMA regra da marcação
 * (apps/app/src/modules/crm/units.ts > placeFor), para a sala sugerida ser a que a consulta recebe:
 *   1. unidade = a do período da semana (unidade desativada: a principal);
 *   2. consultório fixo do período, se estiver livre;
 *   3. senão, o primeiro consultório livre que recebe consulta (consultório, procedimento, exame);
 *   4. unidade SEM consultório que recebe consulta cadastrado: não há controle de sala,
 *      o horário vale sem sala (clínica que não usa o cadastro de consultórios não muda nada).
 * Devolve null quando a unidade está FECHADA no dia (feriado, recesso) ou quando ela controla
 * consultórios e TODOS estão ocupados: o horário sai da lista.
 */
export function roomForSlot(ctx: RoomSlotContext, slot: { startsAt: Date; endsAt: Date }): RoomPick | null {
  const z = utcToZoned(slot.startsAt, ctx.tz);
  const end = z.minutes + Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000);
  let unitId = unitAt(ctx.week, z.weekday, z.minutes, end, ctx.mainUnitId);
  if (!ctx.activeUnitIds.has(unitId)) unitId = ctx.mainUnitId;
  // Feriado ou fechamento da unidade (ou da clínica inteira) nesse dia
  if (ctx.closures?.length && closureOn(ctx.closures, unitId, z.date)) return null;

  const unitRooms = ctx.rooms.filter((r) => r.unitId === unitId);
  const busy = new Set(ctx.roomBusy.filter((b) => b.startsAt < slot.endsAt && b.endsAt > slot.startsAt).map((b) => b.roomId));
  const fixedId = periodAt(ctx.week, z.weekday, z.minutes, end)?.roomId;
  const fixed = fixedId ? unitRooms.find((r) => r.id === fixedId) : undefined;
  if (fixed && !busy.has(fixed.id)) return { unitId, roomId: fixed.id, roomName: fixed.name };
  const bookable = unitRooms.filter((r) => BOOKABLE_ROOM_KINDS.includes(r.kind));
  const free = bookable.find((r) => !busy.has(r.id));
  if (free) return { unitId, roomId: free.id, roomName: free.name };
  // Sem consultório que recebe consulta cadastrado (nem fixo): a unidade não controla salas
  if (!bookable.length && !fixed) return { unitId, roomId: null, roomName: null };
  return null;
}
