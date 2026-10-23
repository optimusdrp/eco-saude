import assert from "node:assert/strict";
import { test } from "node:test";
import { emergencyEmail, emergencyNoticeText, emergencyRecipients, shortQuote, shouldNoticeTriage, triageRecipients, urgentTriageNoticeText } from "./notices";

test("aviso de emergência vai para a gestão do prontuário, menos quem acessou e quem está inativo", () => {
  const users = [
    { id: "gestora", active: true, permissions: ["prontuario.modelos", "agenda.ver"] },
    { id: "medica", active: true, permissions: ["prontuario.ver", "prontuario.modelos"] },
    { id: "recepcao", active: true, permissions: ["agenda.ver"] },
    { id: "ex-gestor", active: false, permissions: ["prontuario.modelos"] },
  ];
  assert.deepEqual(emergencyRecipients(users, "medica"), ["gestora"]);
  assert.deepEqual(emergencyRecipients(users, "outra"), ["gestora", "medica"]);
  // A única gestora fez o acesso: ninguém é avisado (fica no registro)
  assert.deepEqual(emergencyRecipients([users[0]!], "gestora"), []);
});

test("triagem avisa só quando passa a ser urgente", () => {
  assert.equal(shouldNoticeTriage(null, "urgente"), true);
  assert.equal(shouldNoticeTriage("normal", "urgente"), true);
  assert.equal(shouldNoticeTriage("prioritario", "urgente"), true);
  assert.equal(shouldNoticeTriage("urgente", "urgente"), false);
  assert.equal(shouldNoticeTriage(null, "prioritario"), false);
  assert.equal(shouldNoticeTriage("urgente", "normal"), false);
});

test("triagem urgente avisa o profissional da consulta, se tiver acesso e não for quem registrou", () => {
  assert.deepEqual(triageRecipients({ id: "beatriz", active: true }, "recepcao"), ["beatriz"]);
  assert.deepEqual(triageRecipients({ id: "beatriz", active: true }, "beatriz"), []);
  assert.deepEqual(triageRecipients({ id: "beatriz", active: false }, "recepcao"), []);
  assert.deepEqual(triageRecipients(null, "recepcao"), []);
});

test("textos do sino citam paciente e motivo, cortando textos longos", () => {
  const t = emergencyNoticeText({ actorName: "Dra. Beatriz", patientName: "Ana Lúcia Reis", reason: "Paciente passando mal na recepção" });
  assert.equal(t.title, "Acesso de emergência ao prontuário");
  assert.match(t.body, /Dra\. Beatriz abriu o prontuário de Ana Lúcia Reis\. Motivo: Paciente passando mal/);
  const long = shortQuote("palavra ".repeat(80), 60);
  assert.ok(long.length <= 63 && long.endsWith("..."));
  const tri = urgentTriageNoticeText({ patientName: "Ana", time: "14:30", complaint: null, recordedByName: "Recepção" });
  assert.equal(tri.body, "Ana (consulta das 14:30): sem queixa registrada. Registrada por Recepção.");
});

test("e-mail de emergência não leva dado do paciente e escapa o HTML", () => {
  const e = emergencyEmail({ clinicName: "Clínica <Exemplo>", when: "22/10/2026 às 10:32", link: "https://app.tropi/prontuario/ajustes" });
  assert.match(e.text, /acesso de emergência a um prontuário/);
  assert.ok(!e.html.includes("<Exemplo>"));
  assert.ok(e.html.includes("&lt;Exemplo&gt;"));
  assert.ok(e.text.includes("o nome do paciente, quem acessou e o motivo não vão por e-mail"));
});
