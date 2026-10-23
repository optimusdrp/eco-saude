import { createHmac } from "node:crypto";
import { demo, exec, rows, value } from "./support/db";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";

/**
 * RESPOSTAS ENVIADAS DIRETO DO CELULAR DA CLÍNICA (WhatsApp por QR code / Evolution)
 *
 * Quando alguém da equipe responde o paciente pelo próprio celular, a Evolution avisa com
 * key.fromMe = true. O Tropi registra a mensagem em Conversas como "enviada pelo celular":
 *  - sai como mensagem da equipe (status enviada, sem autor, meta.source = "celular");
 *  - tira a conversa de "esperando resposta" e NÃO mexe na janela de 24h (last_inbound_at);
 *  - repetição do aviso não duplica; envio feito pelo próprio Tropi não vira cópia;
 *  - número que não é contato da clínica é ignorado (não cria contato).
 */
test.describe.configure({ mode: "serial" });

// Mesmo segredo do webServer (playwright.config.ts)
const SECRET = process.env.EVOLUTION_WEBHOOK_SECRET ?? "e2e-evolution-secret";
const INSTANCE = "e2e-inst";
const ANA_PHONE = "5551991110001";

/** Corpo do webhook messages.upsert como a Evolution manda (fromMe = enviada pelo celular) */
function upsert(p: { id: string; to: string; text: string; fromMe?: boolean }) {
  const at = Math.floor(Date.now() / 1000);
  return {
    event: "messages.upsert",
    instance: INSTANCE,
    data: {
      key: { remoteJid: `${p.to}@s.whatsapp.net`, fromMe: p.fromMe ?? true, id: p.id },
      pushName: "Clínica Exemplo",
      message: { conversation: p.text },
      messageType: "conversation",
      messageTimestamp: at,
    },
    date_time: new Date(at * 1000).toISOString(),
    sender: "555133330000@s.whatsapp.net",
  };
}

const signature = createHmac("sha256", SECRET).update(`evolution:${INSTANCE}`).digest("hex");

