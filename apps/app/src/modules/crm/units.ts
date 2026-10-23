import "server-only";
import { BOOKABLE_ROOM_KINDS, formatAddress, periodAt, roomForSlot, unitAt, utcToZoned, weeklyOf, type RoomPick, type RoomRef, type RoomSlotContext, type TimeRange, type UnitRef } from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, inArray, lt, ne, schema, sql, type Tx } from "@ecosaude/db";
import { loadClosures } from "./opening";

/**
 * UNIDADES E CONSULTÓRIOS no servidor.
 *
 * placeFor(): onde uma consulta acontece. Regra:
 *   1. unidade = a do período da semana do profissional naquele horário (sem período: a mais
 *      próxima do dia; sem nada: a principal);
 *   2. consultório = o fixo do período, se estiver livre;
 *   3. senão, o primeiro consultório livre da unidade (tipos que recebem consulta);
 *   4. sem nenhum livre (ou unidade sem consultórios cadastrados): sem consultório. A recepção
 *      pode escolher depois em "Editar detalhes".
 * O banco é a última palavra: dois agendamentos no mesmo consultório ao mesmo tempo são recusados.
 */

export type UnitRow = typeof schema.clinicUnits.$inferSelect;
export type RoomRow = typeof schema.clinicRooms.$inferSelect;

export async function listUnits(tx: Tx): Promise<UnitRow[]> {
  return tx.select().from(schema.clinicUnits).orderBy(desc(schema.clinicUnits.main), asc(schema.clinicUnits.sortOrder), asc(schema.clinicUnits.name));
}

export async function listRooms(tx: Tx): Promise<RoomRow[]> {
  return tx.select().from(schema.clinicRooms).orderBy(asc(schema.clinicRooms.sortOrder), asc(schema.clinicRooms.name));
}

export async function mainUnit(tx: Tx): Promise<UnitRow> {
  const [u] = await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.main, true)).limit(1);
  if (u) return u;
  // Clínica criada antes do gatilho (não deveria acontecer): cria a principal agora
  const [created] = await tx.insert(schema.clinicUnits).values({ name: "Unidade principal", main: true }).returning();
  return created!;
}

export const toUnitRef = (u: UnitRow): UnitRef => ({ id: u.id, name: u.name, main: u.main, active: u.active });
export const toRoomRef = (r: RoomRow): RoomRef => ({ id: r.id, unitId: r.unitId, name: r.name, kind: r.kind, active: r.active });

/** Consultórios ocupados no intervalo (consultas não canceladas) */
async function busyRooms(tx: Tx, roomIds: string[], startsAt: Date, endsAt: Date, excludeAppointmentId?: string): Promise<Set<string>> {
  if (!roomIds.length) return new Set();
  const rows = await tx
    .select({ roomId: schema.appointments.roomId })
    .from(schema.appointments)
    .where(
      and(
        inArray(schema.appointments.roomId, roomIds),
        ne(schema.appointments.status, "cancelado"),
        lt(schema.appointments.startsAt, endsAt),
        gt(schema.appointments.endsAt, startsAt),
        excludeAppointmentId ? ne(schema.appointments.id, excludeAppointmentId) : undefined,
      ),
    );
  return new Set(rows.map((r) => r.roomId!).filter(Boolean));
}

export async function placeFor(
  tx: Tx,
  pro: typeof schema.professionals.$inferSelect,
  startsAt: Date,
  endsAt: Date,
  opts: { excludeAppointmentId?: string } = {},
): Promise<{ unitId: string; roomId: string | null }> {
  const main = await mainUnit(tx);
  const week = weeklyOf(pro);
  const z = utcToZoned(startsAt);
  const end = z.minutes + Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  let unitId = unitAt(week, z.weekday, z.minutes, end, main.id);
  // Unidade desativada depois de configurada: cai na principal
  const [unit] = await tx.select({ active: schema.clinicUnits.active }).from(schema.clinicUnits).where(eq(schema.clinicUnits.id, unitId));
  if (!unit?.active) unitId = main.id;

  const rooms = await tx
    .select({ id: schema.clinicRooms.id, kind: schema.clinicRooms.kind })
    .from(schema.clinicRooms)
    .where(and(eq(schema.clinicRooms.unitId, unitId), eq(schema.clinicRooms.active, true)))
    .orderBy(asc(schema.clinicRooms.sortOrder), asc(schema.clinicRooms.name));
  if (!rooms.length) return { unitId, roomId: null };
  const busy = await busyRooms(
    tx,
    rooms.map((r) => r.id),
    startsAt,
    endsAt,
    opts.excludeAppointmentId,
  );
  const fixed = periodAt(week, z.weekday, z.minutes, end)?.roomId;
  if (fixed && rooms.some((r) => r.id === fixed) && !busy.has(fixed)) return { unitId, roomId: fixed };
  const free = rooms.find((r) => BOOKABLE_ROOM_KINDS.includes(r.kind) && !busy.has(r.id));
  return { unitId, roomId: free?.id ?? null };
}

