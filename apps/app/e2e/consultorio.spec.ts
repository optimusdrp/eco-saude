import { exec, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";
import { resetClinicalData, todayAppointment } from "./support/scenario";

/**
 * CONSULTÓRIO E ACESSOS PARCIAIS (LGPD)
 *  - o profissional de saúde começa o dia no Consultório;
 *  - a gestão sem registro em conselho vê o dia, mas não o conteúdo clínico;
 *  - a gestão libera partes (triagem, resumo de segurança, documentos) para a recepção;
 *  - quem tem registro em conselho (inclusive a gestora) lê o prontuário.
 */
test.describe.configure({ mode: "serial" });

const RECEPCAO = "recepcao@clinicaexemplo.com.br";
const GESTOR = "gestor@clinicaexemplo.com.br";

test("consultório, triagem pela recepção e perfil de profissional de saúde da gestora", async ({ as }) => {
  await resetClinicalData();
  const { appointmentId, contactId } = await todayAppointment("Ana Lúcia Reis", "Dra. Beatriz Lemos");
  await exec(
    `insert into pep_patient_profiles (clinic_id, contact_id, allergies)
     select clinic_id, id, '[{"name":"Dipirona"}]' from contacts where id = $1`,
    [contactId],
  );

  await test.step("Profissional começa no Consultório, com alerta de alergia na lista", async () => {
    const pg = await as("beatriz");
    await pg.goto("/");
    await expect(pg).toHaveURL(/\/consultorio$/);
    await expect(pg.locator("aside nav a").first()).toHaveAttribute("href", "/consultorio");
    const row = pg.locator("li", { has: pg.getByText("Ana Lúcia Reis") }).first();
    await expect(row.getByText("Alergia")).not.toHaveCount(0);
    await expect(pg.getByText("Aguardando chegada").first()).toBeVisible();
  });

  await test.step("Gestão sem registro em conselho: vê o dia, sem atender e sem dado de saúde", async () => {
    const g = await as("gestor");
    await g.goto("/");
    await expect(g).toHaveURL(/\/hoje$/);
    await g.goto("/consultorio");
    const row = g.locator("li", { has: g.getByText("Ana Lúcia Reis") }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Atender" })).toHaveCount(0);
    await expect(row.getByText("Alergia")).toHaveCount(0);
    await expect(row.locator("a[href^='/prontuario/pacientes']")).toHaveCount(0);
  });

  await test.step("Gestão libera partes do prontuário para a recepção; 'completo' fica travado", async () => {
    const g = await as("gestor");
    await g.goto("/configuracoes/equipe");
    await g.locator("li", { has: g.getByText(RECEPCAO) }).first().getByRole("button", { name: "Acesso" }).click();
    const dlg = g.locator("dialog[open]");
    for (const label of ["Consultório (pacientes do dia)", "Resumo de segurança", "Triagem e sinais vitais", "Documentos emitidos"]) {
      await dlg.locator("label", { has: g.getByText(label, { exact: true }) }).first().click();
    }
    const full = dlg.locator("label", { has: g.getByText("Atendimento completo (ler prontuários)", { exact: true }) }).first();
    await expect(full.locator("input")).toBeDisabled();
    await dlg.getByRole("button", { name: "Salvar acesso" }).click();
    const grants = () => value("select permission_grants::text from clinic_users where email = $1", [RECEPCAO]);
    await expect.poll(grants).toContain("prontuario.triagem");
    expect(await grants()).not.toContain("prontuario.ver");
  });

  await test.step("Recepção faz a triagem (marca a chegada) e vê a ficha parcial", async () => {
    const r = await as("recepcao");
    await r.goto("/consultorio");
    await r.locator("li", { has: r.getByText("Ana Lúcia Reis") }).first().getByRole("button", { name: "Fazer triagem" }).click();
    const dlg = r.locator("dialog[open]");
    await dlg.locator("input[name=complaint]").fill("Dor de cabeça forte desde ontem");
    await dlg.locator("input[name=v_pas]").fill("190");
    await dlg.locator("input[name=v_pad]").fill("115");
    await dlg.locator("input[name=v_spo2]").fill("97");
    await expect(dlg.getByText("considere prioridade urgente")).toBeVisible();
    await dlg.locator("label", { has: r.getByText("Urgente", { exact: true }) }).click();
    await dlg.getByRole("button", { name: "Salvar triagem" }).click();
    await expect.poll(() => value("select priority from pep_triages where appointment_id = $1", [appointmentId])).toBe("urgente");
    expect(await value("select status from appointments where id = $1", [appointmentId])).toBe("compareceu");
    expect(await value("select count(*)::int from pep_audit where action = 'triagem'")).toBe(1);

    await r.goto(`/prontuario/pacientes/${contactId}`);
    await expect(r.getByText("Dipirona").first()).toBeVisible();
    await expect(r.getByText("Seu acesso mostra só parte da ficha")).toBeVisible();
    await expect(r.locator("details")).toHaveCount(0);
    expect(
      await value("select reason from pep_audit where action = 'abrir' and contact_id = $1 order by at desc limit 1", [contactId]),
    ).toContain("acesso parcial");
  });

  await test.step("Profissional vê o próximo paciente (urgente) e inicia com os sinais da triagem", async () => {
    const pg = await as("beatriz");
    await pg.goto("/consultorio");
    const card = pg.locator("section[aria-label='Próximo paciente']");
    await expect(card.getByText("Ana Lúcia Reis")).toBeVisible();
    await expect(card.getByText("urgente").first()).toBeVisible();
    await expect(card.getByText("Dor de cabeça forte")).toBeVisible();
    await card.getByRole("button", { name: "Iniciar atendimento" }).click();
    await pg.waitForURL(/\/prontuario\/atendimentos\//);
    const encounterId = pg.url().split("/").pop()!;
    expect(await value("select vitals->>'pas' from pep_encounters where id = $1", [encounterId])).toBe("190");
    await expect(pg.locator("section[aria-label='Triagem']")).toBeVisible();
    await pg.goto("/consultorio");
    await expect(pg.getByText("Em atendimento").first()).toBeVisible();

    const cel = await as("beatriz", { width: 390, height: 844 });
    await cel.goto("/consultorio");
    await expectNoHorizontalScroll(cel);
  });

  await test.step("Gestora com CRM: atendimento completo liberado, começa no Consultório e lê o prontuário", async () => {
    const g = await as("gestor");
    await g.goto("/configuracoes/equipe");
    await g.locator("li", { has: g.getByText(GESTOR) }).first().getByRole("button", { name: "Acesso" }).click();
    const dlg = g.locator("dialog[open]");
    await dlg.locator("select[name=healthCouncil]").selectOption("CRM");
    await dlg.locator("input[name=healthCouncilNumber]").fill("99887");
    await dlg.locator("input[name=healthCouncilUf]").fill("RS");
    const full = dlg.locator("label", { has: g.getByText("Atendimento completo (ler prontuários)", { exact: true }) }).first().locator("input");
    await expect(full).toBeEnabled();
    await expect(full).toBeChecked();
    await dlg.getByRole("button", { name: "Salvar acesso" }).click();
    await expect.poll(() => value("select health_council from clinic_users where email = $1", [GESTOR])).toBe("CRM");

    await g.goto("/");
    await expect(g).toHaveURL(/\/consultorio$/);
    // Profissional de saúde sem profissional da agenda ligado: o Consultório explica por que não há "Atender"
    await expect(g.getByTestId("aviso-vinculo")).toBeVisible();
    await g.goto(`/prontuario/pacientes/${contactId}`);
    await expect(g.locator("details").first()).toBeVisible();
    await g.goto("/configuracoes/prontuario");
    await expect(g.getByText("Quem vê o quê no prontuário")).toBeVisible();
  });

  await resetClinicalData();
});
