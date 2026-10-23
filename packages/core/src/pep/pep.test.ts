import assert from "node:assert/strict";
import { test } from "node:test";
import { ageYears, BUILT_IN_TEMPLATES, bmi, documentContentSchema, normalizeCidCode, parseVitals, recordAccess, templateFieldsSchema, validateAnswers, vitalAlerts } from "./index";
import { canonicalJson, contentHash, normalizeVerificationCode, verificationCode } from "./server";

test("modelos prontos são válidos", () => {
  for (const t of BUILT_IN_TEMPLATES) assert.ok(templateFieldsSchema.safeParse(t.fields).success, t.key);
});

test("modelo rejeita id repetido e escolha sem opções", () => {
  const r = templateFieldsSchema.safeParse([
    { id: "a", label: "A", type: "texto" },
    { id: "a", label: "B", type: "escolha" },
  ]);
  assert.equal(r.success, false);
  assert.equal(r.error!.issues.length, 2);
});

test("respostas: obrigatórios só na finalização, tipos convertidos", () => {
  const fields = BUILT_IN_TEMPLATES[0]!.fields;
  const draft = validateAnswers(fields, { queixa: "", estado_geral: "Bom", habitos: ["Álcool", "x"] }, { final: false });
  assert.deepEqual(draft.errors, {});
  assert.deepEqual(draft.answers, { estado_geral: "Bom", habitos: ["Álcool"] });
  const fin = validateAnswers(fields, { queixa: "Dor" }, { final: true });
  assert.ok(fin.errors.hda);
  assert.equal(validateAnswers([{ id: "n", label: "N", type: "numero" }], { n: "3,5" }, { final: true }).answers.n, 3.5);
});

test("sinais vitais: faixa possível, PA invertida, IMC e alertas", () => {
  const { vitals, errors } = parseVitals({ pas: "185", pad: "100", spo2: "93", peso: "90", altura: "170", temp: "45,5" });
  assert.ok(errors.temp);
  assert.equal(parseVitals({ pas: 80, pad: 90 }).errors.pad !== undefined, true);
  assert.deepEqual(bmi(vitals), { value: 31.1, label: "Obesidade grau I" });
  const alerts = vitalAlerts(vitals, 50);
  assert.equal(alerts.find((a) => a.id === "pas")?.level, "urgente");
  assert.equal(alerts.find((a) => a.id === "spo2")?.level, "atencao");
  assert.ok(alerts.find((a) => a.id === "imc"));
  assert.deepEqual(vitalAlerts(vitals, 10), []);
});

test("CID e idade", () => {
  assert.equal(normalizeCidCode("j069"), "J06.9");
  assert.equal(normalizeCidCode("i10"), "I10");
  assert.equal(ageYears("2000-06-15", new Date("2026-06-14T12:00:00Z")), 25);
  assert.equal(ageYears("2000-06-15", new Date("2026-06-15T12:00:00Z")), 26);
  assert.equal(ageYears(null), null);
});

test("documentos", () => {
  assert.equal(documentContentSchema.safeParse({ kind: "receita", items: [] }).success, false);
  const r = documentContentSchema.parse({ kind: "receita", items: [{ medication: "Dipirona 500 mg", instructions: "1 cp de 6/6h se dor" }] });
  assert.equal(r.kind === "receita" && r.items[0]!.route, "oral");
  assert.equal(documentContentSchema.safeParse({ kind: "receita_especial", items: Array(4).fill({ medication: "Xx", instructions: "yy" }) }).success, false);
  const at = documentContentSchema.parse({ kind: "atestado", days: "3", startDate: "2026-10-21" });
  assert.equal(at.kind === "atestado" && at.includeCid, false);
});

test("sigilo", () => {
  assert.equal(recordAccess({ mode: "todos", canRead: true, canEmergency: false, attended: false }), "liberado");
  assert.equal(recordAccess({ mode: "proprios", canRead: true, canEmergency: true, attended: false }), "emergencia");
  assert.equal(recordAccess({ mode: "proprios", canRead: true, canEmergency: false, attended: false }), "negado");
  assert.equal(recordAccess({ mode: "proprios", canRead: true, canEmergency: false, attended: true }), "liberado");
  assert.equal(recordAccess({ mode: "todos", canRead: false, canEmergency: true, attended: true }), "negado");
});

test("hash canônico e código de verificação", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: undefined }] }), '{"a":[2,{"d":null}],"b":1}');
  assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
  const code = verificationCode(contentHash({ a: 1 }), "s1");
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(code, verificationCode(contentHash({ a: 1 }), "s2"));
  assert.equal(normalizeVerificationCode(code.toLowerCase().replace(/-/g, " ")), code);
  assert.equal(normalizeVerificationCode("abc"), "");
});

import { effectivePermissions } from "../crm/permissions";

test("profissional de saúde: conteúdo clínico só com registro em conselho", () => {
  // Gestão sem perfil de saúde: nem liberando individualmente lê prontuário
  const gestor = effectivePermissions({ rolePermissions: null, baseRole: "gestor", grants: ["prontuario.ver"] });
  assert.ok(!gestor.includes("prontuario.ver"));
  assert.ok(gestor.includes("prontuario.consultorio") && gestor.includes("prontuario.modelos"));
  assert.ok(!gestor.includes("prontuario.resumo"));
  // A mesma gestora com CRM no cadastro: recebe o pacote clínico
  const gestoraMedica = effectivePermissions({ rolePermissions: null, baseRole: "gestor", healthProfessional: true });
  assert.ok(gestoraMedica.includes("prontuario.ver") && gestoraMedica.includes("prontuario.atender"));
  // ... e a gestão pode bloquear individualmente
  assert.ok(!effectivePermissions({ rolePermissions: null, baseRole: "gestor", healthProfessional: true, revokes: ["prontuario.ver"] }).includes("prontuario.ver"));
  // Recepção com liberação parcial (resumo e documentos), sem conteúdo clínico
  const rec = effectivePermissions({ rolePermissions: null, baseRole: "recepcao", grants: ["prontuario.resumo", "prontuario.documentos", "prontuario.ver"] });
  assert.ok(rec.includes("prontuario.resumo") && rec.includes("prontuario.documentos") && !rec.includes("prontuario.ver"));
  // Perfil "profissional" sem registro em conselho: sem leitura clínica
  assert.ok(!effectivePermissions({ rolePermissions: null, baseRole: "profissional" }).includes("prontuario.ver"));
});
