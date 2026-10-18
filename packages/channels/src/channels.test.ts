/**
 * Testes dos canais com payloads no formato oficial dos provedores.
 * Rodar: pnpm --filter @ecosaude/channels test
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  createTelegramAdapter,
  createWhatsAppAdapter,
  messagingWindow,
  parseMessagingWebhook,
  parseTelegramUpdate,
  parseWhatsAppWebhook,
  sampleWhatsAppPayload,
  parseWebhook,
  samplePayload,
  verifyMetaSignature,
  verifyMetaSubscription,
  verifyTelegramSecret,
  type FetchLike,
} from "./index";

describe("WhatsApp Cloud API", () => {
  it("lê mensagem de texto, nome do perfil e conta da clínica", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "555133330000", phone_number_id: "PNID" },
                contacts: [{ profile: { name: "Ana" }, wa_id: "5551999990000" }],
                messages: [{ from: "5551999990000", id: "wamid.ABC", timestamp: "1760000000", type: "text", text: { body: "Oi!" } }],
              },
            },
          ],
        },
      ],
    };
    const r = parseWebhook("whatsapp", body);
    assert.equal(r.messages.length, 1);
    assert.deepEqual(r.messages[0]!.from, { externalId: "5551999990000", phone: "5551999990000", name: "Ana" });
    assert.equal(r.messages[0]!.accountId, "PNID");
    assert.equal(r.messages[0]!.text, "Oi!");
  });

  it("lê status de entrega e mídia sem texto", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID" },
                messages: [{ from: "55", id: "wamid.IMG", timestamp: "1", type: "image", image: { id: "x" } }],
                statuses: [{ id: "wamid.OUT", status: "read", timestamp: "1760000000" }],
              },
            },
          ],
        },
      ],
    };
    const r = parseWebhook("whatsapp", body);
    assert.equal(r.messages[0]!.text, "[imagem]");
    assert.equal(r.statuses[0]!.status, "lida");
  });

  it("envia texto no formato da Graph API", async () => {
    let captured: { url: string; body: string } | null = null;
    const fakeFetch: FetchLike = async (url, init) => {
      captured = { url, body: String(init.body) };
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.SENT" }] }), text: async () => "" };
    };
    const adapter = createWhatsAppAdapter({ accessToken: "t", phoneNumberId: "PNID", graphVersion: "v23.0" }, fakeFetch);
    const res = await adapter.send({ to: "5551999990000", text: "Olá" });
    assert.equal(res.externalMessageId, "wamid.SENT");
    assert.equal(captured!.url, "https://graph.facebook.com/v23.0/PNID/messages");
    assert.equal(JSON.parse(captured!.body).text.body, "Olá");
  });

  it("sem credenciais, falha sem tentar de novo", async () => {
    const adapter = createWhatsAppAdapter({});
    await assert.rejects(adapter.send({ to: "1", text: "x" }), (e: Error & { retryable?: boolean }) => e.retryable === false);
  });
});

describe("Messenger e Instagram", () => {
  it("ignora eco das mensagens da própria página", () => {
    const body = {
      object: "page",
      entry: [
        {
          id: "PAGE",
          messaging: [
            { sender: { id: "PSID" }, recipient: { id: "PAGE" }, timestamp: 1760000000000, message: { mid: "m1", text: "Oi" } },
            { sender: { id: "PAGE" }, recipient: { id: "PSID" }, timestamp: 1760000000000, message: { mid: "m2", text: "Olá", is_echo: true } },
          ],
        },
      ],
    };
    const r = parseWebhook("facebook", body);
    assert.equal(r.messages.length, 1);
    assert.equal(r.messages[0]!.accountId, "PAGE");
  });
  it("não confunde webhook do Instagram com o do Messenger", () => {
    const ig = samplePayload("instagram", { accountId: "IG", from: "u1", text: "oi" });
    assert.equal(parseWebhook("facebook", ig).messages.length, 0);
    assert.equal(parseWebhook("instagram", ig).messages.length, 1);
  });
});

describe("Telegram", () => {
  it("lê o update e torna o ID único por chat", () => {
    const r = parseWebhook("telegram", samplePayload("telegram", { accountId: "bot", from: "123", name: "Jorge Batista", text: "oi" }));
    assert.equal(r.messages[0]!.from.externalId, "123");
    assert.equal(r.messages[0]!.from.name, "Jorge Batista");
    assert.match(r.messages[0]!.externalMessageId, /^123:\d+$/);
  });
  it("envia com sendMessage", async () => {
    const fakeFetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }), text: async () => "" });
    const res = await createTelegramAdapter({ botToken: "x" }, fakeFetch).send({ to: "123", text: "oi" });
    assert.equal(res.externalMessageId, "123:7");
  });
});

describe("segurança dos webhooks", () => {
  it("aceita assinatura correta da Meta e recusa adulterada", () => {
    const raw = JSON.stringify({ object: "page" });
    const sig = "sha256=" + createHmac("sha256", "segredo").update(raw).digest("hex");
    assert.ok(verifyMetaSignature(raw, sig, "segredo"));
    assert.ok(!verifyMetaSignature(raw + " ", sig, "segredo"));
    assert.ok(!verifyMetaSignature(raw, null, "segredo"));
  });
  it("responde o desafio só com o token certo", () => {
    const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tk", "hub.challenge": "42" });
    assert.equal(verifyMetaSubscription(ok, "tk"), "42");
    assert.equal(verifyMetaSubscription(ok, "outro"), null);
  });
  it("confere o segredo do Telegram", () => {
    assert.ok(verifyTelegramSecret("abc", "abc"));
    assert.ok(!verifyTelegramSecret("abd", "abc"));
  });
});

describe("janela de 24h", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("WhatsApp fecha 24h após a última mensagem do paciente", () => {
    assert.equal(messagingWindow("whatsapp", new Date("2026-10-07T13:00:00Z"), now).open, true);
    assert.equal(messagingWindow("whatsapp", new Date("2026-10-07T11:00:00Z"), now).open, false);
    assert.equal(messagingWindow("whatsapp", null, now).open, false);
  });
  it("Telegram não tem janela", () => {
    assert.equal(messagingWindow("telegram", null, now).open, true);
  });
});

describe("anexos nos canais", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  it("WhatsApp: lê imagem com legenda e documento com nome (só a referência, sem baixar)", () => {
    const body = sampleWhatsAppPayload({
      accountId: "PN",
      from: "5551999990000",
      text: "segue o exame",
      id: "wamid.1",
      at: new Date(),
      media: { kind: "image", key: "abc", mime: "image/png", fileName: "x.png" },
    });
    const m = parseWhatsAppWebhook(body).messages[0]!;
    assert.equal(m.text, "segue o exame");
    assert.deepEqual(m.attachments, [{ kind: "image", ref: { provider: "simulado", key: "abc" }, mime: "image/png", fileName: undefined }]);
    const real = JSON.parse(JSON.stringify(body));
    real.entry[0].changes[0].value.messages[0] = {
      from: "5551999990000",
      id: "wamid.2",
      timestamp: "1",
      type: "document",
      document: { id: "MEDIA123", mime_type: "application/pdf", filename: "laudo.pdf" },
    };
    const d = parseWhatsAppWebhook(real).messages[0]!;
    assert.equal(d.text, "[documento: laudo.pdf]");
    assert.deepEqual(d.attachments?.[0]?.ref, { provider: "whatsapp", mediaId: "MEDIA123" });
  });
  it("Telegram: foto pega o MAIOR tamanho; voz vira áudio", () => {
    const up = { message: { message_id: 9, chat: { id: 77 }, from: { first_name: "Ana" }, date: 1, photo: [{ file_id: "small" }, { file_id: "BIG", file_size: 900 }] } };
    const m = parseTelegramUpdate(up).messages[0]!;
    assert.equal(m.text, "[imagem]");
    assert.deepEqual(m.attachments?.[0]?.ref, { provider: "telegram", fileId: "BIG" });
    const v = parseTelegramUpdate({ message: { message_id: 10, chat: { id: 77 }, date: 1, voice: { file_id: "V1", mime_type: "audio/ogg" } } }).messages[0]!;
    assert.equal(v.attachments?.[0]?.kind, "audio");
    assert.equal(v.text, "[áudio]");
  });
  it("Messenger/Instagram: anexo com link temporário; arquivo vira documento", () => {
    const body = {
      object: "page",
      entry: [{ id: "PG", messaging: [{ sender: { id: "u1" }, timestamp: 1, message: { mid: "m1", attachments: [{ type: "file", payload: { url: "https://cdn.fbsbx.com/x.pdf" } }] } }] }],
    };
    const m = parseMessagingWebhook(body, "facebook").messages[0]!;
    assert.equal(m.text, "[documento]");
    assert.deepEqual(m.attachments?.[0], { kind: "document", ref: { provider: "url", url: "https://cdn.fbsbx.com/x.pdf" } });
  });
  it("WhatsApp: envia anexo em 2 passos (sobe o arquivo e manda a mensagem com o ID)", async () => {
    const calls: { url: string; multipart: boolean; body: string }[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, multipart: init.body instanceof FormData, body: init.body instanceof FormData ? "" : String(init.body) });
      return { ok: true, status: 200, json: async () => (url.endsWith("/media") ? { id: "MID" } : { messages: [{ id: "wamid.MEDIA" }] }), text: async () => "" };
    };
    const a = createWhatsAppAdapter({ accessToken: "t", phoneNumberId: "PN" }, fakeFetch);
    const r = await a.send({ to: "5551", text: "Seu pedido de exame", media: { kind: "document", mime: "application/pdf", fileName: "pedido.pdf", bytes: png } });
    assert.equal(r.externalMessageId, "wamid.MEDIA");
    assert.equal(calls[0]!.multipart, true);
    assert.ok(calls[0]!.url.endsWith("/PN/media"));
    const sent = JSON.parse(calls[1]!.body);
    assert.equal(sent.type, "document");
    assert.deepEqual(sent.document, { id: "MID", caption: "Seu pedido de exame", filename: "pedido.pdf" });
  });
  it("WhatsApp: baixa a mídia (link + arquivo) e recusa acima do limite sem baixar", async () => {
    const fakeFetch =
      (size: number): FetchLike =>
      async (url) => {
        if (url.includes("/MEDIA9")) return { ok: true, status: 200, json: async () => ({ url: "https://lookaside.fbsbx.com/f", mime_type: "image/png", file_size: size }), text: async () => "" };
        return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => png.buffer.slice(0), headers: { get: () => null } };
      };
    const ok = await createWhatsAppAdapter({ accessToken: "t" }, fakeFetch(11)).downloadMedia!({ provider: "whatsapp", mediaId: "MEDIA9" }, 1000);
    assert.equal(ok.bytes.length, 11);
    await assert.rejects(createWhatsAppAdapter({ accessToken: "t" }, fakeFetch(5000)).downloadMedia!({ provider: "whatsapp", mediaId: "MEDIA9" }, 1000), /limite/);
  });
});
