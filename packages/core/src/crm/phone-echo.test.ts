import assert from "node:assert/strict";
import { test } from "node:test";
import { isEchoOf, isFromPhone, isHumanOutbound, PHONE_SOURCE } from "./phone-echo";

test("resposta humana: com autor ou pelo celular; automática não conta", () => {
  assert.equal(isHumanOutbound({ direction: "out", authorId: "u1", meta: null }), true);
  assert.equal(isHumanOutbound({ direction: "out", authorId: null, meta: { source: PHONE_SOURCE } }), true);
  assert.equal(isHumanOutbound({ direction: "out", authorId: null, meta: { kind: "lembrete" } }), false);
  assert.equal(isHumanOutbound({ direction: "in", authorId: null, meta: { source: PHONE_SOURCE } }), false);
  assert.equal(isFromPhone(null), false);
  assert.equal(isFromPhone({ source: "celular" }), true);
});

test("eco do que o Tropi acabou de enviar: mesmo texto e há pouco tempo", () => {
  const at = new Date("2026-10-23T12:00:00Z");
  const later = (s: number) => new Date(at.getTime() + s * 1000);
  assert.equal(isEchoOf({ text: "Pode vir às 14h ", at: later(3) }, { body: "pode vir às  14h", at }), true);
  assert.equal(isEchoOf({ text: "Pode vir às 15h", at: later(3) }, { body: "Pode vir às 14h", at }), false);
  // Mesmo texto, mas muito depois: é outra mensagem (digitada de novo no celular)
  assert.equal(isEchoOf({ text: "Ok", at: later(15 * 60) }, { body: "Ok", at }), false);
  // Anexo sem legenda: o eco traz o rótulo
  assert.equal(isEchoOf({ text: "[documento: exame.pdf]", at: later(5) }, { body: "", at, attachmentLabel: "[documento: exame.pdf]" }), true);
});
