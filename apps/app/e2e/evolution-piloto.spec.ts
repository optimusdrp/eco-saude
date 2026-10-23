import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { findPersonalData } from "../../../packages/channels/src/evolution-capture";
import { demo, exec, rows, value } from "./support/db";
import { FakeEvolution } from "./support/fake-evolution";
import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";

/**
 * ENSAIO DO PILOTO DO WHATSAPP (Evolution v2.3.7 de mentira, mesmo formato da real)
 *
 * O mesmo roteiro do piloto com celular real (infra/evolution/PILOTO.md), de ponta a ponta:
 *  1. conectar pelo QR code;
 *  2. paciente manda texto, foto, PDF e nota de voz: chegam em Conversas e os arquivos baixam;
 *  3. a equipe responde: entregue e lida voltam da Evolution;
 *  4. queda que a Evolution recupera sozinha: a mensagem espera e sai quando volta;
 *  5. saiu pelo celular (401): aviso em todas as telas, fila esperando;
 *  6. reconectar pelo código no celular: o código mais recente aparece e a fila sai;
 *  7. o modo gravação guardou tudo SEM dados pessoais.
 */
test.describe.configure({ mode: "serial" });

const ANA = "5551991110001";
const CAPTURES = path.resolve(__dirname, ".capturas-evolution");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString("base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(24)]).toString("base64");

test("piloto do WhatsApp: QR code, mensagens e arquivos, entrega, quedas e código no celular", async ({ as }) => {
  test.setTimeout(150_000);
  const evo = new FakeEvolution();
  await evo.start();
  rmSync(CAPTURES, { recursive: true, force: true });

  const clinicId = (await demo.clinicId())!;
  const ana = (await demo.contactId("Ana Lúcia Reis"))!;
  const convId = (await value<string>("select id from conversations where contact_id = $1 and channel = 'whatsapp'", [ana]))!;
  const started = (await value<string>("select now()::text"))!;
  const conn = (await rows<Record<string, unknown>>("select mode, kind, external_account_id, connection_state, display_name, last_error from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId]))[0]!;
  const conv = (await rows<Record<string, unknown>>("select status, unread_count, awaiting_reply_since, last_inbound_at, last_message_at, last_message_preview from conversations where id = $1", [convId]))[0]!;
  const waState = () => value<string>("select connection_state from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId]);
  const newMessages = (direction: "in" | "out") =>
    rows<{ id: string; body: string; status: string; external_id: string | null; error: string | null }>(
      "select id, body, status, external_id, error from messages where conversation_id = $1 and direction = $2 and created_at > $3::timestamptz and (meta->>'source' is null) order by created_at",
      [convId, direction, started],
    );
  // Responde pela tela de Conversas, como a recepção faz
  const reply = async (text: string) => {
    const r = await as("recepcao");
    await r.goto(`/crm/conversas/${convId}`);
    await r.locator("#composer").fill(text);
    await r.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect.poll(async () => (await newMessages("out")).some((m) => m.body === text)).toBe(true);
  };

  try {
    await test.step("1. Conectar pelo QR code", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/canais");
      await g.getByRole("button", { name: "Gerar QR code" }).click();
      await expect(g.getByRole("img", { name: "QR code para conectar o WhatsApp da clínica" })).toBeVisible();
      // Até o celular confirmar, o canal segue na simulação (nada se perde no meio do caminho)
      expect(await value("select mode from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId])).toBe("simulacao");
      expect(await evo.connect()).toBe(200);
      await expect.poll(waState).toBe("conectado");
      await expect(g.getByText(/WhatsApp conectado: \+55 51 3333-0000/)).toBeVisible({ timeout: 15_000 });
      expect(await value("select mode from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId])).toBe("real");
    });

    await test.step("2. Paciente manda texto, foto, PDF e nota de voz: chegam e os arquivos baixam", async () => {
      expect((await evo.patientMessage(ANA, { conversation: "Bom dia, piloto do WhatsApp" }, "conversation", { pushName: "Ana" })).status).toBe(200);
      await evo.patientMessage(ANA, { imageMessage: { mimetype: "image/jpeg", caption: "Foto do exame", fileLength: { low: 12, high: 0, unsigned: true } } }, "imageMessage", { media: { base64: JPEG, mimetype: "image/jpeg" } });
      await evo.patientMessage(ANA, { documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "exame.pdf", caption: "Resultado" } } } }, "documentWithCaptionMessage", { media: { base64: PDF, mimetype: "application/pdf", fileName: "exame.pdf" } });
      await evo.patientMessage(ANA, { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: 3 } }, "audioMessage", { media: { base64: OGG, mimetype: "audio/ogg; codecs=opus" } });
      // Horário da mensagem = horário do WhatsApp (em segundos): no mesmo segundo a ordem não importa
      await expect.poll(async () => (await newMessages("in")).map((m) => m.body).sort()).toEqual(["Bom dia, piloto do WhatsApp", "Foto do exame", "Resultado", "[áudio]"].sort());
      // Os três arquivos foram pedidos à Evolution e conferidos pelo conteúdo
      await expect
        .poll(() =>
          rows<{ kind: string; status: string }>(
            "select a.kind, a.status from message_attachments a join messages m on m.id = a.message_id where m.conversation_id = $1 and m.created_at > $2::timestamptz order by a.kind",
            [convId, started],
          ),
        )
        .toEqual([
          { kind: "audio", status: "pronto" },
          { kind: "document", status: "pronto" },
          { kind: "image", status: "pronto" },
        ]);
      const r = await as("recepcao");
      await r.goto(`/crm/conversas/${convId}`);
      await expect(r.getByText("Bom dia, piloto do WhatsApp")).toBeVisible();
    });

    await test.step("3. A equipe responde: sai pela Evolution e volta entregue e lida", async () => {
      await reply("Bom dia, Ana! Recebemos o exame.");
      await expect.poll(() => evo.sent.map((s) => s.text)).toContain("Bom dia, Ana! Recebemos o exame.");
      const sent = evo.sent.find((s) => s.text === "Bom dia, Ana! Recebemos o exame.")!;
      expect(sent.route).toBe("sendText");
      expect(sent.number).toBe(ANA);
      const msg = async () => (await newMessages("out")).find((m) => m.body === "Bom dia, Ana! Recebemos o exame.")!;
      await expect.poll(async () => (await msg()).external_id).toBe(sent.id);
      await evo.ack(sent.id, "DELIVERY_ACK");
      await expect.poll(async () => (await msg()).status).toBe("entregue");
      await evo.ack(sent.id, "READ");
      await expect.poll(async () => (await msg()).status).toBe("lida");
      // Aviso repetido ou atrasado não volta o status
      await evo.ack(sent.id, "DELIVERY_ACK");
      expect((await msg()).status).toBe("lida");
    });

    await test.step("4. Queda que a Evolution recupera sozinha: a mensagem espera e sai quando volta", async () => {
      await evo.reconnecting();
      await expect.poll(waState).toBe("conectando");
      await reply("Mensagem durante a queda");
      const queued = async () => (await newMessages("out")).find((m) => m.body === "Mensagem durante a queda")!;
      await expect.poll(async () => (await queued()).status).toBe("fila");
      expect(evo.sent.some((s) => s.text === "Mensagem durante a queda")).toBe(false);
      await evo.connect();
      // Reconectou: sai na hora, sem esperar a rotina de 10 minutos
      await expect.poll(() => evo.sent.map((s) => s.text)).toContain("Mensagem durante a queda");
      await expect.poll(async () => (await queued()).status).toBe("enviada");
    });

    await test.step("5. Saiu pelo celular (401): aviso em todas as telas e fila esperando", async () => {
      await evo.loggedOut();
      await expect.poll(waState).toBe("desconectado");
      expect(await value("select last_error from channel_connections where clinic_id = $1 and channel = 'whatsapp'", [clinicId])).toMatch(/desconectado no celular/);
      const r = await as("recepcao");
      await r.goto("/hoje");
      await expect(r.getByText(/WhatsApp desconectado: as mensagens esperam na fila/)).toBeVisible();
      await reply("Mensagem com o celular desconectado");
      await expect.poll(async () => (await newMessages("out")).find((m) => m.body === "Mensagem com o celular desconectado")?.status).toBe("fila");
    });

    await test.step("6. Reconectar pelo código no celular: mostra o código mais recente e a fila sai", async () => {
      const g = await as("gestor");
      await g.goto("/configuracoes/canais");
      await expect(g.getByRole("alert").filter({ hasText: "desconectado no celular" })).toBeVisible();
      await g.getByRole("radio", { name: "Código no celular" }).click();
      await g.getByLabel("Número do WhatsApp da clínica").fill("(51) 3333-0000");
      await g.getByRole("button", { name: "Gerar código" }).click();
      const inst = evo.only();
      await expect.poll(() => inst.pairingCode).not.toBeNull();
      const first = inst.pairingCode!;
      await expect(g.getByText(`${first.slice(0, 4)}-${first.slice(4)}`)).toBeVisible();
      // A Evolution gera um código novo a cada QR: a tela troca para o mais recente
      inst.state = "close";
      await fetch(`http://127.0.0.1:${process.env.E2E_EVOLUTION_PORT || 3199}/instance/connect/${encodeURIComponent(inst.name)}?number=555133330000`, { headers: { apikey: "e2e-evo-key" } });
      const second = inst.pairingCode!;
      expect(second).not.toBe(first);
      await expect(g.getByText(`${second.slice(0, 4)}-${second.slice(4)}`)).toBeVisible({ timeout: 10_000 });
      await evo.connect();
      await expect.poll(waState).toBe("conectado");
      await expect.poll(() => evo.sent.map((s) => s.text)).toContain("Mensagem com o celular desconectado");
      await expect(g.getByText(/WhatsApp conectado/)).toBeVisible({ timeout: 15_000 });
    });

    await test.step("7. Modo gravação: tudo gravado, nada pessoal", async () => {
      const files = readdirSync(CAPTURES).filter((f) => f.endsWith(".json"));
      // conexões, 4 mensagens do paciente e os status de entrega e leitura
      expect(files.length).toBeGreaterThanOrEqual(10);
      expect(files.some((f) => f.includes("messages.upsert-audioMessage-paciente"))).toBe(true);
      for (const f of files) {
        const text = readFileSync(path.join(CAPTURES, f), "utf8");
        expect(text, f).not.toContain(ANA);
        expect(text, f).not.toContain("piloto do WhatsApp");
        expect(text, f).not.toContain("exame.pdf");
        expect(findPersonalData(JSON.parse(text)), f).toEqual([]);
      }
    });

    await test.step("Celular: tela de Canais sem rolagem lateral", async () => {
      const cel = await as("gestor", { width: 390, height: 844 });
      await cel.goto("/configuracoes/canais");
      await expect(cel.getByText(/WhatsApp conectado|\+55 51 3333-0000/).first()).toBeVisible();
      await expectNoHorizontalScroll(cel);
    });
  } finally {
    await evo.stop();
    await exec("delete from messages where conversation_id = $1 and created_at > $2::timestamptz", [convId, started]);
    await exec(
      "update channel_connections set mode = $2, kind = $3, external_account_id = $4, connection_state = $5, display_name = $6, last_error = $7 where clinic_id = $1 and channel = 'whatsapp'",
      [clinicId, conn.mode, conn.kind, conn.external_account_id, conn.connection_state, conn.display_name, conn.last_error],
    );
    await exec(
      "update conversations set status = $2, unread_count = $3, awaiting_reply_since = $4, last_inbound_at = $5, last_message_at = $6, last_message_preview = $7 where id = $1",
      [convId, conv.status, conv.unread_count, conv.awaiting_reply_since, conv.last_inbound_at, conv.last_message_at, conv.last_message_preview],
    );
  }
});
