import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactSchema } from "./index";

/** Formulário "Pedir demonstração" do site: os 5 módulos, inclusive o Laboratório planejado */
const base = { name: "Ana Souza", email: "ana@lab.com.br", clinic: "Laboratório Vida", size: "4-10", interests: ["lab"], consent: true };

describe("contactSchema", () => {
  it("aceita interesse no Laboratório", () => {
    assert.equal(contactSchema.safeParse(base).success, true);
  });

  it("aceita os 5 módulos juntos", () => {
    assert.equal(contactSchema.safeParse({ ...base, interests: ["crm", "pep", "erp", "bi", "lab"] }).success, true);
  });

  it("recusa módulo que não existe e lista vazia", () => {
    assert.equal(contactSchema.safeParse({ ...base, interests: ["rh"] }).success, false);
    assert.equal(contactSchema.safeParse({ ...base, interests: [] }).success, false);
  });

  it("pede o nome da clínica ou do laboratório", () => {
    const r = contactSchema.safeParse({ ...base, clinic: "" });
    assert.equal(r.success, false);
    assert.match(JSON.stringify(r.error?.issues), /clínica ou do laboratório/);
  });
});
