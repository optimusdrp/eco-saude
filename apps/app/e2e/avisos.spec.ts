import { demo, exec, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";
import { resetClinicalData, todayAppointment } from "./support/scenario";

/**
 * AVISOS ATIVOS (sino)
 *  - acesso de emergência ao prontuário avisa NA HORA a gestão do prontuário;
 *  - triagem urgente avisa o profissional da consulta e destaca o paciente no Consultório.
 */
test.describe.configure({ mode: "serial" });

const RECEPCAO = "recepcao@clinicaexemplo.com.br";
const GESTOR = "gestor@clinicaexemplo.com.br";
const BEATRIZ = "beatriz@clinicaexemplo.com.br";
const userId = (email: string) => value<string>("select id from clinic_users where email = $1", [email]);

test("acesso de emergência avisa a gestão do prontuário no sino, com prova de leitura", async ({ as }) => {
  await resetClinicalData();
  const clinicId = await demo.clinicId();
  // Sigilo "só quem atendeu": paciente de outro profissional pede acesso de emergência
  await exec("insert into pep_settings (clinic_id, access_mode) values ($1, 'proprios')", [clinicId]);
  const other = await value<string>(
    `select c.id from contacts c where c.anonymized_at is null and not exists
       (select 1 from appointments a join professionals p on p.id = a.professional_id where a.contact_id = c.id and p.name = 'Dra. Beatriz Lemos') limit 1`,
  );
  const patient = await value<string>("select name from contacts where id = $1", [other]);
  const gestorName = await value<string>("select name from clinic_users where email = $1", [GESTOR]);

  await test.step("Profissional abre por emergência com o motivo", async () => {
    const b = await as("beatriz");
    await b.goto(`/prontuario/pacientes/${other}`);
    await b.locator("#em-reason").fill("Paciente passando mal na recepção, médico ausente");
    await b.getByRole("button", { name: "Abrir com acesso de emergência" }).click();
    await expect(b.getByText("Aberto com acesso de emergência")).toBeVisible();
    // Quem acessou não recebe aviso do próprio acesso
    expect(await value("select count(*)::int from user_notices where user_id = $1", [await userId(BEATRIZ)])).toBe(0);
    expect(await value("select count(*)::int from user_notices where user_id = $1 and kind = 'pep_emergencia' and urgent", [await userId(GESTOR)])).toBe(1);
  });

  await test.step("Gestão vê no sino quem, qual paciente e o motivo; abrir marca como lido", async () => {
    const g = await as("gestor");
    await g.goto("/hoje");
    await expect(g.getByTestId("notice-count")).toHaveText("1");
    await g.getByRole("button", { name: /^Avisos/ }).click();
    const panel = g.getByRole("dialog", { name: "Avisos" });
    await expect(panel.getByText("Acesso de emergência ao prontuário")).toBeVisible();
    await expect(panel.getByText(new RegExp(`abriu o prontuário de ${patient}`))).toBeVisible();
    await expect(panel.getByText(/Paciente passando mal na recepção/)).toBeVisible();
    await panel.getByRole("button", { name: /Acesso de emergência ao prontuário/ }).click();
    await expect(g).toHaveURL(/\/configuracoes\/prontuario$/);
    const gestorId = await userId(GESTOR);
    await expect.poll(() => value<boolean>("select read_at is not null from user_notices where user_id = $1", [gestorId])).toBe(true);
    await expect(g.getByTestId("notice-count")).toHaveCount(0);
    // Registro de acessos: prova de que a gestão foi avisada e leu
    await g.reload();
    await expect(g.getByTestId("notice-receipts").first()).toContainText(`${gestorName} (leu`);
  });

  await test.step("Ajuste de e-mail opcional e sino no celular sem rolagem lateral", async () => {
    const g = await as("gestor", { width: 390, height: 844 });
    await g.goto("/configuracoes/prontuario");
    await g.locator("#ps-email").check();
    await g.getByRole("button", { name: "Salvar ajustes" }).click();
    await expect.poll(() => value<boolean>("select emergency_email from pep_settings")).toBe(true);
    await g.getByRole("button", { name: /^Avisos/ }).click();
    await expect(g.getByRole("dialog", { name: "Avisos" })).toBeVisible();
    await expectNoHorizontalScroll(g);
  });

  await exec("update pep_settings set access_mode = 'todos', emergency_email = false");
});

test("triagem urgente avisa o profissional da consulta e destaca o paciente no Consultório", async ({ as }) => {
  await resetClinicalData();
  const { appointmentId } = await todayAppointment("Ana Lúcia Reis", "Dra. Beatriz Lemos");
  await exec("update clinic_users set permission_grants = '{prontuario.consultorio,prontuario.triagem}' where email = $1", [RECEPCAO]);
  const beatriz = (await userId(BEATRIZ))!;

  // A profissional está com o Consultório aberto antes da triagem
  const b = await as("beatriz");
  await b.goto("/consultorio");
  await expect(b.getByRole("alert", { name: "Triagem urgente" })).toHaveCount(0);

  await test.step("Recepção registra triagem urgente", async () => {
    const r = await as("recepcao");
    await r.goto("/consultorio");
    await r.locator("li", { has: r.getByRole("button", { name: "Fazer triagem" }) }).filter({ hasText: "Ana Lúcia Reis" }).first().getByRole("button", { name: "Fazer triagem" }).click();
    const dlg = r.locator("dialog[open]");
    await dlg.locator("input[name=complaint]").fill("Dor no peito há 1 hora");
    await dlg.locator("input[name=v_pas]").fill("190");
    await dlg.locator("label", { has: r.getByText("Urgente", { exact: true }) }).click();
    await dlg.getByRole("button", { name: "Salvar triagem" }).click();
    await expect.poll(() => value("select priority from pep_triages where appointment_id = $1", [appointmentId])).toBe("urgente");
    expect(await value("select count(*)::int from user_notices where user_id = $1 and kind = 'triagem_urgente'", [beatriz])).toBe(1);
  });

  await test.step("O sino da profissional acende sozinho (sem recarregar) com a queixa", async () => {
    await expect(b.getByTestId("notice-count")).toHaveText("1", { timeout: 35_000 });
    await b.getByRole("button", { name: /^Avisos/ }).click();
    await expect(b.getByRole("dialog", { name: "Avisos" }).getByText(/Ana Lúcia Reis \(consulta das 22:00\): Dor no peito há 1 hora/)).toBeVisible();
    await b.keyboard.press("Escape");
  });

  await test.step("Consultório: faixa de triagem urgente, linha destacada e som opcional", async () => {
    await b.reload();
    const banner = b.getByRole("alert", { name: "Triagem urgente" });
    await expect(banner).toContainText("Ana Lúcia Reis");
    await b.getByRole("button", { name: "Ligar som para triagem urgente" }).click();
    await expect(b.getByRole("button", { name: "Som de triagem urgente ligado neste aparelho" })).toHaveAttribute("aria-pressed", "true");
    await b.reload();
    await expect(b.getByRole("button", { name: "Som de triagem urgente ligado neste aparelho" })).toBeVisible();
    const cel = await as("beatriz", { width: 390, height: 844 });
    await cel.goto("/consultorio");
    await expect(cel.getByRole("alert", { name: "Triagem urgente" })).toBeVisible();
    await expectNoHorizontalScroll(cel);
  });

  await test.step("Corrigir a triagem que já era urgente não repete o aviso", async () => {
    const r = await as("recepcao");
    await r.goto("/consultorio");
    // Depois da primeira triagem, o botão da linha vira "Triagem" (corrigir)
    await r.locator("li", { has: r.getByRole("button", { name: "Triagem", exact: true }) }).filter({ hasText: "Ana Lúcia Reis" }).first().getByRole("button", { name: "Triagem", exact: true }).click();
    const dlg = r.locator("dialog[open]");
    await dlg.locator("input[name=complaint]").fill("Dor no peito há 1 hora, irradia para o braço");
    await dlg.getByRole("button", { name: "Salvar triagem" }).click();
    await expect.poll(() => value("select complaint from pep_triages where appointment_id = $1", [appointmentId])).toContain("irradia");
    expect(await value("select count(*)::int from user_notices where user_id = $1 and kind = 'triagem_urgente'", [beatriz])).toBe(1);
  });

  await resetClinicalData();
});