/** Consultórios livres de uma unidade num horário (para trocar o consultório da consulta) */
export async function freeRoomsAt(tx: Tx, unitId: string, startsAt: Date, endsAt: Date, excludeAppointmentId?: string) {
  const rooms = await tx
    .select()
    .from(schema.clinicRooms)
    .where(and(eq(schema.clinicRooms.unitId, unitId), eq(schema.clinicRooms.active, true)))
    .orderBy(asc(schema.clinicRooms.sortOrder), asc(schema.clinicRooms.name));
  const busy = await busyRooms(
    tx,
    rooms.map((r) => r.id),
    startsAt,
    endsAt,
    excludeAppointmentId,
  );
  return rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, free: !busy.has(r.id) }));
}

/* ------------------------ Horários livres x consultórios ------------------------ */

/** O que vale para todos os profissionais numa busca: unidades, consultórios e ocupação das salas */
export type RoomSlotBase = Omit<RoomSlotContext, "week">;

/**
 * Carrega, UMA vez por busca, o necessário para saber se um horário livre vale de verdade:
 * unidades ativas, consultórios ativos (na ordem de preferência), consultas com sala no
 * intervalo e os feriados/fechamentos (unidade fechada no dia não tem horário).
 * `excludeAppointmentId`: ao remarcar, a sala da própria consulta conta como livre.
 */
export async function roomSlotBase(tx: Tx, from: Date, until: Date, excludeAppointmentId?: string): Promise<RoomSlotBase> {
  const main = await mainUnit(tx);
  const units = await tx.select({ id: schema.clinicUnits.id }).from(schema.clinicUnits).where(eq(schema.clinicUnits.active, true));
  const rooms = await tx
    .select({ id: schema.clinicRooms.id, unitId: schema.clinicRooms.unitId, name: schema.clinicRooms.name, kind: schema.clinicRooms.kind })
    .from(schema.clinicRooms)
    .where(eq(schema.clinicRooms.active, true))
    .orderBy(asc(schema.clinicRooms.sortOrder), asc(schema.clinicRooms.name));
  const busy = rooms.length
    ? await tx
        .select({ roomId: schema.appointments.roomId, startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt })
        .from(schema.appointments)
        .where(
          and(
            inArray(
              schema.appointments.roomId,
              rooms.map((r) => r.id),
            ),
            ne(schema.appointments.status, "cancelado"),
            lt(schema.appointments.startsAt, until),
            gt(schema.appointments.endsAt, from),
            excludeAppointmentId ? ne(schema.appointments.id, excludeAppointmentId) : undefined,
          ),
        )
    : [];
  return {
    mainUnitId: main.id,
    activeUnitIds: new Set(units.map((u) => u.id)),
    rooms,
    roomBusy: busy.filter((b) => b.roomId).map((b) => ({ roomId: b.roomId!, startsAt: b.startsAt, endsAt: b.endsAt })),
    // Feriados e fechamentos no período: a unidade fechada no dia não oferece horário
    closures: await loadClosures(tx, utcToZoned(from).date, utcToZoned(until).date),
  };
}

/**
 * Filtro de horários de UM profissional: `accept` (tem consultório?) para findFreeSlots e
 * `pick` (unidade e sala sugeridas) para mostrar na tela. Mesma regra da marcação (placeFor).
 */
