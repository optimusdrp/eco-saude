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

/* ----------------------------- Evolution API ------------------------------- */
import { connectEvolutionInstance, createEvolutionAdapter, evolutionSender, evolutionWebhookSecret, parseEvolutionWebhook, sampleEvolutionMessage, verifyEvolutionWebhook, connectTelegramBot, telegramWebhookSecret, connectInstagram, getAdapter } from "./index";

/** Servidor falso: guarda as chamadas e devolve a resposta configurada por caminho */
function fakeFetch(routes: Record<string, unknown>, calls: { url: string; init: { method: string; headers: Record<string, string>; body?: unknown } }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init: init as never });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const data = key ? routes[key] : { error: "not found" };
    const status = key ? 200 : 404;
    return { ok: status === 200, status, json: async () => data, text: async () => JSON.stringify(data) };
  };
}

describe("Evolution API (WhatsApp por QR code / código / Cloud API)", () => {
  it("lê texto, nome e conta (instância) e ignora as mensagens enviadas pelo próprio celular", () => {
    const r = parseEvolutionWebhook(sampleEvolutionMessage({ instance: "tropi-abc", from: "5551999990000", name: "Ana", text: "Oi, tem horário?", id: "3EB0A1" }));
    assert.equal(r.messages.length, 1);
    const m = r.messages[0]!;
    assert.equal(m.accountId, "tropi-abc");
    assert.equal(m.from.externalId, "5551999990000");
    assert.equal(m.from.phone, "5551999990000");
    assert.equal(m.from.name, "Ana");
    assert.equal(m.text, "Oi, tem horário?");
    // Enviada pelo celular da clínica: não é mensagem do paciente; vai para sentFromPhone
    const mine = parseEvolutionWebhook({ ...sampleEvolutionMessage({ instance: "tropi-abc", from: "5551999990000", name: "Clínica Exemplo", text: "Pode vir às 14h", id: "X", fromMe: true }) });
    assert.equal(mine.messages.length, 0);
    assert.equal(mine.sentFromPhone.length, 1);
    const sent = mine.sentFromPhone[0]!;
    assert.equal(sent.from.externalId, "5551999990000"); // a outra ponta: o paciente
    assert.equal(sent.from.name, undefined); // pushName é o nome da clínica, não vira nome do paciente
    assert.equal(sent.text, "Pode vir às 14h");
    assert.equal(sent.externalMessageId, "X");
  });

  it("foto enviada pelo celular da clínica traz a referência do arquivo (o Tropi baixa depois)", () => {
    const r = parseEvolutionWebhook(sampleEvolutionMessage({ instance: "i1", from: "5551999990000", id: "IMG1", fromMe: true, media: { kind: "image", mime: "image/jpeg" }, text: "Seu pedido de exame" }));
    assert.equal(r.sentFromPhone[0]!.attachments?.[0]?.kind, "image");
    assert.equal(r.sentFromPhone[0]!.text, "Seu pedido de exame");
    // Mensagem do celular para grupo continua ignorada
    assert.equal(parseEvolutionWebhook(sampleEvolutionMessage({ instance: "i1", from: "1203630@g.us", id: "G1", fromMe: true, text: "oi" })).sentFromPhone.length, 0);
  });

  it("ignora grupos, status e canais; aceita LID e prefere o número quando vem junto", () => {
    assert.equal(evolutionSender({ remoteJid: "1203630@g.us" }), null);
    assert.equal(evolutionSender({ remoteJid: "status@broadcast" }), null);
    assert.equal(evolutionSender({ remoteJid: "1234@newsletter" }), null);
    assert.deepEqual(evolutionSender({ remoteJid: "987654321@lid" }), { externalId: "987654321@lid" });
    assert.deepEqual(evolutionSender({ remoteJid: "987654321@lid", remoteJidAlt: "5551988887777@s.whatsapp.net" }), { externalId: "5551988887777", phone: "5551988887777" });
  });

  it("anexo vira referência para baixar depois (o webhook não traz o arquivo)", () => {
    const r = parseEvolutionWebhook(sampleEvolutionMessage({ instance: "i1", from: "5551999990000", id: "M1", media: { kind: "document", mime: "application/pdf", fileName: "exame.pdf" } }));
    const a = r.messages[0]!.attachments![0]!;
    assert.deepEqual(a.ref, { provider: "evolution", instance: "i1", messageId: "M1" });
    assert.equal(a.mime, "application/pdf");
    assert.equal(r.messages[0]!.text, "[documento: exame.pdf]");
  });

  it("desembrulha mensagem efêmera e lê texto estendido; ignora reação", () => {
    const base = { event: "messages.upsert", instance: "i1", data: { key: { remoteJid: "5551@s.whatsapp.net", fromMe: false, id: "E1" }, message: { ephemeralMessage: { message: { extendedTextMessage: { text: "sumindo" } } } }, messageTimestamp: 1 } };
    // número curto demais não é paciente: usa um número válido
    base.data.key.remoteJid = "5551999990000@s.whatsapp.net";
    assert.equal(parseEvolutionWebhook(base).messages[0]!.text, "sumindo");
    const reaction = { ...base, data: { ...base.data, message: { reactionMessage: { text: "👍" } } } };
    assert.equal(parseEvolutionWebhook(reaction).messages.length, 0);
  });

  it("status de entrega (Baileys e Cloud) e estado da conexão", () => {
    const st = parseEvolutionWebhook({ event: "messages.update", instance: "i1", data: { keyId: "OUT1", fromMe: true, status: "DELIVERY_ACK" } });
    assert.equal(st.statuses[0]!.status, "entregue");
    assert.equal(parseEvolutionWebhook({ event: "MESSAGES_UPDATE", instance: "i1", data: { keyId: "OUT1", fromMe: true, status: "READ" } }).statuses[0]!.status, "lida");
    const c = parseEvolutionWebhook({ event: "connection.update", instance: "i1", data: { instance: "i1", state: "open", wuid: "555133330000:12@s.whatsapp.net", profileName: "Clínica" } });
    assert.deepEqual(c.connection, { state: "open", number: "555133330000", profileName: "Clínica" });
  });

  it("segredo do webhook por instância: confere e recusa o de outra instância", () => {
    const s = evolutionWebhookSecret("segredo-servidor", "inst-a");
    assert.equal(verifyEvolutionWebhook(s, "segredo-servidor", "inst-a"), true);
    assert.equal(verifyEvolutionWebhook(s, "segredo-servidor", "inst-b"), false);
    assert.equal(verifyEvolutionWebhook(null, "segredo-servidor", "inst-a"), false);
  });

  it("envia texto e mídia no formato da v2 e baixa arquivo em base64", async () => {
    const calls: Parameters<typeof fakeFetch>[1] = [];
    const fetchFn = fakeFetch({ "/message/sendText/": { key: { id: "OUT-T" } }, "/message/sendMedia/": { key: { id: "OUT-M" } }, "/chat/getBase64FromMediaMessage/": { base64: Buffer.from("%PDF-1.4").toString("base64"), mimetype: "application/pdf", fileName: "a.pdf" } }, calls);
    const ad = getAdapter("whatsapp", "real", { kind: "evolution_qr", evolutionUrl: "https://evo.test/", evolutionApiKey: "k", instance: "inst a" }, fetchFn);
    assert.equal((await ad.send({ to: "5551999990000", text: "Olá" })).externalMessageId, "OUT-T");
    assert.equal(calls[0]!.url, "https://evo.test/message/sendText/inst%20a");
    assert.equal(calls[0]!.init.headers.apikey, "k");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { number: "5551999990000", text: "Olá" });
    await ad.send({ to: "5551999990000", text: "Segue", media: { kind: "image", mime: "image/png", fileName: "x.png", bytes: new Uint8Array([1, 2, 3]) } });
    const body = JSON.parse(String(calls[1]!.init.body));
    assert.equal(body.mediatype, "image");
    assert.equal(body.caption, "Segue");
    assert.equal(body.media, Buffer.from([1, 2, 3]).toString("base64"));
    const file = await ad.downloadMedia!({ provider: "evolution", instance: "inst a", messageId: "M1" }, 1000);
    assert.equal(Buffer.from(file.bytes).toString(), "%PDF-1.4");
    await assert.rejects(ad.downloadMedia!({ provider: "evolution", instance: "inst a", messageId: "M1" }, 3), /maior que o limite/);
  });

  it("QR code e código de pareamento", async () => {
    const calls: Parameters<typeof fakeFetch>[1] = [];
    const qr = await connectEvolutionInstance({ baseUrl: "https://evo.test", apiKey: "k", fetchFn: fakeFetch({ "/instance/connect/": { pairingCode: "ABCD1234", code: "2@x", base64: "data:image/png;base64,AAA", count: 1 } }, calls) }, "i1", "5551999990000");
    assert.equal(qr.qr?.pairingCode, "ABCD1234");
    assert.match(calls[0]!.url, /\/instance\/connect\/i1\?number=5551999990000$/);
    const open = await connectEvolutionInstance({ baseUrl: "https://evo.test", apiKey: "k", fetchFn: fakeFetch({ "/instance/connect/": { instance: { instanceName: "i1", state: "open" } } }) }, "i1");
    assert.equal(open.state, "open");
  });

  it("chave recusada não é reenviada (erro definitivo)", async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" });
    const ad = createEvolutionAdapter({ baseUrl: "https://evo.test", apiKey: "errada", fetchFn }, "i1");
    await assert.rejects(ad.send({ to: "5551999990000", text: "x" }), (e: Error & { retryable?: boolean }) => e.retryable === false && /recusou a chave/.test(e.message));
  });
});

