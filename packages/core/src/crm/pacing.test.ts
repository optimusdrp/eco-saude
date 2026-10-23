import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PACING, drainMinutes, formatDrain, isPacedMessage, nextGapMs, pacingCheck, pacingFrom, pacingTraits, PACING_PRESETS, staleReason, validatePacing } from "./pacing";

const now = new Date("2026-10-23T13:00:00Z");

test("padrão é o cauteloso; sugestão sempre usa os números da sugestão", () => {
  assert.deepEqual(pacingFrom(null), DEFAULT_PACING);
  assert.equal(DEFAULT_PACING.perHour, 60);
  // Guardado com números velhos: valem os da sugestão
  assert.deepEqual(pacingFrom({ preset: "aquecido", perHour: 999 }), { preset: "aquecido", minGapS: 4, maxGapS: 12, perMinute: 8, perHour: 120 });
  assert.deepEqual(pacingFrom({ preset: "personalizado", minGapS: 5, maxGapS: 9, perMinute: 3, perHour: 30 }), { preset: "personalizado", minGapS: 5, maxGapS: 9, perMinute: 3, perHour: 30 });
  // Personalizado inválido (intervalo de 0 s): volta ao padrão, nunca fica sem ritmo
  assert.deepEqual(pacingFrom({ preset: "personalizado", minGapS: 0, maxGapS: 1, perMinute: 50, perHour: 9999 }), DEFAULT_PACING);
  assert.deepEqual(pacingFrom({ preset: "turbo" }), DEFAULT_PACING);
});

test("validação do personalizado", () => {
  assert.deepEqual(validatePacing({ minGapS: 4, maxGapS: 12, perMinute: 6, perHour: 60 }), []);
  assert.match(validatePacing({ minGapS: 1, maxGapS: 12, perMinute: 6, perHour: 60 })[0]!, /Intervalo mínimo/);
  assert.match(validatePacing({ minGapS: 10, maxGapS: 5, perMinute: 6, perHour: 60 })[0]!, /máximo não pode ser menor/);
  assert.match(validatePacing({ minGapS: 4, maxGapS: 12, perMinute: 10, perHour: 5 })[0]!, /por hora não pode ser menor/);
  assert.equal(validatePacing({ minGapS: 4.5, maxGapS: 12, perMinute: 6, perHour: 60 }).length, 1);
});

test("intervalo sorteado fica entre o mínimo e o máximo", () => {
  assert.equal(nextGapMs(PACING_PRESETS.cauteloso, () => 0), 4000);
  assert.equal(nextGapMs(PACING_PRESETS.cauteloso, () => 0.999999), 12000);
  for (let i = 0; i < 200; i++) {
    const g = nextGapMs(PACING_PRESETS.maxima);
    assert.ok(g >= 8000 && g <= 20000);
  }
});

test("é a vez? hora, minuto e intervalo, nessa ordem", () => {
  const c = PACING_PRESETS.cauteloso;
  assert.deepEqual(pacingCheck({ now, nextAt: null, sentLastMinute: 0, sentLastHour: 0, config: c }), { ok: true });
  assert.deepEqual(pacingCheck({ now, nextAt: new Date(now.getTime() + 3000), sentLastMinute: 0, sentLastHour: 0, config: c }), { ok: false, reason: "intervalo" });
  assert.deepEqual(pacingCheck({ now, nextAt: new Date(now.getTime() - 1), sentLastMinute: 6, sentLastHour: 6, config: c }), { ok: false, reason: "minuto" });
  assert.deepEqual(pacingCheck({ now, nextAt: null, sentLastMinute: 0, sentLastHour: 60, config: c }), { ok: false, reason: "hora" });
});

test("só a automática entra no ritmo; a digitada sai na hora", () => {
  assert.equal(isPacedMessage({ authorId: null }), true);
  assert.equal(isPacedMessage({ authorId: "u1" }), false);
});

test("venceu na fila: confirmação ou lembrete de consulta que começou; oferta expirada", () => {
  const past = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 3_600_000);
  assert.equal(staleReason({ templateKey: "lembrete", meta: { appointmentId: "a1" } }, { now, appointmentStartsAt: past }), "a consulta já começou");
  assert.equal(staleReason({ templateKey: "confirmacao", meta: { appointmentId: "a1" } }, { now, appointmentStartsAt: future }), null);
  assert.equal(staleReason({ templateKey: "confirmacao", meta: { appointmentId: "a1" } }, { now, appointmentExists: false }), "a consulta não existe mais");
  // Pós-consulta e falta são DEPOIS da consulta: não vencem por ela ter começado
  assert.equal(staleReason({ templateKey: "pos_consulta", meta: { appointmentId: "a1" } }, { now, appointmentStartsAt: past }), null);
  assert.equal(staleReason({ templateKey: "oferta", meta: { offerId: "o1" } }, { now, offerOpen: false }), "a oferta de horário já expirou");
  assert.equal(staleReason({ templateKey: "oferta", meta: { offerId: "o1" } }, { now, offerOpen: true }), null);
  assert.equal(staleReason({ templateKey: null, meta: null }, { now }), null);
});

test("previsão da fila respeita o limite por hora", () => {
  const c = PACING_PRESETS.cauteloso; // ~10 s cada, 60 por hora
  assert.equal(drainMinutes({ queued: 0, sentLastHour: 0, config: c }), 0);
  assert.equal(drainMinutes({ queued: 6, sentLastHour: 0, config: c }), 1);
  // 200: 60 agora (10 min), mais 3 lotes nas horas seguintes
  assert.equal(drainMinutes({ queued: 200, sentLastHour: 0, config: c }), 184);
  // Hora já cheia: tudo espera a janela andar
  assert.ok(drainMinutes({ queued: 10, sentLastHour: 60, config: c }) >= 60);
  assert.equal(formatDrain(184), "cerca de 3h05");
  assert.equal(formatDrain(25), "cerca de 25 min");
  assert.equal(formatDrain(0), "nada na fila");
  assert.deepEqual(pacingTraits(c), ["Intervalo de 4 a 12 s", "Até 6 por minuto e 60 por hora", "200 confirmações levam cerca de 3h05"]);
});
