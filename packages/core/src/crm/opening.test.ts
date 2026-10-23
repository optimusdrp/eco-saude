import assert from "node:assert/strict";
import { test } from "node:test";
import {
  afterHoursText,
  closureOn,
  describeHours,
  easterSunday,
  effectiveHours,
  isOpenAt,
  nationalHolidays,
  openStatus,
  periodsOutsideHours,
  validateOpeningHours,
  DEFAULT_OPENING_HOURS,
  type Closure,
  type OpeningHours,
} from "./opening";

const SEG_SEX: OpeningHours = Object.fromEntries(["1", "2", "3", "4", "5"].map((k) => [k, { periods: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }] }]));
const COM_SAB: OpeningHours = { ...SEG_SEX, "6": { periods: [{ start: "08:00", end: "12:00" }] } };

test("horário efetivo: próprio, senão o da principal, senão o padrão; {} é fechado e não herda", () => {
  assert.equal(effectiveHours({ openingHours: COM_SAB }, { openingHours: SEG_SEX }), COM_SAB);
  assert.equal(effectiveHours({ openingHours: null }, { openingHours: SEG_SEX }), SEG_SEX);
  assert.equal(effectiveHours({ openingHours: null }, { openingHours: null }), DEFAULT_OPENING_HOURS);
  assert.deepEqual(effectiveHours({ openingHours: {} }, { openingHours: SEG_SEX }), {});
});

test("aberto: dentro dos períodos, fechado no intervalo e no fim", () => {
  assert.equal(isOpenAt(SEG_SEX, 1, 9 * 60), true);
  assert.equal(isOpenAt(SEG_SEX, 1, 12 * 60 + 30), false); // almoço
  assert.equal(isOpenAt(SEG_SEX, 1, 18 * 60), false); // fecha às 18h
  assert.equal(isOpenAt(SEG_SEX, 6, 9 * 60), false);
  assert.equal(isOpenAt(COM_SAB, 6, 9 * 60), true);
});

test("fechamentos: da clínica valem para todas; da unidade só para ela; período inclusivo", () => {
  const closures: Closure[] = [
    { unitId: null, startsOn: "2026-12-24", endsOn: "2026-12-26", reason: "Recesso de Natal", kind: "recesso" },
    { unitId: "centro", startsOn: "2026-11-20", endsOn: "2026-11-20", reason: "Dedetização", kind: "outro" },
  ];
  assert.equal(closureOn(closures, "moinhos", "2026-12-26")?.reason, "Recesso de Natal");
  assert.equal(closureOn(closures, "moinhos", "2026-12-27"), null);
  assert.equal(closureOn(closures, "centro", "2026-11-20")?.reason, "Dedetização");
  assert.equal(closureOn(closures, "moinhos", "2026-11-20"), null);
  const st = openStatus({ hours: SEG_SEX, closures, unitId: "centro", date: "2026-11-20", weekday: 5, minutes: 600 });
  assert.equal(st.open, false);
  assert.equal(!st.open && st.reason, "fechamento");
  assert.equal(
    afterHoursText(openStatus({ hours: SEG_SEX, closures, unitId: "x", date: "2026-12-24", weekday: 4, minutes: 600 }), SEG_SEX),
    "seg a sex, 8h às 12h e 14h às 18h (hoje estamos fechados: Recesso de Natal, até 26/12)",
  );
});

test("horário legível agrupa dias iguais", () => {
  assert.equal(describeHours(COM_SAB), "seg a sex, 8h às 12h e 14h às 18h; sáb, 8h às 12h");
  assert.equal(describeHours({ "1": { periods: [{ start: "07:30", end: "19:00" }] }, "3": { periods: [{ start: "07:30", end: "19:00" }] } }), "seg, 7h30 às 19h; qua, 7h30 às 19h");
  assert.equal(describeHours({}), "fechado");
});

test("validação do horário", () => {
  assert.deepEqual(validateOpeningHours(SEG_SEX), []);
  assert.equal(validateOpeningHours({ "1": { periods: [{ start: "18:00", end: "08:00" }] } }).length, 1);
  assert.equal(validateOpeningHours({ "1": { periods: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "13:00" }] } })[0], "seg: períodos sobrepostos");
});

test("período do profissional fora do funcionamento da unidade vira aviso", () => {
  const week = { "1": { periods: [{ start: "08:00", end: "12:00" }, { start: "17:00", end: "19:00" }] }, "6": { periods: [{ start: "08:00", end: "12:00", unitId: "centro" }] } };
  const warnings = periodsOutsideHours(week, "main", (u) => (u === "centro" ? SEG_SEX : COM_SAB), (u) => (u === "centro" ? "Unidade Centro" : "Unidade Moinhos"));
  assert.deepEqual(warnings, ["seg 17:00-19:00 (Unidade Moinhos fechada em parte desse horário)", "sáb 08:00-12:00 (Unidade Centro não abre nesse dia)"]);
});

test("feriados nacionais: Páscoa e móveis corretos", () => {
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  const h26 = nationalHolidays(2026);
  assert.equal(h26.length, 10);
  assert.equal(h26.find((h) => h.name === "Sexta-feira Santa")?.date, "2026-04-03");
  assert.ok(h26.some((h) => h.date === "2026-11-20"));
  const all = nationalHolidays(2026, { optional: true });
  assert.equal(all.find((h) => h.name === "Carnaval (terça)")?.date, "2026-02-17");
  assert.equal(all.find((h) => h.name === "Corpus Christi")?.date, "2026-06-04");
});
