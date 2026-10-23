import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalAction, arrivalWindow } from "./arrival";

test("chegada só a partir de 30 minutos antes do horário", () => {
  const startsAt = new Date("2026-10-22T14:00:00Z");
  assert.deepEqual(arrivalWindow(startsAt, new Date("2026-10-22T13:29:00Z")), { open: false, opensAt: new Date("2026-10-22T13:30:00Z") });
  assert.equal(arrivalWindow(startsAt, new Date("2026-10-22T13:30:00Z")).open, true);
  // Atrasado também pode (o paciente chegou depois do horário)
  assert.equal(arrivalWindow(startsAt, new Date("2026-10-22T15:10:00Z")).open, true);
});

test("botão da linha: Chegou, Desfazer ou nenhum", () => {
  const base = { isToday: true, canMark: true, anonymized: false };
  assert.equal(arrivalAction({ ...base, flow: "aguardando" }), "chegou");
  assert.equal(arrivalAction({ ...base, flow: "chegou" }), "desfazer");
  // Triagem ou atendimento já começaram: desfazer só pela agenda, com cuidado
  for (const flow of ["triado", "em_atendimento", "finalizado", "faltou"] as const) assert.equal(arrivalAction({ ...base, flow }), null);
  assert.equal(arrivalAction({ ...base, flow: "aguardando", isToday: false }), null);
  assert.equal(arrivalAction({ ...base, flow: "aguardando", canMark: false }), null);
  assert.equal(arrivalAction({ ...base, flow: "aguardando", anonymized: true }), null);
});
