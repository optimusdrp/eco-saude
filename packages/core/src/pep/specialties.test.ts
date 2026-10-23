/**
 * Testes do catálogo de especialidades e da escolha do formulário do atendimento.
 * Rodar: pnpm --filter @ecosaude/core test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREA_RULES, areaOf, BUILT_IN_TEMPLATES, CLINIC_AREAS, matchSpecialty, pickTemplate, SPECIALTIES, templateFieldsSchema, templatesToInstall, type TemplateOption } from "./index";

describe("biblioteca de formulários", () => {
  it("todo formulário pronto é válido, tem chave única e campo obrigatório", () => {
    const keys = new Set<string>();
    for (const t of BUILT_IN_TEMPLATES) {
      const r = templateFieldsSchema.safeParse(t.fields);
      assert.ok(r.success, `${t.key}: ${r.success ? "" : JSON.stringify(r.error.issues[0])}`);
      assert.ok(!keys.has(t.key), `chave repetida: ${t.key}`);
      keys.add(t.key);
      assert.ok(t.fields.some((f) => f.required), `${t.key}: sem campo obrigatório`);
    }
  });

  it("toda especialidade tem primeira consulta e retorno; toda área tem um formulário geral", () => {
    for (const s of SPECIALTIES) {
      assert.ok(s.templates.some((t) => t.kind === "primeira"), `${s.key} sem primeira consulta`);
      assert.ok(s.templates.some((t) => t.kind === "retorno"), `${s.key} sem retorno`);
    }
    for (const a of CLINIC_AREAS) assert.equal(SPECIALTIES.filter((s) => s.area === a && s.general).length, 1, `área ${a}`);
  });

  it("mantém as chaves antigas da clínica médica geral (clínicas que já têm a cópia)", () => {
    assert.ok(BUILT_IN_TEMPLATES.some((t) => t.key === "clinica_geral_primeira"));
    assert.ok(BUILT_IN_TEMPLATES.some((t) => t.key === "clinica_geral_retorno"));
  });
});

describe("matchSpecialty e areaOf", () => {
  it("reconhece nomes, apelidos e acentos", () => {
    assert.equal(matchSpecialty("Dermatologia")?.key, "dermatologia");
    assert.equal(matchSpecialty("dermato")?.key, "dermatologia");
    assert.equal(matchSpecialty("Clínica geral")?.key, "clinica_geral");
    assert.equal(matchSpecialty("Psicóloga")?.key, "psicologia_clinica");
    assert.equal(matchSpecialty("Cirurgiã-dentista")?.key, "odonto_geral");
    assert.equal(matchSpecialty("Fisioterapia pélvica")?.key, "fisio_pelvica");
    assert.equal(matchSpecialty("Nutricionista esportiva")?.key, "nutri_esportiva");
    assert.equal(matchSpecialty("Oftalmologia")?.key, "oftalmologia");
  });

  it("o nome mais específico ganha", () => {
    assert.equal(matchSpecialty("Dermatologia clínica e estética")?.key, "dermatologia");
    assert.equal(matchSpecialty("Psicologia clínica")?.key, "psicologia_clinica");
    assert.equal(matchSpecialty("Psicologia infantil")?.key, "psicologia_infantil");
  });

  it("não reconhece texto vazio ou desconhecido", () => {
    assert.equal(matchSpecialty(""), null);
    assert.equal(matchSpecialty(null), null);
    assert.equal(matchSpecialty("Medicina hiperbárica"), null);
  });

  it("área: especialidade, depois conselho, depois a única área da clínica, depois medicina", () => {
    assert.equal(areaOf({ specialty: "Ortodontia" }), "odontologia");
    assert.equal(areaOf({ specialty: "Medicina hiperbárica", council: "CRM" }), "medicina");
    assert.equal(areaOf({ specialty: "Terapia sistêmica", council: "crp" }), "psicologia");
    assert.equal(areaOf({ specialty: null, clinicAreas: ["nutricao"] }), "nutricao");
    assert.equal(areaOf({}), "medicina");
  });
});

describe("regras por área", () => {
  it("só medicina e odontologia emitem receita", () => {
    for (const a of CLINIC_AREAS) {
      const prescribes = AREA_RULES[a].documents.includes("receita");
      assert.equal(prescribes, a === "medicina" || a === "odontologia", a);
    }
  });
  it("psicologia não mostra sinais vitais", () => {
    assert.equal(AREA_RULES.psicologia.vitals, false);
    assert.equal(AREA_RULES.medicina.vitals, true);
  });
});

describe("templatesToInstall", () => {
  it("instala os da especialidade de cada profissional e o geral de cada área", () => {
    const keys = new Set(templatesToInstall({ areas: ["odontologia"], professionals: [{ specialty: "Dermatologia" }, { specialty: "Ortodontia" }] }).map((t) => t.specialtyKey));
    assert.deepEqual([...keys].sort(), ["clinica_geral", "dermatologia", "odonto_geral", "ortodontia"]);
  });
  it("sem nada configurado, instala a clínica médica geral", () => {
    const keys = new Set(templatesToInstall({ areas: [], professionals: [] }).map((t) => t.specialtyKey));
    assert.deepEqual([...keys], ["clinica_geral"]);
  });
});

describe("pickTemplate", () => {
  const tpl = (id: string, specialtyKey: string | null, kind: TemplateOption["kind"], extra: Partial<TemplateOption> = {}): TemplateOption => ({ id, specialtyKey, specialty: specialtyKey ?? "Personalizado", kind, active: true, ...extra });
  const templates = [
    tpl("cg1", "clinica_geral", "primeira"),
    tpl("cg2", "clinica_geral", "retorno"),
    tpl("de1", "dermatologia", "primeira"),
    tpl("de2", "dermatologia", "retorno"),
    tpl("ps1", "psicologia_clinica", "primeira"),
    tpl("ps2", "psicologia_clinica", "retorno"),
    tpl("meu", null, null, { specialty: "Dermatologia" }),
    tpl("off", "dermatologia", "primeira", { active: false }),
  ];

  it("dermatologista: primeira consulta e retorno da dermatologia", () => {
    assert.equal(pickTemplate({ templates, professional: { specialty: "Dermatologia" }, isReturn: false })?.id, "de1");
    assert.equal(pickTemplate({ templates, professional: { specialty: "Dermatologia" }, isReturn: true })?.id, "de2");
  });

  it("o escolhido na hora e o definido pela gestão vêm antes", () => {
    assert.equal(pickTemplate({ templates, chosenId: "cg2", professional: { specialty: "Dermatologia" }, isReturn: false })?.id, "cg2");
    assert.equal(pickTemplate({ templates, professional: { specialty: "Dermatologia", firstTemplateId: "meu" }, isReturn: false })?.id, "meu");
    assert.equal(pickTemplate({ templates, professional: { specialty: "Dermatologia", returnTemplateId: "cg2" }, isReturn: true })?.id, "cg2");
  });

  it("modelo desativado não é usado, nem se escolhido", () => {
    assert.equal(pickTemplate({ templates, chosenId: "off", professional: { specialty: "Dermatologia" }, isReturn: false })?.id, "de1");
  });

  it("especialidade sem formulário: usa o geral da área (psicólogo de especialidade desconhecida)", () => {
    assert.equal(pickTemplate({ templates, professional: { specialty: "Terapia sistêmica", council: "CRP" }, isReturn: true })?.id, "ps2");
  });

  it("sem especialidade: clínica médica geral", () => {
    assert.equal(pickTemplate({ templates, professional: {}, isReturn: false })?.id, "cg1");
  });
});
