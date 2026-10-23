import { exec, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";
import { resetClinicalData, todayAppointment } from "./support/scenario";

/**
 * "CHEGOU" NO CONSULTÓRIO (clínica sem recepção)
 * O profissional marca a chegada na própria lista do dia, com as mesmas regras da agenda:
 * só a partir de 30 min antes, controle de edição simultânea e "Desfazer" para toque errado.
 */
test.describe.configure({ mode: "serial" });

const RECEPCAO = "recepcao@clinicaexemplo.com.br";

/**
 * Leva a consulta para daqui a N minutos (sem consultório, para não brigar com a agenda da
 * demonstração) e cancela outras consultas da mesma profissional nesse intervalo.
 * Devolve false se o horário cair no dia seguinte (o teste pula esse trecho).
 */
async function moveTo(appointmentId: string, minutes: number): Promise<boolean> {
  const sameDay = await value<boolean>(
    `select ((now() + make_interval(mins => $1)) at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date`,
    [minutes],
  );
  if (!sameDay) return false;
  await exec(
    `update appointments set status = 'cancelado', cancelled_at = now(), cancel_reason = 'teste e2e'
      where professional_id = (select professional_id from appointments where id = $1) and id <> $1 and status <> 'cancelado'
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(now() + make_interval(mins => $2), now() + make_interval(mins => $2 + 30), '[)')`,
    [appointmentId, minutes],
  );
  await exec(
    `update appointments set room_id = null, starts_at = now() + make_interval(mins => $2), ends_at = now() + make_interval(mins => $2 + 30),
            status = 'agendado', arrived_at = null where id = $1`,
    [appointmentId, minutes],
  );
  return true;
}

test("profissional marca a chegada no Consultório, desfaz e respeita as travas", async ({ as }) => {
  await resetClinicalData();
  const { appointmentId } = await todayAppointment("Ana Lúcia Reis", "Dra. Beatriz Lemos");
  const status = () => value<string>("select status from appointments where id = $1", [appointmentId]);
  const chegou = { name: "Marcar que Ana Lúcia Reis chegou" };

  await test.step("Antes de 30 min do horário: botão desabilitado, dizendo a partir de quando", async () => {
    test.skip(!(await moveTo(appointmentId, 120)), "perto da meia-noite: consulta cairia amanhã");
    const b = await as("beatriz");
    await b.goto("/consultorio");
    const btn = b.getByRole("button", chegou).first();
    await expect(btn).toBeDisabled();
    await expect(b.locator("form", { has: btn }).getByText(/a partir das \d{2}:\d{2}/).first()).toBeVisible();
  });

  await test.step("No horário: Chegou registra comparecimento e hora de chegada", async () => {
    test.skip(!(await moveTo(appointmentId, 5)), "perto da meia-noite");
    const b = await as("beatriz");
    await b.goto("/consultorio");
    await b.getByRole("button", chegou).first().click();
    await expect.poll(status).toBe("compareceu");
    expect(await value<boolean>("select arrived_at is not null from appointments where id = $1", [appointmentId])).toBe(true);
    // Linha do tempo do paciente: mesma marca da agenda
    expect(
      await value("select count(*)::int from crm_events where type = 'appointment_status' and data->>'appointmentId' = $1 and data->>'para' = 'compareceu'", [appointmentId]),
    ).toBe(1);
    const row = b.locator("li", { hasText: "Ana Lúcia Reis" }).filter({ has: b.getByRole("button", { name: "Desfazer chegada de Ana Lúcia Reis" }) });
    await expect(row.getByText("Na recepção")).toBeVisible();
  });

  await test.step("Desfazer volta para aguardando (toque errado)", async () => {
    test.skip((await status()) !== "compareceu", "trecho anterior pulado");
    const b = await as("beatriz");
    await b.goto("/consultorio");
    await b.getByRole("button", { name: "Desfazer chegada de Ana Lúcia Reis" }).click();
    await expect.poll(status).toBe("agendado");
    expect(await value("select arrived_at from appointments where id = $1", [appointmentId])).toBeNull();
    await expect(b.getByRole("button", chegou).first()).toBeEnabled();
  });

  await test.step("Edição simultânea: outra pessoa mudou a consulta, a tela avisa e nada é gravado", async () => {
    test.skip((await status()) !== "agendado", "trecho anterior pulado");
    const b = await as("beatriz");
    await b.goto("/consultorio");
    await exec("update appointments set version = version + 1 where id = $1", [appointmentId]);
    await b.getByRole("button", chegou).first().click();
    await expect(b.getByText(/alterada por outra pessoa/).first()).toBeVisible();
    expect(await status()).toBe("agendado");
  });

  await test.step("Com triagem feita não há Desfazer; sem permissão de agenda não há Chegou", async () => {
    test.skip((await status()) !== "agendado", "trecho anterior pulado");
    const b = await as("beatriz");
    await b.goto("/consultorio");
    await b.getByRole("button", chegou).first().click();
    await expect.poll(status).toBe("compareceu");
    await exec(
      `insert into pep_triages (clinic_id, contact_id, appointment_id, priority, recorded_by_name, complaint)
       select clinic_id, contact_id, id, 'normal', 'Teste', 'Cefaleia' from appointments where id = $1`,
      [appointmentId],
    );
    await b.reload();
    await expect(b.getByRole("button", { name: "Desfazer chegada de Ana Lúcia Reis" })).toHaveCount(0);

    // Recepção com o Consultório liberado, mas SEM "Marcar e remarcar consultas"
    await exec("update clinic_users set permission_grants = '{prontuario.consultorio}', permission_revokes = '{agenda.editar}' where email = $1", [RECEPCAO]);
    await exec("delete from pep_triages where appointment_id = $1", [appointmentId]);
    await exec("update appointments set status = 'agendado', arrived_at = null where id = $1", [appointmentId]);
    const r = await as("recepcao");
    await r.goto("/consultorio");
    await expect(r.getByText("Ana Lúcia Reis").first()).toBeVisible();
    await expect(r.getByRole("button", chegou)).toHaveCount(0);
  });

  await test.step("Celular: botão visível e sem rolagem lateral", async () => {
    const cel = await as("beatriz", { width: 390, height: 844 });
    await cel.goto("/consultorio");
    await expect(cel.getByText("Ana Lúcia Reis").first()).toBeVisible();
    await expectNoHorizontalScroll(cel);
  });

  await resetClinicalData();
});
