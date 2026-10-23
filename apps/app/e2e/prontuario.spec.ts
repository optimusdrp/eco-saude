import { asTenant, demo, exec, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";
import { resetClinicalData, todayAppointment } from "./support/scenario";

/**
 * TROPI PRONTUÁRIO (fase 1): do Consultório ao documento conferido na farmácia.
 * Uma história só, em passos (test.step): cada passo depende do anterior.
 */
test.describe.configure({ mode: "serial" });

test("atendimento completo: resumo, registro, documentos, finalização, adendo e verificação", async ({ as }) => {
  await resetClinicalData();
  const { appointmentId, contactId } = await todayAppointment("Ana Lúcia Reis", "Dra. Beatriz Lemos");
  await exec("update contacts set cpf = '52998224725', sex = 'F', birth_date = '1968-04-12' where id = $1", [contactId]);
  const pg = await as("beatriz");
  let encounterId = "";
  let recipeCode = "";
  let recipeId = "";
  let certificateCode = "";

  await test.step("Consultório lista a consulta de hoje e abre o atendimento", async () => {
    await pg.goto("/consultorio");
    await expect(pg.locator("nav[aria-label='Navegação principal'] a[href='/prontuario']")).toHaveCount(1);
    const row = pg.locator("li", { has: pg.getByText("Ana Lúcia Reis") }).first();
    await row.getByRole("button", { name: "Atender" }).click();
    await pg.waitForURL(/\/prontuario\/atendimentos\//);
    encounterId = pg.url().split("/").pop()!;
    expect(await value("select status from appointments where id = $1", [appointmentId])).toBe("compareceu");
    expect(await value("select template_name from pep_encounters where id = $1", [encounterId])).toBe("Primeira consulta");
  });

  await test.step("Resumo clínico: alergia e medicamento em uso", async () => {
    await pg.getByRole("button", { name: "Editar resumo clínico" }).click();
    const dlg = pg.locator("dialog[open]");
    await dlg.getByRole("button", { name: "Alergia" }).click();
    await dlg.getByLabel("Alergia a").fill("Dipirona");
    await dlg.getByLabel("Reação").fill("urticária");
    await dlg.getByRole("button", { name: "Medicamento", exact: true }).click();
    await dlg.getByLabel("Medicamento", { exact: true }).fill("Losartana");
    await dlg.getByLabel("Dose e frequência").fill("50 mg 1x ao dia");
    await dlg.getByRole("button", { name: "Salvar resumo" }).click();
    await expect(pg.locator("dialog[open]")).toHaveCount(0);
    await expect(pg.locator("section[aria-label='Resumo do paciente']").getByText("Dipirona")).toBeVisible();
  });

  await test.step("Registro com sinais vitais, CID-10 e salvamento automático", async () => {
    await pg.locator("#f-queixa").fill("Dor de cabeça há 3 dias");
    await pg.locator("#f-hda").fill("Cefaleia occipital, pior pela manhã. Sem febre.");
    await pg.getByRole("button", { name: "Bom", exact: true }).click();
    const vit = pg.locator("section[aria-labelledby=sec-vitais]");
    const inputs = vit.locator("input");
    for (const [i, v] of [[0, "185"], [1, "100"], [2, "88"], [5, "97"], [6, "82"], [7, "165"]] as const) await inputs.nth(i).fill(v);
    await expect(vit.getByText("crise hipertensiva").first()).toBeVisible();
    await expect(vit.getByText(/obesidade grau I/).first()).toBeVisible();
    const cid = pg.getByRole("combobox");
    await cid.fill("hipertensao");
    await pg.getByRole("option", { name: /I10/ }).click();
    await cid.fill("R51");
    await expect(pg.getByRole("option", { name: /R51/ })).toBeVisible();
    await cid.press("Enter");
    await expect(pg.locator("section[aria-labelledby=sec-cid] li")).toHaveCount(2);
    await pg.locator("#conduct").fill("Iniciar anti-hipertensivo. Dieta hipossódica. MAPA.");
    await pg.getByRole("button", { name: "1 mês" }).click();
    await expect(pg.getByRole("status").filter({ hasText: "Salvo às" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => value("select answers->>'queixa' from pep_encounters where id = $1", [encounterId])).toBe("Dor de cabeça há 3 dias");
    await expect.poll(() => value<number>("select jsonb_array_length(diagnoses) from pep_encounters where id = $1", [encounterId])).toBe(2);
  });

  await test.step("Receita: alerta de alergia exige confirmação; PDF com código", async () => {
    await pg.getByRole("button", { name: "Receita", exact: true }).click();
    const dlg = pg.locator("dialog[open]");
    await dlg.locator("#med-0").fill("Dipirona 500 mg comprimido");
    await dlg.locator("#qty-0").fill("10 comprimidos");
    await dlg.locator("#ins-0").fill("1 comprimido de 6 em 6 horas se dor");
    await expect(dlg.getByText("Paciente com alergia registrada")).toBeVisible();
    await dlg.getByRole("button", { name: "Emitir documento" }).click();
    await expect(pg.locator("[role=status], [role=alert]").filter({ hasText: "Confirme" }).first()).toBeVisible();
    await dlg.getByLabel("Vi o alerta e mantenho a prescrição").check();
    await dlg.getByRole("button", { name: "Emitir documento" }).click();
    await expect(dlg.getByText("Documento emitido")).toBeVisible();
    recipeCode = (await dlg.locator(".font-mono").innerText()).trim();
    expect(recipeCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await dlg.getByRole("button", { name: "Fechar", exact: true }).first().click();
    recipeId = (await value<string>("select id from pep_documents where verification_code = $1", [recipeCode]))!;
    const pdf = await pg.request.get(`/api/prontuario/documentos/${recipeId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  await test.step("Atestado com CID só com autorização", async () => {
    await pg.getByRole("button", { name: "Atestado", exact: true }).click();
    const dlg = pg.locator("dialog[open]");
    await dlg.locator("#at-days").fill("2");
    await dlg.getByLabel("Incluir o CID no atestado").check();
    await dlg.getByRole("button", { name: "Emitir documento" }).click();
    await expect(dlg.getByText("Documento emitido")).toBeVisible();
    certificateCode = (await dlg.locator(".font-mono").innerText()).trim();
    await dlg.getByRole("button", { name: "Fechar", exact: true }).first().click();
    expect(await value("select content->>'cid' from pep_documents where verification_code = $1", [certificateCode])).toBe("I10");
  });

  await test.step("Finalizar trava o registro, cria a tarefa de retorno e alimenta os problemas", async () => {
    await pg.getByRole("button", { name: "Finalizar atendimento" }).click();
    await pg.locator("dialog[open]").getByRole("button", { name: "Finalizar e travar" }).click();
    await expect.poll(() => value("select status from pep_encounters where id = $1", [encounterId])).toBe("finalizado");
    await expect(pg.getByText("Registro íntegro e travado")).toBeVisible();
    expect(await value<boolean>("select hash is not null from pep_encounters where id = $1", [encounterId])).toBe(true);
    expect(await value<boolean>("select finished_at is not null from appointments where id = $1", [appointmentId])).toBe(true);
    expect(await value("select title from tasks where contact_id = $1 and kind = 'retorno' order by created_at desc limit 1", [contactId])).toContain("Agendar retorno");
    expect(await value("select problems::text from pep_patient_profiles where contact_id = $1", [contactId])).toContain("I10");
    // O banco recusa alterar o finalizado, mesmo sem passar pela tela (papel do app)
    const clinicId = (await demo.clinicId())!;
    const r = await asTenant(clinicId, "update pep_encounters set conduct = 'x' where id = $1 returning id", [encounterId]);
    expect(r.error !== null || r.rows.length === 0, "update de atendimento finalizado deveria ser recusado").toBe(true);
  });

  await test.step("Adendo e cancelamento de documento", async () => {
    await pg.locator("#ad-text").fill("Paciente ligou: PA domiciliar 150/95.");
    await pg.getByRole("button", { name: "Registrar adendo" }).click();
    await expect.poll(() => value<string>("select count(*) from pep_addenda where encounter_id = $1", [encounterId])).toBe("1");
    await expect(pg.locator("#ad-text")).toHaveValue("");
    await pg.getByRole("button", { name: "Cancelar Atestado" }).click();
    const dlg = pg.locator("dialog[open]");
    await dlg.locator("input[name=reason]").fill("Dias de afastamento errados");
    await dlg.getByRole("button", { name: "Cancelar documento" }).click();
    await expect.poll(() => value<boolean>("select revoked_at is not null from pep_documents where verification_code = $1", [certificateCode])).toBe(true);
  });

  await test.step("Prontuário do paciente: linha do tempo e abertura registrada; celular sem rolagem lateral", async () => {
    await pg.goto(`/prontuario/pacientes/${contactId}`);
    await expect(pg.locator("details").first()).toBeVisible();
    expect(Number(await value("select count(*) from pep_audit where contact_id = $1 and action = 'abrir'", [contactId]))).toBeGreaterThanOrEqual(1);
    const cel = await as("beatriz", { width: 390, height: 844 });
    await cel.goto(`/prontuario/atendimentos/${encounterId}`);
    await expectNoHorizontalScroll(cel);
  });

  await test.step("Verificação pública: autêntico, cancelado, adulterado e inexistente", async () => {
    const pub = await as("anonimo", { width: 390, height: 844 });
    await pub.goto("/documento");
    await pub.locator("#codigo").fill(recipeCode.replaceAll("-", "").toLowerCase());
    await pub.getByRole("button", { name: "Conferir" }).click();
    await pub.waitForURL(/\/documento\/.+/);
    await expect(pub.getByRole("heading", { name: "Documento autêntico" })).toBeVisible();
    await expect(pub.getByText("A. L. R.")).toBeVisible();
    await expect(pub.getByText("Ana Lúcia Reis")).toHaveCount(0);
    await pub.goto(`/documento/${certificateCode}`);
    await expect(pub.getByRole("heading", { name: "Documento cancelado" })).toBeVisible();
    await expect(pub.getByText("I10")).toHaveCount(0);
    await exec(`update pep_documents set content = jsonb_set(content, '{items,0,quantity}', '"90 comprimidos"') where id = $1`, [recipeId]);
    await pub.goto(`/documento/${recipeCode}`);
    await expect(pub.getByRole("heading", { name: "Documento com divergência" })).toBeVisible();
    await exec(`update pep_documents set content = jsonb_set(content, '{items,0,quantity}', '"10 comprimidos"') where id = $1`, [recipeId]);
    await pub.goto("/documento/AAAA-BBBB-CCCC");
    await expect(pub.getByRole("heading", { name: "Documento não encontrado" })).toBeVisible();
  });

  await test.step("Gestão: modelos, sigilo e cópia do prontuário sem ler o conteúdo", async () => {
    const g = await as("gestor");
    await g.goto("/prontuario");
    await expect(g).toHaveURL(/\/prontuario\/modelos/);
    await g.getByRole("button", { name: "Editar Primeira consulta" }).click();
    const dlg = g.locator("dialog[open]");
    await dlg.getByRole("button", { name: /^Campo$/ }).click();
    const n = await dlg.locator("ol > li").count();
    await dlg.locator(`#lb-${n - 1}`).fill("Dor (escala)");
    await dlg.locator(`#tp-${n - 1}`).selectOption("escala");
    await dlg.getByRole("button", { name: "Salvar modelo" }).click();
    await expect(g.locator("dialog[open]")).toHaveCount(0);
    expect(await value("select fields::text from pep_templates where system_key = 'clinica_geral_primeira'")).toContain("dor_escala");
    expect(await value("select template_fields::text from pep_encounters where id = $1", [encounterId])).not.toContain("dor_escala");

    await g.goto("/prontuario/ajustes");
    await g.locator("input[name=accessMode][value=proprios]").check();
    await g.locator("#ps-header").fill("Rua das Flores, 100, Centro. CNES 1234567");
    await g.getByRole("button", { name: "Salvar ajustes" }).click();
    await expect.poll(() => value("select access_mode from pep_settings")).toBe("proprios");

    await g.goto(`/prontuario/pacientes/${contactId}`);
    await expect(g.locator("details")).toHaveCount(0);
    await g.getByRole("button", { name: "Cópia do prontuário" }).click();
    await g.locator("#exp-reason").fill("Paciente, presencial");
    const download = g.waitForEvent("download");
    await g.getByRole("button", { name: "Registrar e baixar PDF" }).click();
    expect((await download).suggestedFilename()).toContain(".pdf");
  });

  await test.step("Sigilo 'só quem atendeu': outro paciente pede acesso de emergência", async () => {
    const other = await value<string>(
      `select c.id from contacts c where c.anonymized_at is null and not exists
         (select 1 from appointments a join professionals p on p.id = a.professional_id where a.contact_id = c.id and p.name = 'Dra. Beatriz Lemos') limit 1`,
    );
    await pg.goto(`/prontuario/pacientes/${other}`);
    await pg.locator("#em-reason").fill("Paciente passando mal na recepção, médico ausente");
    await pg.getByRole("button", { name: "Abrir com acesso de emergência" }).click();
    await expect(pg.getByText("Aberto com acesso de emergência")).toBeVisible();
    await pg.goto(`/prontuario/pacientes/${contactId}`);
    await expect(pg.getByText("Aberto com acesso de emergência")).toHaveCount(0);
  });

  await test.step("Recepção não vê prontuário nem baixa documento", async () => {
    const r = await as("recepcao");
    await r.goto("/hoje");
    await expect(r.locator("nav[aria-label='Navegação principal'] a[href='/prontuario']")).toHaveCount(0);
    const res = await r.request.get(`/api/prontuario/documentos/${recipeId}/pdf`);
    expect([401, 403]).toContain(res.status());
  });

  await exec("update pep_settings set access_mode = 'todos'");
});