describe("Telegram e Instagram por clínica", () => {
  it("Telegram: confere o token e registra o webhook com o segredo DO bot", async () => {
    const calls: Parameters<typeof fakeFetch>[1] = [];
    const fetchFn = fakeFetch({ "/getMe": { ok: true, result: { username: "ClinicaBot", first_name: "Clínica" } }, "/setWebhook": { ok: true, result: true } }, calls);
    const r = await connectTelegramBot({ botToken: "123:abc", telegramBase: "https://tg.test" }, "https://tropi.app", "srv", fetchFn);
    assert.equal(r.username, "ClinicaBot");
    const hook = JSON.parse(String(calls[1]!.init.body));
    assert.equal(hook.url, "https://tropi.app/api/webhooks/telegram?conta=ClinicaBot");
    assert.equal(hook.secret_token, telegramWebhookSecret("srv", "ClinicaBot"));
    assert.deepEqual(hook.allowed_updates, ["message", "edited_message"]);
  });

  it("Instagram com login do Instagram usa graph.instagram.com e envia anexo por link", async () => {
    const calls: Parameters<typeof fakeFetch>[1] = [];
    const fetchFn = fakeFetch({ "/me?fields=user_id": { user_id: "1784", username: "clinica" }, "subscribed_apps": { success: true }, "/messages": { message_id: "mid.1" } }, calls);
    const r = await connectInstagram({ kind: "instagram_login", accessToken: "IGT", instagramBase: "https://ig.test" }, fetchFn);
    assert.equal(r.accountId, "1784");
    const ad = getAdapter("instagram", "real", { kind: "instagram_login", accessToken: "IGT", accountId: "1784", instagramBase: "https://ig.test" }, fetchFn);
    await ad.send({ to: "IGSID", text: "", media: { kind: "image", mime: "image/png", fileName: "a.png", bytes: new Uint8Array([1]), publicUrl: "https://tropi.app/api/midia/tok" } });
    const last = calls.at(-1)!;
    assert.match(last.url, /^https:\/\/ig\.test\/v23\.0\/1784\/messages$/);
    assert.equal(JSON.parse(String(last.init.body)).message.attachment.payload.url, "https://tropi.app/api/midia/tok");
  });
});