test("mensagem enviada pelo celular da clínica aparece em Conversas, sem duplicar", async ({ as, request }) => {
  const clinicId = (await demo.clinicId())!;
  const ana = (await demo.contactId("Ana Lúcia Reis"))!;
  const convId = (await value<string>("select id from conversations where contact_id = $1 and channel = 'whatsapp'", [ana]))!;
  const gestorId = (await value<string>("select id from clinic_users where clinic_id = $1 and role = 'gestor' limit 1", [clinicId]))!;
  const run = Date.now().toString(36).toUpperCase();
  const before = (await rows<Record<string, unknown>>("select mode, kind, external_account_id, connection_state from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId]))[0]!;
  const conv = (await rows<Record<string, unknown>>("select status, unread_count, awaiting_reply_since, last_inbound_at from conversations where id = $1", [convId]))[0]!;

  const post = (body: unknown) => request.post("/api/webhooks/evolution", { data: body, headers: { "x-tropi-evolution": signature } });

  // WhatsApp da clínica "conectado de verdade" pelo QR code (o demo usa o simulador)
  await exec("update channel_connections set mode = 'real', kind = 'evolution_qr', external_account_id = $2, connection_state = 'conectado' where clinic_id = $1 and channel = 'whatsapp'", [clinicId, INSTANCE]);
  // Ana esperando resposta, com a janela de 24h aberta por uma mensagem dela de 1h atrás
  await exec("update conversations set status = 'aberta', unread_count = 2, awaiting_reply_since = now() - interval '1 hour', last_inbound_at = now() - interval '1 hour' where id = $1", [convId]);
  const inboundAt = await value<string>("select last_inbound_at::text from conversations where id = $1", [convId]);

  try {
    await test.step("Assinatura errada: recusado", async () => {
      const res = await request.post("/api/webhooks/evolution", { data: upsert({ id: `BAD-${run}`, to: ANA_PHONE, text: "x" }), headers: { "x-tropi-evolution": "errada" } });
      expect(res.status()).toBe(401);
    });

    await test.step("Resposta pelo celular: registrada como da equipe, tira de 'esperando', não mexe nas 24h", async () => {
      const res = await post(upsert({ id: `CEL-${run}`, to: ANA_PHONE, text: `Oi Ana, confirmado para amanhã às 9h (${run})` }));
      expect(res.status()).toBe(200);
      const m = (await rows<Record<string, unknown>>("select direction, status, author_id, meta->>'source' as source from messages where clinic_id = $1 and external_id = $2", [clinicId, `CEL-${run}`]))[0];
      expect(m).toMatchObject({ direction: "out", status: "enviada", author_id: null, source: "celular" });
      const c = (await rows<Record<string, unknown>>("select status, unread_count, awaiting_reply_since, last_inbound_at::text as inbound from conversations where id = $1", [convId]))[0]!;
      expect(c).toMatchObject({ status: "aguardando_paciente", unread_count: 0, awaiting_reply_since: null, inbound: inboundAt });
    });

    await test.step("A Evolution repete o aviso: não duplica", async () => {
      expect((await post(upsert({ id: `CEL-${run}`, to: ANA_PHONE, text: `Oi Ana, confirmado para amanhã às 9h (${run})` }))).status()).toBe(200);
      expect(await value("select count(*)::int from messages where clinic_id = $1 and external_id = $2", [clinicId, `CEL-${run}`])).toBe(1);
    });

    await test.step("Número que não é contato da clínica: ignorado, sem criar contato", async () => {
      const stranger = `55519${run.slice(-8).replace(/\D/g, "7").padStart(8, "7")}`;
      expect((await post(upsert({ id: `UNK-${run}`, to: stranger, text: "Mensagem pessoal" }))).status()).toBe(200);
      expect(await value("select count(*)::int from messages where clinic_id = $1 and external_id = $2", [clinicId, `UNK-${run}`])).toBe(0);
      expect(await value("select count(*)::int from contact_identities where external_id = $1", [stranger])).toBe(0);
    });

    await test.step("Eco de mensagem que o próprio Tropi enviou (já com ID): não duplica", async () => {
      await exec(
        "insert into messages (clinic_id, conversation_id, channel, direction, body, status, author_id, external_id, sent_at) values ($1, $2, 'whatsapp', 'out', $3, 'enviada', $4, $5, now())",
        [clinicId, convId, `Pelo Tropi ${run}`, gestorId, `TROPI-${run}`],
      );
      await post(upsert({ id: `TROPI-${run}`, to: ANA_PHONE, text: `Pelo Tropi ${run}` }));
      expect(await value("select count(*)::int from messages where conversation_id = $1 and body = $2", [convId, `Pelo Tropi ${run}`])).toBe(1);
    });

    await test.step("Eco que chega antes do Tropi gravar o ID: casa pelo texto e não duplica", async () => {
      const id = await value<string>(
        "insert into messages (clinic_id, conversation_id, channel, direction, body, status, author_id, sent_at) values ($1, $2, 'whatsapp', 'out', $3, 'enviada', $4, now()) returning id",
        [clinicId, convId, `Corrida ${run}`, gestorId],
      );
      await post(upsert({ id: `RACE-${run}`, to: ANA_PHONE, text: `Corrida ${run}` }));
      expect(await value("select count(*)::int from messages where conversation_id = $1 and body = $2", [convId, `Corrida ${run}`])).toBe(1);
      expect(await value("select external_id from messages where id = $1", [id])).toBe(`RACE-${run}`);
    });

    await test.step("Conversas: a mensagem aparece marcada 'Enviada pelo celular'", async () => {
      const r = await as("recepcao");
      await r.goto(`/crm/conversas/${convId}`);
      await expect(r.getByText(`Oi Ana, confirmado para amanhã às 9h (${run})`)).toBeVisible();
      await expect(r.getByText("Enviada pelo celular").first()).toBeVisible();
    });

    await test.step("Celular: a conversa sem rolagem lateral", async () => {
      const cel = await as("recepcao", { width: 390, height: 844 });
      await cel.goto(`/crm/conversas/${convId}`);
      await expect(cel.getByText("Enviada pelo celular").first()).toBeVisible();
      await expectNoHorizontalScroll(cel);
    });
  } finally {
    await exec("delete from messages where clinic_id = $1 and (external_id like $2 or body like $3)", [clinicId, `%-${run}`, `%${run}%`]);
    await exec("update channel_connections set mode = $2, kind = $3, external_account_id = $4, connection_state = $5 where clinic_id = $1 and channel = 'whatsapp'", [
      clinicId,
      before.mode,
      before.kind,
      before.external_account_id,
      before.connection_state,
    ]);
    await exec("update conversations set status = $2, unread_count = $3, awaiting_reply_since = $4, last_inbound_at = $5 where id = $1", [convId, conv.status, conv.unread_count, conv.awaiting_reply_since, conv.last_inbound_at]);
  }
});
