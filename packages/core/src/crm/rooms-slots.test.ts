import assert from "node:assert/strict";
import { test } from "node:test";
import type { WeeklySchedule } from "./hours";
import { findFreeSlots } from "./scheduling";
import { zonedToUtc } from "./time";
import { roomForSlot, type RoomSlotContext } from "./units";

const TZ = "America/Sao_Paulo";
const MAIN = "u-main";
const CENTRO = "u-centro";
const C1 = { id: "r-c1", unitId: MAIN, name: "Consultório 1", kind: "consultorio" as const };
const C2 = { id: "r-c2", unitId: MAIN, name: "Consultório 2", kind: "consultorio" as const };
const TRI = { id: "r-tri", unitId: MAIN, name: "Triagem", kind: "triagem" as const };
const S1 = { id: "r-s1", unitId: CENTRO, name: "Sala 1", kind: "consultorio" as const };

// 2026-10-26 é segunda-feira (weekday 1)
const DAY = "2026-10-26";
const at = (hhmm: string, minutes = 30) => {
  const startsAt = zonedToUtc(DAY, hhmm, TZ);
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
};
const busy = (roomId: string, hhmm: string, minutes = 30) => ({ roomId, ...at(hhmm, minutes) });

function ctx(week: WeeklySchedule, roomBusy: RoomSlotContext["roomBusy"] = [], rooms: RoomSlotContext["rooms"] = [C1, C2, TRI, S1]): RoomSlotContext {
  return { week, mainUnitId: MAIN, activeUnitIds: new Set([MAIN, CENTRO]), rooms, roomBusy, tz: TZ };
}

test("sem sala fixa: primeiro consultório livre da unidade, na ordem do cadastro", () => {
  const week: WeeklySchedule = { "1": { periods: [{ start: "08:00", end: "12:00" }] } };
  assert.deepEqual(roomForSlot(ctx(week), at("09:00")), { unitId: MAIN, roomId: C1.id, roomName: "Consultório 1" });
  // C1 ocupado (outro profissional): sugere C2
  assert.equal(roomForSlot(ctx(week, [busy(C1.id, "09:00")]), at("09:00"))?.roomId, C2.id);
  // Encostado não é conflito (09:30 começa quando o outro termina)
  assert.equal(roomForSlot(ctx(week, [busy(C1.id, "09:00")]), at("09:30"))?.roomId, C1.id);
});

test("todos os consultórios que recebem consulta ocupados: o horário sai (sala de triagem não conta)", () => {
  const week: WeeklySchedule = { "1": { periods: [{ start: "08:00", end: "12:00" }] } };
  assert.equal(roomForSlot(ctx(week, [busy(C1.id, "09:00"), busy(C2.id, "08:45", 60)]), at("09:00")), null);
});

test("sala fixa do período: usada se livre; ocupada, cai para outra livre", () => {
  const week: WeeklySchedule = { "1": { periods: [{ start: "08:00", end: "12:00", unitId: MAIN, roomId: C2.id }] } };
  assert.equal(roomForSlot(ctx(week), at("10:00"))?.roomId, C2.id);
  assert.equal(roomForSlot(ctx(week, [busy(C2.id, "10:00")]), at("10:00"))?.roomId, C1.id);
});

test("unidade do período, unidade desativada e unidade sem consultórios", () => {
  const week: WeeklySchedule = { "1": { periods: [{ start: "14:00", end: "18:00", unitId: CENTRO }] } };
  assert.deepEqual(roomForSlot(ctx(week), at("15:00")), { unitId: CENTRO, roomId: S1.id, roomName: "Sala 1" });
  assert.equal(roomForSlot(ctx(week, [busy(S1.id, "15:00")]), at("15:00")), null);
  // Centro desativado: vai para a principal (como na marcação)
  assert.equal(roomForSlot({ ...ctx(week), activeUnitIds: new Set([MAIN]) }, at("15:00"))?.unitId, MAIN);
  // Unidade sem consultório que recebe consulta: sem controle de sala, horário vale sem sala
  assert.deepEqual(roomForSlot(ctx(week, [], [C1, TRI]), at("15:00")), { unitId: CENTRO, roomId: null, roomName: null });
  assert.deepEqual(roomForSlot(ctx(week, [], [C1, { ...TRI, unitId: CENTRO }]), at("15:00")), { unitId: CENTRO, roomId: null, roomName: null });
});

test("busca de horários pula os sem consultório e continua até o limite", () => {
  const week: WeeklySchedule = { "1": { periods: [{ start: "08:00", end: "10:00" }] } };
  const rooms = [C1];
  const roomBusy = [busy(C1.id, "08:00", 60)]; // sala única ocupada das 08:00 às 09:00 por outro profissional
  const c = ctx(week, roomBusy, rooms);
  const slots = findFreeSlots({
    schedule: { week, slotMinutes: 30 },
    busy: [],
    from: zonedToUtc(DAY, "07:00", TZ),
    days: 1,
    limit: 2,
    minLeadMinutes: 0,
    tz: TZ,
    accept: (s) => roomForSlot(c, s) !== null,
  });
  assert.deepEqual(
    slots.map((s) => s.startsAt.toISOString()),
    [zonedToUtc(DAY, "09:00", TZ).toISOString(), zonedToUtc(DAY, "09:30", TZ).toISOString()],
  );
});

test("feriado ou fechamento da unidade tira o dia inteiro (com ou sem consultórios)", () => {
  const week: WeeklySchedule = { "1": { periods: [{ start: "08:00", end: "12:00" }] } };
  const closures = [{ unitId: MAIN, startsOn: DAY, endsOn: DAY, reason: "Feriado municipal", kind: "feriado" as const }];
  assert.equal(roomForSlot({ ...ctx(week), closures }, at("09:00")), null);
  assert.equal(roomForSlot({ ...ctx(week, [], []), closures }, at("09:00")), null);
  // Fechamento de outra unidade não afeta; da clínica inteira (unitId null) afeta
  assert.equal(roomForSlot({ ...ctx(week), closures: [{ ...closures[0]!, unitId: CENTRO }] }, at("09:00"))?.roomId, C1.id);
  assert.equal(roomForSlot({ ...ctx(week), closures: [{ ...closures[0]!, unitId: null }] }, at("09:00")), null);
});