export function roomFilter(base: RoomSlotBase, pro: Parameters<typeof weeklyOf>[0]) {
  const ctx: RoomSlotContext = { ...base, week: weeklyOf(pro) };
  return {
    accept: (slot: TimeRange) => roomForSlot(ctx, slot) !== null,
    pick: (slot: TimeRange): RoomPick | null => roomForSlot(ctx, slot),
  };
}

/** Atalho para buscas de um profissional só (carrega a base e devolve o filtro) */
export async function roomFilterFor(tx: Tx, pro: typeof schema.professionals.$inferSelect, from: Date, until: Date, excludeAppointmentId?: string) {
  return roomFilter(await roomSlotBase(tx, from, until, excludeAppointmentId), pro);
}

/**
 * Unidades que a pessoa vê na agenda, no Hoje e no Consultório. Vazio no cadastro = todas.
 * Devolve null quando não há restrição (todas as unidades).
 */
export function unitScope(userUnitIds: readonly string[] | null | undefined): string[] | null {
  return userUnitIds && userUnitIds.length ? [...userUnitIds] : null;
}

/** Filtro SQL de consultas pelas unidades permitidas (null = sem filtro) */
export function inUnits(unitIds: string[] | null) {
  return unitIds ? inArray(schema.appointments.unitId, unitIds) : undefined;
}

/** Uma clínica com mais de uma unidade ativa? (as telas só mostram a escolha nesse caso) */
export async function isMultiUnit(tx: Tx): Promise<boolean> {
  const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from clinic_units where active`);
  return (r.rows[0]?.n ?? 0) > 1;
}

export interface UnitView {
  /** Unidades ativas que a pessoa pode ver */
  units: UnitRow[];
  /** Unidade escolhida na tela (null = todas as permitidas) */
  selected: string | null;
  /** Filtro final de consultas: as unidades visíveis (null = sem filtro) */
  filter: string[] | null;
  /** Sem restrição no acesso: pode ver "todas as unidades" */
  allUnits: boolean;
  multi: boolean;
  mainId: string;
}

/**
 * Quais unidades a tela mostra: as permitidas no acesso da pessoa (vazio = todas), e dentre
 * elas a escolhida (?unidade=). Pessoa restrita a uma unidade só: já vem escolhida.
 */
export async function resolveUnitView(tx: Tx, userUnitIds: readonly string[], requested: string | null | undefined): Promise<UnitView> {
  const all = (await listUnits(tx)).filter((u) => u.active);
  const main = all.find((u) => u.main) ?? (await mainUnit(tx));
  const restricted = userUnitIds.length > 0;
  const units = restricted ? all.filter((u) => userUnitIds.includes(u.id)) : all;
  const visible = units.length ? units : [main];
  const selected = requested && visible.some((u) => u.id === requested) ? requested : restricted && visible.length === 1 ? visible[0]!.id : null;
  const filter = selected ? [selected] : restricted ? visible.map((u) => u.id) : null;
  return { units: visible, selected, filter, allUnits: !restricted, multi: all.length > 1, mainId: main.id };
}

/**
 * Variáveis de LOCAL das mensagens ao paciente:
 *  - {{local}}: ", na Unidade Centro (Rua X, 100)", só quando a clínica tem mais de uma unidade
 *    (com um endereço só, some e o texto fica igual ao de sempre);
 *  - {{endereco}}: endereço da unidade; {{consultorio}}: nome do consultório.
 */
export async function placeVars(tx: Tx, unitId: string | null | undefined, roomId?: string | null): Promise<{ local?: string; endereco?: string; consultorio?: string }> {
  if (!unitId) return {};
  const [u] = await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.id, unitId));
  if (!u) return {};
  const address = formatAddress(u);
  const multi = await isMultiUnit(tx);
  const [room] = roomId ? await tx.select({ name: schema.clinicRooms.name }).from(schema.clinicRooms).where(eq(schema.clinicRooms.id, roomId)) : [];
  return {
    local: multi ? `, na ${u.name}${address ? ` (${address})` : ""}` : undefined,
    endereco: address || undefined,
    consultorio: room?.name,
  };
}