describe("Evolution: destinatário", () => {
  it("completa o DDI 55 em número brasileiro sem DDI e mantém LID", async () => {
    const { evolutionRecipient } = await import("./index");
    assert.equal(evolutionRecipient("(51) 99999-0000"), "5551999990000");
    assert.equal(evolutionRecipient("5551999990000"), "5551999990000");
    assert.equal(evolutionRecipient("123@lid"), "123@lid");
  });
});

/** Resposta de erro no formato da Evolution v2.3.7 (src/main.ts): { status, error, response: { message } } */
function evoError(status: number, message: unknown[]): FetchLike {
  return async () => ({ ok: false, status, json: async () => ({ status, error: "Bad Request", response: { message } }), text: async () => "" });
}

describe("Evolution: divergências encontradas no código-fonte v2.3.7", () => {
  it("número sem WhatsApp vira aviso claro e definitivo (antes: 'Evolution: [object Object]')", async () => {
    const ad = createEvolutionAdapter({ baseUrl: "https://evo.test", apiKey: "k", fetchFn: evoError(400, [{ jid: "5551999990000@s.whatsapp.net", exists: false, number: "5551999990000" }]) }, "i1");
    await assert.rejects(ad.send({ to: "5551999990000", text: "Olá" }), (e: Error & { retryable?: boolean }) => e.retryable === false && /não tem WhatsApp/.test(e.message));
  });

  it("falha ao baixar arquivo: tenta de novo (rede do WhatsApp), menos quando a mensagem não existe", async () => {
    const flaky = createEvolutionAdapter({ baseUrl: "https://evo.test", apiKey: "k", fetchFn: evoError(400, ["Error: read ECONNRESET"]) }, "i1");
    await assert.rejects(flaky.downloadMedia!({ provider: "evolution", instance: "i1", messageId: "M1" }, 1000), (e: Error & { retryable?: boolean }) => e.retryable === true);
    const gone = createEvolutionAdapter({ baseUrl: "https://evo.test", apiKey: "k", fetchFn: evoError(400, ["Message not found"]) }, "i1");
    await assert.rejects(gone.downloadMedia!({ provider: "evolution", instance: "i1", messageId: "M1" }, 1000), (e: Error & { retryable?: boolean }) => e.retryable === false);
  });

  it("API oficial via Evolution: baixa o arquivo pelo ID da Meta e manda nota de voz por sendMedia", async () => {
    const calls: Parameters<typeof fakeFetch>[1] = [];
    const fetchFn = fakeFetch({ "/chat/getBase64FromMediaMessage/": { base64: Buffer.from("OggS").toString("base64"), mimetype: "audio/ogg" }, "/message/sendMedia/": { key: { id: "wamid.X" } } }, calls);
    const ad = getAdapter("whatsapp", "real", { kind: "evolution_cloud", evolutionUrl: "https://evo.test", evolutionApiKey: "k", instance: "c1" }, fetchFn);
    await ad.downloadMedia!({ provider: "evolution", instance: "c1", messageId: "wamid.A", cloud: { type: "audioMessage", mediaId: "998877", mime: "audio/ogg" } }, 1000);
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { message: { key: { id: "wamid.A" }, messageType: "audioMessage", message: { audioMessage: { id: "998877", mime_type: "audio/ogg" } } } });
    await ad.send({ to: "5551999990000", text: "", media: { kind: "audio", mime: "audio/ogg", fileName: "voz.ogg", bytes: new Uint8Array([1]) } });
    assert.match(calls[1]!.url, /\/message\/sendMedia\/c1$/);
    assert.equal(JSON.parse(String(calls[1]!.init.body)).mediatype, "audio");
  });

  it("documento sem nome ganha um nome (a Evolution quebra sem fileName em base64)", async () => {
    const calls: Parameters<typeof fakeFetch>[1] = [];
    const ad = createEvolutionAdapter({ baseUrl: "https://evo.test", apiKey: "k", fetchFn: fakeFetch({ "/message/sendMedia/": { key: { id: "D1" } } }, calls) }, "i1");
    await ad.send({ to: "5551999990000", text: "", media: { kind: "document", mime: "application/pdf", fileName: "", bytes: new Uint8Array([1]) } });
    assert.equal(JSON.parse(String(calls[0]!.init.body)).fileName, "documento.pdf");
  });

  it("status sem fromMe confiável (API oficial) continua sendo lido; cópia de outro aparelho é desembrulhada", () => {
    const st = parseEvolutionWebhook({ event: "messages.update", instance: "c1", data: { keyId: "wamid.Z", fromMe: false, status: "READ" } });
    assert.equal(st.statuses[0]?.status, "lida");
    const dev = parseEvolutionWebhook({ event: "messages.upsert", instance: "i1", data: { key: { remoteJid: "5551999990000@s.whatsapp.net", fromMe: true, id: "D2" }, message: { deviceSentMessage: { destinationJid: "5551999990000@s.whatsapp.net", message: { conversation: "Confirmado" } } }, messageTimestamp: 1 } });
    assert.equal(dev.sentFromPhone[0]?.text, "Confirmado");
  });
});
