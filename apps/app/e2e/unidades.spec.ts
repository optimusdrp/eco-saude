import { asTenant, demo, exec, rows, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";
import { resetClinicalData } from "./support/scenario";

/**
 * UNIDADES DE ATENDIMENTO E CONSULTÓRIOS
 * Travas do banco (sem conflito de sala; sala da unidade certa), cadastro, semana do
 * profissional por período, agendamento herdando unidade/sala, agenda por unidade e
 * equipe restrita a unidades.
 */
test.describe.configure({ mode: "serial" });

const RECEPCAO = "recepcao@clinicaexemplo.com.br";

/** Consulta futura da Ana com a Dra. Helena (a que o teste agenda pela tela) */
const HELENA_ANA = `from appointments a join professionals p on p.id = a.professional_id
                   where p.name = 'Dra. Helena Duarte' and a.contact_id = (select id from contacts where name = 'Ana Lúcia Reis')
                     and a.starts_at > now() and a.status <> 'cancelado'`;

test("unidades e consultórios: banco, cadastro, semana, agendamento, agenda e acesso por unidade", async ({ as }) => {
  await resetClinicalData();
  const clinicId = (await demo.clinicId())!;
  const moinhos = (await value<string>("select id from clinic_units where clinic_id = $1 and main", [clinicId]))!;
  const centro = (await demo.unitId("Unidade Centro"))!;
  const sala2 = (await value<string>("select id from clinic_rooms where unit_id = $1 and name = 'Sala 2'", [centro]))!;
  // Estado limpo (o mesmo banco roda o teste várias vezes)
  await exec("update appointments set room_id = null where room_id in (select id from clinic_rooms where name = 'Sala 3')");
  await exec("delete from clinic_rooms where name = 'Sala 3'");
  await exec("delete from clinic_units where name = 'Unidade Zona Sul'");
  await exec(`delete from appointments where id in (select a.id ${HELENA_ANA})`);
  await exec("update professionals set weekly_schedule = jsonb_set(weekly_schedule, '{6}', weekly_schedule->'5') where name = 'Dr. Caio Prado'");

  await test.step("Banco recusa consultório ocupado e consultório de outra unidade (papel do app)", async () => {
    const [busy] = await rows<{ contact_id: string; starts_at: Date; ends_at: Date; room_id: string; unit_id: string }>(
      `select a.contact_id, a.starts_at, a.ends_at, a.room_id, a.unit_id from appointments a join professionals p on p.id = a.professional_id
        where p.name = 'Dr. Caio Prado' and a.status <> 'cancelado' and a.room_id is not null limit 1`,
    );
    expect(busy, "a demonstração deveria ter consulta do Dr. Caio com consultório").toBeTruthy();
    const helena = await demo.professionalId("Dra. Helena Duarte");
    const insert = "insert into appointments (contact_id, professional_id, unit_id, room_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6) returning id";
    const clash = await asTenant(clinicId, insert, [busy!.contact_id, helena, busy!.unit_id, busy!.room_id, busy!.starts_at, busy!.ends_at]);
    expect(clash.error?.constraint).toBe("appointments_room_no_overlap");
    const in40 = new Date(Date.now() + 40 * 86_400_000);
    const wrongUnit = await asTenant(clinicId, insert, [busy!.contact_id, helena, moinhos, sala2, in40, new Date(in40.getTime() + 30 * 60_000)]);
    expect(wrongUnit.error?.code).toBe("EC002");
  });

  await test.step("Ajustes > Unidades: novo consultório e nova unidade (CNES validado)", async () => {
    const g = await as("gestor");
    await g.goto("/configuracoes/unidades");
    await expect(g.getByText("Unidade Moinhos").first()).toBeVisible();
    await expect(g.getByText("CNES 1234567").first()).toBeVisible();
    const centroPanel = g.locator("section", { has: g.getByRole("heading", { name: /Unidade Centro/ }) }).first();
    await centroPanel.getByRole("button", { name: "Consultório" }).click();
    let dlg = g.locator("dialog[open]");
    await dlg.locator("input[name=name]").fill("Sala 3");
    await dlg.getByRole("button", { name: "Salvar consultório" }).click();
    await expect.poll(() => value("select count(*)::int from clinic_rooms where unit_id = $1 and name = 'Sala 3'", [centro])).toBe(1);

    await g.getByRole("button", { name: "Nova unidade" }).click();
    dlg = g.locator("dialog[open]");
    await dlg.locator("input[name=name]").fill("Unidade Zona Sul");
    await dlg.locator("input[name=cnes]").fill("12");
    await dlg.getByRole("button", { name: "Salvar unidade" }).click();
    await expect(dlg.getByText("CNES com 7 números")).toBeVisible();
    await dlg.locator("input[name=cnes]").fill("1112223");
    await dlg.getByRole("button", { name: "Salvar unidade" }).click();
    await expect.poll(() => value("select count(*)::int from clinic_units where name = 'Unidade Zona Sul'")).toBe(1);
    // Desativada para não mudar o resto da demonstração
    await exec("update clinic_units set active = false where name = 'Unidade Zona Sul'");
  });

  await test.step("Semana do profissional: unidade e consultório por período, com aviso de sala dividida", async () => {
    const g = await as("gestor");
    await g.goto("/configuracoes/clinica");
    await expect(g.getByText("Unidade Centro, Sala 2").first()).toBeVisible();
    await g.getByRole("button", { name: "Editar Dr. Caio Prado" }).click();
    const dlg = g.locator("dialog[open]");
    await dlg.getByLabel("Sábado, período 1: unidade").selectOption(centro);
    await dlg.getByLabel("Sábado, período 1: consultório").selectOption({ label: "Sala 1" });
    await dlg.getByRole("button", { name: "Salvar profissional" }).click();
    await expect(dlg.locator("[role=status], [role=alert]").filter({ hasText: "também é fixo de Dra. Beatriz Lemos" }).first()).toBeVisible();
    expect(await value("select weekly_schedule->'6'->'periods'->0->>'unitId' from professionals where name = 'Dr. Caio Prado'")).toBe(centro);
  });

  let day = "";
  await test.step("Agendar: horários mostram a unidade e a consulta herda unidade e consultório fixo", async () => {
    const g = await as("gestor");
    const contactId = await demo.contactId("Ana Lúcia Reis");
    await g.goto(`/crm/contatos/${contactId}`);
    await g.getByRole("button", { name: "Agendar" }).first().click();
    const dlg = g.locator("dialog[open]");
    await dlg.locator("select[name=professionalId]").selectOption({ label: "Dra. Helena Duarte, Pediatria" });
    await expect(dlg.getByText("Unidade Centro").first()).toBeVisible({ timeout: 20_000 });
    await dlg.locator("button[aria-pressed]").last().click(); // o dia mais distante: sem outra consulta da paciente
    await dlg.locator("button[type=submit]").last().click();
    await expect.poll(() => value(`select count(*)::int ${HELENA_ANA}`), { timeout: 20_000 }).toBe(1);
    expect(
      await value(`select u.name || '/' || r.name ${HELENA_ANA.replace("from appointments a", "from appointments a join clinic_units u on u.id = a.unit_id join clinic_rooms r on r.id = a.room_id")}`),
    ).toBe("Unidade Centro/Sala 2");
    day = (await value(`select to_char(a.starts_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') ${HELENA_ANA}`))!;
  });

  await test.step("Agenda filtrada pela unidade; troca de consultório na consulta", async () => {
    const g = await as("gestor");
    await g.goto(`/crm/agenda?data=${day}&unidade=${centro}`);
    await expect(g.getByText("Dra. Helena Duarte").first()).toBeVisible();
    await g.getByRole("button", { name: /Ana Lúcia Reis/ }).first().click();
    const dlg = g.locator("dialog[open]");
    await expect(dlg.getByText("Sala 2").first()).toBeVisible();
    await dlg.getByRole("button", { name: "Editar detalhes" }).click();
    await dlg.locator("select[name=roomId]").selectOption({ label: "Sala 3" });
    await dlg.getByRole("button", { name: "Salvar detalhes" }).click();
    await expect
      .poll(() => value(`select r.name ${HELENA_ANA.replace("from appointments a", "from appointments a join clinic_rooms r on r.id = a.room_id")}`))
      .toBe("Sala 3");
  });

  await test.step("Recepção restrita à Unidade Centro (nem forçando a URL vê o Moinhos)", async () => {
    const g = await as("gestor");
    await g.goto("/configuracoes/equipe");
    await g.locator("li", { has: g.getByText(RECEPCAO) }).first().getByRole("button", { name: "Acesso" }).click();
    const dlg = g.locator("dialog[open]");
    await dlg.locator("label", { has: g.getByText("Unidade Moinhos", { exact: true }) }).click();
    await dlg.getByRole("button", { name: "Salvar acesso" }).click();
    await expect.poll(() => value("select unit_ids::text from clinic_users where email = $1", [RECEPCAO])).toBe(`{${centro}}`);

    const r = await as("recepcao");
    await r.goto(`/crm/agenda?data=${day}`);
    const select = r.locator("label", { has: r.locator("span.sr-only", { hasText: "Unidade" }) }).locator("select");
    await expect(select).toHaveCount(1);
    await expect(select).toHaveValue(centro);
    await expect(select.locator("option")).toHaveCount(1);
    await r.goto(`/crm/agenda?data=${day}&unidade=${moinhos}`);
    await expect(r.getByText("Dr. Caio Prado")).toHaveCount(0);
  });

  await test.step("Consultório mostra as salas; Unidades sem rolagem lateral no celular", async () => {
    const pg = await as("beatriz");
    await pg.goto("/consultorio");
    await expect(pg.getByText("Consultórios agora")).toBeVisible();
    const cel = await as("gestor", { width: 390, height: 844 });
    await cel.goto("/configuracoes/unidades");
    await expectNoHorizontalScroll(cel);
  });

  await exec("update clinic_users set unit_ids = '{}'");
});
