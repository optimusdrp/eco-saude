import { createHmac } from "node:crypto";
import { demo, exec, rows, value } from "./support/db";
import { E2E } from "./support/env";
import { FakeEvolution } from "./support/fake-evolution";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";

/**
 * RITMO DE ENVIO DO WHATSAPP DO CELULAR
 *  - a gestão escolhe o ritmo em Ajustes > Canais (sugestões com descrição ou personalizado);
 *  - as automáticas saem espaçadas, uma por vez, e param no limite por hora (o resto espera);
 *  - a resposta digitada pela equipe sai na hora, mesmo com fila de automáticas;
 *  - lembrete de consulta que já começou não sai ("venceu na fila");
 *  - a tela de Canais mostra a fila, o limite e as que venceram.
 */
test.describe.configure({ mode: "serial" });

const INSTANCE = "e2e-ritmo";

test("ritmo do WhatsApp do celular: intervalo, limite por hora, resposta na hora e vencidas", async ({ as }) => {
  test.setTimeout(120_000);
  const evo = new FakeEvolution();
  await evo.start();
  evo.addConnected(INSTANCE, `${E2E.baseUrl}/api/webhooks/evolution`, {
    "x-tropi-evolution": createHmac("sha256", "e2e-evolution-secret").update(`evolution:${INSTANCE}`).digest("hex"),
  });

  const clinicId = (await demo.clinicId())!;
  const ana = (await demo.contactId("Ana Lúcia Reis"))!;
  const convId = (await value<string>("select id from conversations where contact_id = $1 and channel = 'whatsapp'", [ana]))!;
  const started = (await value<string>("select now()::text"))!;
  const conn = (await rows<Record<string, unknown>>("select mode, kind, external_account_id, connection_state, display_name, pacing from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId]))[0]!;
  const conv = (await rows<Record<string, unknown>>("select status, unread_count, awaiting_reply_since, last_inbound_at, last_message_at, last_message_preview from conversations where id = $1", [convId]))[0]!;
  const pastAppointment = (await value<string>("select id from appointments where clinic_id = $1 and starts_at < now() order by starts_at desc limit 1", [clinicId]))!;
  // Outras mensagens do WhatsApp já enviadas na última hora (de outros testes) contam no limite
  const base = (await value<number>(
    "select count(*)::int from messages where clinic_id = $1 and channel = 'whatsapp' and direction = 'out' and sent_at > now() - interval '1 hour' and status in ('enviada','entregue','lida')",
    [clinicId],
  ))!;
  const perHour = base + 4;
  // Automáticas do WhatsApp que outro teste deixou na fila esperam o fim deste (não roubam a vez)
  const parked = await rows<{ id: string; send_after: string | null }>(
    "update messages m set send_after = now() + interval '1 day' from (select id, send_after from messages where clinic_id = $1 and channel = 'whatsapp' and direction = 'out' and status = 'fila' and author_id is null) old where m.id = old.id returning m.id, old.send_after::text as send_after",
    [clinicId],
  );
  const baseQueued = (await value<number>("select count(*)::int from messages where clinic_id = $1 and channel = 'whatsapp' and direction = 'out' and status = 'fila'", [clinicId]))!;

  // WhatsApp do celular conectado de verdade (com a Evolution de mentira); janela de 24h aberta
  await exec(
    "update channel_connections set mode = 'real', kind = 'evolution_qr', external_account_id = $2, connection_state = 'conectado', display_name = '+55 51 3333-0000', pacing = null, pace_next_at = null where clinic_id = $1 and channel = 'whatsapp'",
    [clinicId, INSTANCE],
  );
  await exec("update conversations set last_inbound_at = now() where id = $1", [convId]);

  try {
    await test.step("Gestão escolhe o ritmo: sugestões com descrição ou personalizado", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/canais");
      const form = g.locator("form").filter({ hasText: "Ritmo das mensagens automáticas" });
      // O padrão é o cauteloso, e cada sugestão diz para quem serve e o que significa
      await expect(form.getByRole("radio", { name: /Número novo \(cauteloso\)/ })).toBeChecked();
      await expect(form.getByText("Até 6 por minuto e 60 por hora")).toBeVisible();
      await expect(form.getByText(/Depois de um aviso ou bloqueio temporário/)).toBeVisible();
      await form.getByRole("radio", { name: /Personalizado/ }).check();
      await form.getByRole("spinbutton", { name: "Intervalo mínimo (s)" }).fill("2");
      await form.getByRole("spinbutton", { name: "Intervalo máximo (s)" }).fill("3");
      await form.getByRole("spinbutton", { name: "Por minuto" }).fill(String(Math.min(20, perHour)));
      await form.getByRole("spinbutton", { name: "Por hora" }).fill(String(perHour));
      await form.getByRole("button", { name: "Salvar ritmo" }).click();
      await expect(form.getByText("Ritmo de envio salvo")).toBeVisible();
      expect(await value("select pacing->>'perHour' from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId])).toBe(String(perHour));
    });

    await test.step("Automáticas saem uma por vez, com intervalo; a digitada sai na hora", async () => {
      // 5 automáticas (retorno em lote) e 1 lembrete de consulta que já começou
      for (let i = 1; i <= 5; i++) {
        await exec(
          "insert into messages (clinic_id, conversation_id, channel, direction, body, status, author_id, template_key, meta, created_at) values ($1, $2, 'whatsapp', 'out', $3, 'fila', null, 'retorno', '{\"kind\":\"return\"}', now() + ($4 * interval '1 millisecond'))",
          [clinicId, convId, `Retorno automático ${i}`, i],
        );
      }
      await exec(
        "insert into messages (clinic_id, conversation_id, channel, direction, body, status, author_id, template_key, meta) values ($1, $2, 'whatsapp', 'out', 'Lembrete atrasado', 'fila', null, 'lembrete', jsonb_build_object('appointmentId', $3::text))",
        [clinicId, convId, pastAppointment],
      );
      // A recepção responde com a fila cheia: sai na hora
      const r = await as("recepcao");
      await r.goto(`/crm/conversas/${convId}`);
      await r.locator("#composer").fill("Resposta digitada na hora");
      const t0 = Date.now();
      await r.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect.poll(() => evo.sent.find((s) => s.text === "Resposta digitada na hora")?.at ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
      expect(evo.sent.find((s) => s.text === "Resposta digitada na hora")!.at - t0).toBeLessThan(5000);

      // Limite por hora: só cabem mais 3 (4 menos a digitada); as outras 2 esperam
      const automatic = () => evo.sent.filter((s) => s.text?.startsWith("Retorno automático"));
      await expect.poll(() => automatic().length, { timeout: 30_000 }).toBe(3);
      const at = automatic().map((s) => s.at);
      for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!, "intervalo entre automáticas").toBeGreaterThanOrEqual(1800);
      // Na ordem em que entraram na fila
      expect(automatic().map((s) => s.text)).toEqual(["Retorno automático 1", "Retorno automático 2", "Retorno automático 3"]);
      // Mesmo esperando mais, nada além do limite sai
      await new Promise((ok) => setTimeout(ok, 4000));
      expect(automatic().length).toBe(3);
      expect(await value("select count(*)::int from messages where conversation_id = $1 and status = 'fila' and body like 'Retorno automático%'", [convId])).toBe(2);
    });

    await test.step("Lembrete de consulta que já começou não sai: venceu na fila", async () => {
      expect(evo.sent.some((s) => s.text === "Lembrete atrasado")).toBe(false);
      const m = (await rows<{ status: string; error: string }>("select status, error from messages where conversation_id = $1 and body = 'Lembrete atrasado'", [convId]))[0]!;
      expect(m.status).toBe("falhou");
      expect(m.error).toBe("Não enviada: venceu na fila (a consulta já começou).");
    });

    await test.step("Canais mostra a fila, o limite atingido e as vencidas", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/canais");
      const fila = g.getByRole("region", { name: "Fila do WhatsApp" });
      await expect(fila.getByText(`${baseQueued + 2} mensagens aguardando`)).toBeVisible();
      await expect(fila.getByTestId("fila-automaticas")).toHaveText(String(baseQueued + 2));
      await expect(fila.getByTestId("enviadas-hora")).toHaveText(`${perHour} de ${perHour}`);
      await expect(fila.getByText("limite por hora atingido")).toBeVisible();
      await expect(fila.getByText(/1 mensagem automática não foi enviada/)).toBeVisible();
      // Troca para uma sugestão pronta
      const form = g.locator("form").filter({ hasText: "Ritmo das mensagens automáticas" });
      await form.getByRole("radio", { name: /Número aquecido/ }).check();
      await form.getByRole("button", { name: "Salvar ritmo" }).click();
      await expect(form.getByText("Ritmo de envio salvo")).toBeVisible();
      expect(await value("select pacing->>'preset' from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId])).toBe("aquecido");
    });

    await test.step("Celular: Canais com a fila e o ritmo, sem rolagem lateral", async () => {
      const cel = await as("gestor", { width: 390, height: 844 });
      await cel.goto("/configuracoes/canais");
      await expect(cel.getByText("Ritmo das mensagens automáticas")).toBeVisible();
      await expectNoHorizontalScroll(cel);
    });
  } finally {
    await evo.stop();
    for (const p of parked) await exec("update messages set send_after = $2::timestamptz where id = $1", [p.id, p.send_after]);
    await exec("delete from messages where conversation_id = $1 and created_at > $2::timestamptz", [convId, started]);
    await exec(
      "update channel_connections set mode = $2, kind = $3, external_account_id = $4, connection_state = $5, display_name = $6, pacing = $7, pace_next_at = null where clinic_id = $1 and channel = 'whatsapp'",
      [clinicId, conn.mode, conn.kind, conn.external_account_id, conn.connection_state, conn.display_name, conn.pacing],
    );
    await exec(
      "update conversations set status = $2, unread_count = $3, awaiting_reply_since = $4, last_inbound_at = $5, last_message_at = $6, last_message_preview = $7 where id = $1",
      [convId, conv.status, conv.unread_count, conv.awaiting_reply_since, conv.last_inbound_at, conv.last_message_at, conv.last_message_preview],
    );
  }
});
