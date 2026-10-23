import { demo, exec, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";
import { resetClinicalData } from "./support/scenario";

/**
 * HORÁRIOS LIVRES x CONSULTÓRIOS
 * Um horário livre do profissional só aparece se houver consultório livre na unidade, e cada
 * horário mostra a sala sugerida (a mesma que a marcação usa).
 *
 * Cenário: Dra. Helena sem sala fixa, atendendo na Unidade Centro das 08:00 às 10:00 (consultas
 * de 40 min: 08:00, 08:40, 09:20). Num dia de teste, Sala 1 e Sala 2 ficam ocupadas das 08:00
 * às 09:00 por outros profissionais (a Sala 3 é desativada durante o teste).
 */
test.describe.configure({ mode: "serial" });

const OCC = "teste e2e: ocupa consultório";

test("horários livres descontam consultórios ocupados e mostram a sala sugerida", async ({ as }) => {
  await resetClinicalData();
  const centro = (await demo.unitId("Unidade Centro"))!;
  const helena = (await demo.professionalId("Dra. Helena Duarte"))!;
  const caio = (await demo.professionalId("Dr. Caio Prado"))!;
  const beatriz = (await demo.professionalId("Dra. Beatriz Lemos"))!;
  const contact = (await demo.contactId("Jorge Batista"))!;
  const ana = (await demo.contactId("Ana Lúcia Reis"))!;
  const room = (name: string) => value<string>("select id from clinic_rooms where unit_id = $1 and name = $2", [centro, name]);
  const [sala1, sala2] = [(await room("Sala 1"))!, (await room("Sala 2"))!];
  const original = await value<unknown>("select weekly_schedule from professionals where id = $1", [helena]);
  // Dia do teste: daqui a 3 dias (horário de Brasília)
  const day = (await value<string>("select to_char((now() at time zone 'America/Sao_Paulo')::date + 3, 'YYYY-MM-DD')"))!;
  const at = (hhmm: string) => `(('${day}'::date + time '${hhmm}') at time zone 'America/Sao_Paulo')`;

  // Helena: todos os dias 08:00-10:00 no Centro, SEM sala fixa
  const period = { start: "08:00", end: "10:00", unitId: centro };
  const week = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((k) => [k, { periods: [period] }]));
  await exec("update professionals set weekly_schedule = $2 where id = $1", [helena, JSON.stringify(week)]);
  const deactivated = (await value<string[]>(
    "with u as (update clinic_rooms set active = false where unit_id = $1 and active and name not in ('Sala 1', 'Sala 2') returning id) select coalesce(array_agg(id), '{}') from u",
    [centro],
  ))!;
  // Libera o dia: consultas de Helena, Caio e Beatriz nesse horário são canceladas
  await exec(
    `update appointments set status = 'cancelado', cancelled_at = now(), cancel_reason = 'teste e2e'
      where professional_id = any($1) and status <> 'cancelado' and starts_at < ${at("10:00")} and ends_at > ${at("08:00")}`,
    [[helena, caio, beatriz]],
  );
  const occupy = (pro: string, roomId: string) =>
    exec(
      `insert into appointments (clinic_id, contact_id, professional_id, unit_id, room_id, starts_at, ends_at, status, service, notes)
       select clinic_id, $1, $2, $3, $4, ${at("08:00")}, ${at("09:00")}, 'agendado', 'Consulta', $5 from professionals where id = $2`,
      [contact, pro, centro, roomId, OCC],
    );
  await occupy(caio, sala1);
  await occupy(beatriz, sala2);

  try {
    const g = await as("gestor");
    const slotsOf = async () => {
      const res = await g.request.get(`/api/agenda/horarios?prof=${helena}&desde=${day}&dias=1&limite=40`);
      expect(res.status()).toBe(200);
      return ((await res.json()) as { slots: { time: string; room: string | null; unit: string | null }[] }).slots.filter((s) => s.time < "10:00");
    };

    await test.step("Salas ocupadas das 08:00 às 09:00: 08:00 e 08:40 somem; 09:20 sai com a Sala 1", async () => {
      const slots = await slotsOf();
      expect(slots.map((s) => s.time)).toEqual(["09:20"]);
      expect(slots[0]).toMatchObject({ room: "Sala 1", unit: "Unidade Centro" });
    });

    await test.step("Uma sala libera: os horários voltam, com a sala livre sugerida", async () => {
      await exec("update appointments set status = 'cancelado', cancelled_at = now() where notes = $1 and room_id = $2", [OCC, sala2]);
      const slots = await slotsOf();
      expect(slots.map((s) => s.time)).toEqual(["08:00", "08:40", "09:20"]);
      expect(slots[0]!.room).toBe("Sala 2");
      expect(slots[2]!.room).toBe("Sala 1");
    });

    await test.step("Tela de agendar: horário mostra a sala, e a consulta recebe exatamente essa sala", async () => {
      await exec(`delete from appointments where contact_id = $1 and professional_id = $2 and starts_at > now()`, [ana, helena]);
      const p = await as("gestor", { width: 390, height: 844 });
      await p.goto(`/crm/contatos/${ana}`);
      await p.getByRole("button", { name: "Agendar" }).first().click();
      const dlg = p.locator("dialog[open]");
      await dlg.locator("select[name=professionalId]").selectOption({ label: "Dra. Helena Duarte, Pediatria" });
      const slot = dlg.locator("button[aria-pressed]").filter({ hasText: /Sala \d/ }).last();
      await expect(slot).toBeVisible({ timeout: 20_000 });
      const shownRoom = (await slot.innerText()).match(/Sala \d/)![0];
      await expectNoHorizontalScroll(p);
      await slot.click();
      await dlg.locator("button[type=submit]").last().click();
      const confirm = dlg.getByRole("button", { name: /Marcar mesmo assim|Confirmar/ });
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await expect
        .poll(() =>
          value(
            `select r.name from appointments a join clinic_rooms r on r.id = a.room_id
              where a.contact_id = $1 and a.professional_id = $2 and a.starts_at > now() and a.status <> 'cancelado'`,
            [ana, helena],
          ),
        )
        .toBe(shownRoom);
    });
  } finally {
    // Deixa a demonstração como estava
    await exec("delete from appointments where notes = $1", [OCC]);
    await exec(`delete from appointments where contact_id = $1 and professional_id = $2 and starts_at > now()`, [ana, helena]);
    await exec("update professionals set weekly_schedule = $2 where id = $1", [helena, JSON.stringify(original)]);
    await exec("update clinic_rooms set active = true where id = any($1)", [deactivated]);
  }
});
