import { demo, exec, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";

/**
 * HORÁRIO DE FUNCIONAMENTO, FERIADOS E FECHAMENTOS POR UNIDADE
 *  - feriados nacionais trazidos por um botão (sem duplicar);
 *  - horário próprio da unidade ou herdado da principal;
 *  - fechamento de uma unidade tira os horários livres dela no dia e aparece na Agenda;
 *  - resposta automática "fora do horário" avisa que hoje está fechado;
 *  - semana do profissional fora do funcionamento: só aviso.
 */
test.describe.configure({ mode: "serial" });

test("funcionamento por unidade, feriados, fechamentos e resposta automática", async ({ as }) => {
  const clinicId = (await demo.clinicId())!;
  const centro = (await demo.unitId("Unidade Centro"))!;
  const helena = (await demo.professionalId("Dra. Helena Duarte"))!;
  const caio = (await demo.professionalId("Dr. Caio Prado"))!;
  const year = Number((await value<string>("select to_char(now() at time zone 'America/Sao_Paulo', 'YYYY')"))!);
  // Dia do fechamento: daqui a 3 dias, numa segunda a sexta (Helena atende no Centro de seg a sex)
  const day = (await value<string>(
    `select to_char(d, 'YYYY-MM-DD') from generate_series((now() at time zone 'America/Sao_Paulo')::date + 3, (now() at time zone 'America/Sao_Paulo')::date + 10, interval '1 day') d
      where extract(dow from d) between 1 and 5 limit 1`,
  ))!;
  const ddmm = `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  // Estado limpo (o mesmo banco roda os testes muitas vezes)
  await exec("delete from clinic_closures where clinic_id = $1", [clinicId]);
  await exec("update clinic_units set opening_hours = null where id = $1", [centro]);

  try {
    await test.step("Feriados nacionais do ano: trazidos de uma vez, sem duplicar", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/unidades");
      for (let i = 0; i < 2; i++) {
        await g.getByRole("button", { name: "Trazer feriados nacionais" }).click();
        const dlg = g.locator("dialog[open]");
        await dlg.locator("#hol-year").selectOption(String(year));
        await dlg.getByRole("button", { name: "Trazer feriados" }).click();
        await expect(dlg.getByText(i === 0 ? /feriado\(s\) de \d{4} cadastrado/ : /já estavam cadastrados/)).toBeVisible();
        await dlg.getByRole("button", { name: "Fechar", exact: true }).first().click();
      }
      expect(await value("select count(*)::int from clinic_closures where clinic_id = $1 and national and starts_on between $2::date and $3::date", [clinicId, `${year}-01-01`, `${year}-12-31`])).toBe(10);
    });

    await test.step("Horário: o Centro herda da principal; com horário próprio, deixa de herdar", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/unidades");
      await expect(g.getByTestId(`horario-${centro}`)).toContainText("(mesmo da unidade principal)");
      await g.getByRole("button", { name: "Horário de funcionamento de Unidade Centro" }).click();
      const dlg = g.locator("dialog[open]");
      await dlg.getByLabel("Mesmo horário da unidade principal").uncheck();
      await dlg.getByLabel("Sábado: abre").uncheck();
      await dlg.getByLabel("Segunda, período 1: abre às").fill("09:00");
      await dlg.getByRole("button", { name: "Salvar horário" }).click();
      await expect(g.locator("dialog[open]")).toHaveCount(0);
      await expect.poll(() => value("select opening_hours->'1'->'periods'->0->>'start' from clinic_units where id = $1", [centro])).toBe("09:00");
      expect(await value("select opening_hours ? '6' from clinic_units where id = $1", [centro])).toBe(false);
      await expect(g.getByTestId(`horario-${centro}`)).not.toContainText("mesmo da unidade principal");
      await expect(g.getByTestId(`horario-${centro}`)).toContainText("seg, 9h às 18h");
    });

    await test.step("Fechamento só do Centro: tira os horários da Helena no dia, Caio (Moinhos) segue livre", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/unidades");
      await g.getByRole("button", { name: "Novo fechamento" }).click();
      const dlg = g.locator("dialog[open]");
      await dlg.locator("#cl-start").fill(day);
      await dlg.locator("#cl-reason").fill("Dedetização");
      await dlg.locator("#cl-kind").selectOption("outro");
      await dlg.locator("#cl-unit").selectOption(centro);
      await dlg.getByRole("button", { name: "Salvar fechamento" }).click();
      await expect.poll(() => value("select count(*)::int from clinic_closures where unit_id = $1 and starts_on = $2", [centro, day])).toBe(1);
      await expect(g.getByRole("list", { name: "Próximos fechamentos" })).toContainText("Dedetização");

      const slots = async (pro: string) => {
        const res = await g.request.get(`/api/agenda/horarios?prof=${pro}&desde=${day}&dias=1&limite=40`);
        return ((await res.json()) as { slots: { date: string }[] }).slots.filter((s) => s.date === day).length;
      };
      expect(await slots(helena)).toBe(0);
      expect(await slots(caio)).toBeGreaterThan(0);

      // Agenda do dia no Centro: a Helena aparece como fechada
      await g.goto(`/crm/agenda?data=${day}&unidade=${centro}`);
      await expect(g.getByText("Fechado: Dedetização").first()).toBeVisible();
    });

    await test.step("Resposta automática com a clínica fechada hoje: diz que está fechado e o motivo", async () => {
      const today = (await value<string>("select to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')"))!;
      await exec("insert into clinic_closures (clinic_id, unit_id, starts_on, ends_on, reason, kind) values ($1, null, $2, $2, 'Teste de fechamento', 'outro')", [clinicId, today]);
      await exec(`update crm_settings set automations = coalesce(automations, '{}'::jsonb) || '{"fora_horario": {"enabled": true}}'::jsonb where clinic_id = $1`, [clinicId]);
      const phone = `55519${String(Date.now()).slice(-8)}`;
      const r = await as("recepcao");
      await r.goto("/hoje");
      await expect(r.getByRole("status").filter({ hasText: "Teste de fechamento" })).toBeVisible();
      await r.getByRole("button", { name: /Simulador de canais/ }).click();
      await r.locator("#sim-who").selectOption("novo");
      await r.locator("#sim-external").fill(phone);
      await r.locator("#sim-name").fill("Paciente Feriado");
      await r.locator("#sim-text").fill("Oi, quero marcar uma consulta");
      await r.getByRole("button", { name: "Enviar como paciente" }).click();
      await expect
        .poll(() =>
          value(
            `select m.body from messages m join conversations c on c.id = m.conversation_id join contact_identities i on i.contact_id = c.contact_id
              where i.external_id = $1 and m.template_key = 'fora_horario'`,
            [phone],
          ),
        )
        .toContain("hoje estamos fechados: Teste de fechamento");
    });

    await test.step("Semana do profissional fora do funcionamento: salva com aviso", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/clinica");
      await g.getByRole("button", { name: "Editar Dr. Caio Prado" }).click();
      const dlg = g.locator("dialog[open]");
      await dlg.getByRole("button", { name: "Salvar profissional" }).click();
      // Caio atende sábado à tarde; a Unidade Moinhos abre no sábado só de manhã
      await expect(dlg.locator("[role=status], [role=alert]").filter({ hasText: "fora do horário de funcionamento" }).first()).toBeVisible();
    });

    await test.step("Celular: Unidades sem rolagem lateral, com os fechamentos", async () => {
      const cel = await as("gestor", { width: 390, height: 844 });
      await cel.goto("/configuracoes/unidades");
      await expect(cel.getByText(ddmm).first()).toBeVisible();
      await expectNoHorizontalScroll(cel);
    });
  } finally {
    await exec("delete from clinic_closures where clinic_id = $1", [clinicId]);
    await exec("update clinic_units set opening_hours = null where id = $1", [centro]);
    await exec(`update crm_settings set automations = automations - 'fora_horario' where clinic_id = $1`, [clinicId]);
  }
});
