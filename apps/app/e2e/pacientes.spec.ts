import { demo, exec, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";
import { resetClinicalData, todayAppointment } from "./support/scenario";

/**
 * PACIENTES, LEADS E FORMULÁRIOS POR ESPECIALIDADE
 *  - Pacientes (menu) lista só pacientes efetivos; leads ficam na aba Leads de Conversas;
 *  - "Cadastrar paciente" já entra como paciente; um lead com consulta marcada vira paciente;
 *  - os endereços antigos (Contatos, Prontuário, Modelos) redirecionam;
 *  - a gestão configura os formulários em Ajustes > Prontuário (biblioteca e formulário por profissional);
 *  - o atendimento abre o formulário da especialidade e pode trocar de formulário no rascunho;
 *  - a área do profissional esconde o que não é da profissão (psicologia: sem sinais vitais e sem receita).
 */
test.describe.configure({ mode: "serial" });

const PACIENTE = "Paciente Teste Cadastro";
const LEAD = "Lead Teste Conversa";

test("Pacientes x Leads, endereços antigos e celular sem rolagem lateral", async ({ as }) => {
  await exec("delete from contacts where name in ($1, $2)", [PACIENTE, LEAD]);
  const r = await as("recepcao");

  await test.step("Menu: Pacientes no lugar de Contatos; endereços antigos redirecionam", async () => {
    await r.goto("/hoje");
    // Menu lateral (computador): Pacientes aparece; Contatos e Prontuário não existem mais
    const menu = r.locator("aside nav");
    await expect(menu.locator("a[href='/pacientes']").first()).toBeVisible();
    await expect(menu.locator("a[href='/crm/contatos'], a[href='/prontuario']")).toHaveCount(0);
    await r.goto("/crm/contatos?q=Ana");
    await expect(r).toHaveURL(/\/pacientes\?q=Ana$/);
    await r.goto("/crm/contatos?tipo=lead");
    await expect(r).toHaveURL(/\/crm\/conversas\/leads$/);
  });

  await test.step("Cadastrar paciente pela página Pacientes: aparece em Pacientes e não em Leads", async () => {
    await r.goto("/pacientes");
    await r.getByRole("button", { name: "Cadastrar paciente" }).click();
    const dlg = r.locator("dialog[open]");
    await dlg.locator("#new-name").fill(PACIENTE);
    await dlg.getByRole("button", { name: "Cadastrar paciente" }).click();
    await r.waitForURL(/\/crm\/contatos\/[0-9a-f-]{36}$/);
    expect(await value("select stage from contacts where name = $1", [PACIENTE])).toBe("paciente");
    await r.goto(`/pacientes?q=${encodeURIComponent(PACIENTE)}`);
    await expect(r.getByText(PACIENTE).first()).toBeVisible();
    await r.goto(`/crm/conversas/leads?q=${encodeURIComponent(PACIENTE)}`);
    await expect(r.getByText("Ninguém encontrado")).toBeVisible();
  });

  await test.step("Lead fica em Conversas > Leads até marcar consulta", async () => {
    await r.goto("/crm/conversas");
    await r.getByRole("link", { name: "Leads" }).first().click();
    await r.waitForURL(/\/crm\/conversas\/leads$/);
    await r.getByRole("button", { name: "Novo lead" }).click();
    const dlg = r.locator("dialog[open]");
    await dlg.locator("#new-name").fill(LEAD);
    await dlg.getByRole("button", { name: "Cadastrar paciente" }).click();
    await r.waitForURL(/\/crm\/contatos\/[0-9a-f-]{36}$/);
    expect(await value("select stage from contacts where name = $1", [LEAD])).toBe("novo");
    await r.goto(`/pacientes?q=${encodeURIComponent(LEAD)}`);
    await expect(r.getByText("Ninguém encontrado")).toBeVisible();
    await r.goto(`/crm/conversas/leads?q=${encodeURIComponent(LEAD)}`);
    await expect(r.getByText(LEAD).first()).toBeVisible();

    // Consulta marcada: vira paciente sozinho (regra da lista, sem mudar nada à mão)
    const leadId = await value<string>("select id from contacts where name = $1", [LEAD]);
    const proId = (await demo.professionalId("Dr. Caio Prado"))!;
    await exec(
      `insert into appointments (clinic_id, contact_id, professional_id, unit_id, starts_at, ends_at, status)
       select c.clinic_id, c.id, $2, (select id from clinic_units where clinic_id = c.clinic_id and main), now() + interval '3 days', now() + interval '3 days 30 minutes', 'agendado'
         from contacts c where c.id = $1`,
      [leadId, proId],
    );
    await r.goto(`/pacientes?q=${encodeURIComponent(LEAD)}`);
    await expect(r.getByText(LEAD).first()).toBeVisible();
  });

  await test.step("Celular: Pacientes e Leads sem rolagem lateral", async () => {
    const cel = await as("recepcao", { width: 390, height: 844 });
    for (const path of ["/pacientes", "/crm/conversas/leads"]) {
      await cel.goto(path);
      await expect(cel.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expectNoHorizontalScroll(cel);
    }
  });

  await exec("delete from appointments where contact_id in (select id from contacts where name in ($1, $2))", [PACIENTE, LEAD]);
  await exec("delete from contacts where name in ($1, $2)", [PACIENTE, LEAD]);
});

test("formulários por especialidade: Ajustes > Prontuário, atendimento e regras da área", async ({ as }) => {
  await resetClinicalData();
  const { contactId } = await todayAppointment("Ana Lúcia Reis", "Dra. Beatriz Lemos");
  const beatrizPro = (await demo.professionalId("Dra. Beatriz Lemos"))!;

  await test.step("Profissional: sem abas de Modelos e Ajustes; endereço antigo leva aos Ajustes (sem permissão)", async () => {
    const pg = await as("beatriz");
    await pg.goto("/prontuario");
    await expect(pg).toHaveURL(/\/pacientes$/);
    await expect(pg.locator("nav[aria-label='Seções do prontuário']")).toHaveCount(0);
    await pg.goto("/configuracoes/prontuario/modelos");
    await expect(pg).toHaveURL(/\/sem-permissao/);
  });

  await test.step("Gestão: biblioteca e formulário escolhido para a profissional", async () => {
    const g = await as("gestor");
    await g.goto("/configuracoes/prontuario/modelos");
    await expect(g.getByRole("heading", { name: "Formulários de atendimento" })).toBeVisible();
    // Dermatologia instalada sozinha (especialidade da Beatriz); Psicologia vem da biblioteca
    await expect.poll(() => value<number>("select count(*)::int from pep_templates where specialty_key = 'dermatologia'")).toBe(2);
    await g.getByRole("button", { name: "Adicionar Psicologia clínica" }).click();
    await expect.poll(() => value<number>("select count(*)::int from pep_templates where specialty_key = 'psicologia_clinica'")).toBe(2);
    // Beatriz: primeira consulta com o formulário de clínica geral (escolha da gestão)
    const geral = await value<string>("select id from pep_templates where system_key = 'clinica_geral_primeira'");
    const row = g.getByTestId(`prof-form-${beatrizPro}`);
    await row.locator(`#pf-${beatrizPro}`).selectOption(geral);
    await row.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => value("select first_template_id from professionals where id = $1", [beatrizPro])).toBe(geral);
    const cel = await as("gestor", { width: 390, height: 844 });
    await cel.goto("/configuracoes/prontuario/modelos");
    await expectNoHorizontalScroll(cel);
  });

  await test.step("Atendimento usa o formulário escolhido; 'Trocar formulário' volta para a dermatologia", async () => {
    const pg = await as("beatriz");
    await pg.goto("/consultorio");
    await pg.locator("li", { has: pg.getByText("Ana Lúcia Reis") }).first().getByRole("button", { name: "Atender" }).click();
    await pg.waitForURL(/\/prontuario\/atendimentos\//);
    const encounterId = pg.url().split("/").pop()!;
    expect(await value("select system_key from pep_templates t join pep_encounters e on e.template_id = t.id where e.id = $1", [encounterId])).toBe("clinica_geral_primeira");
    await pg.locator("#f-queixa").fill("Mancha no braço");
    await expect.poll(() => value("select answers->>'queixa' from pep_encounters where id = $1", [encounterId]), { timeout: 20_000 }).toBe("Mancha no braço");

    await pg.getByRole("button", { name: "Trocar formulário" }).click();
    const derm = await value<string>("select id from pep_templates where system_key = 'dermatologia_primeira'");
    await pg.locator("dialog[open] select").selectOption(derm);
    await pg.locator("dialog[open]").getByRole("button", { name: "Trocar formulário" }).click();
    await expect(pg.locator("#f-exame_dermatologico")).toBeVisible();
    // A queixa existe nos dois formulários: continua preenchida
    await expect(pg.locator("#f-queixa")).toHaveValue("Mancha no braço");
    expect(await value("select system_key from pep_templates t join pep_encounters e on e.template_id = t.id where e.id = $1", [encounterId])).toBe("dermatologia_primeira");
    await exec("delete from pep_encounters where id = $1", [encounterId]);
  });

  await test.step("Área da psicologia: sem sinais vitais e sem receita", async () => {
    await exec("update professionals set specialty = 'Psicologia clínica', first_template_id = null where id = $1", [beatrizPro]);
    try {
      const pg = await as("beatriz");
      await pg.goto(`/prontuario/pacientes/${contactId}`);
      await pg.getByRole("button", { name: "Novo atendimento" }).click();
      await pg.waitForURL(/\/prontuario\/atendimentos\//);
      await expect(pg.locator("#f-demanda")).toBeVisible();
      await expect(pg.locator("section[aria-labelledby=sec-vitais]")).toHaveCount(0);
      await expect(pg.getByRole("heading", { name: "Hipótese diagnóstica (CID-10, opcional)" })).toBeVisible();
      await expect(pg.getByRole("button", { name: "Receita", exact: true })).toHaveCount(0);
      await expect(pg.getByRole("button", { name: "Atestado", exact: true })).toBeVisible();
    } finally {
      await exec("update professionals set specialty = 'Dermatologia' where id = $1", [beatrizPro]);
    }
  });

  await resetClinicalData();
});
