/**
 * Telegram (Bot API).
 *
 * Pronto para uso real: leitura do Update, verificação do cabeçalho secreto
 * e envio via sendMessage. Para ligar: criar o bot no @BotFather, guardar o
 * token em TELEGRAM_BOT_TOKEN e registrar o webhook com setWebhook
 * (passando secret_token = TELEGRAM_WEBHOOK_SECRET).
 *
 * Ainda NÃO testado contra a API real.
 */
import { timingSafeEqual } from "node:crypto";
import { attachmentLabel, type AttachmentKind } from "@ecosaude/core/crm";
import { fetchBytes, toBlob } from "./media";
import { ChannelError, type ChannelAdapter, type ChannelCredentials, type FetchLike, type InboundAttachment, type MediaRef, type WebhookResult } from "./types";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

/** O Telegram envia o segredo combinado no cabeçalho X-Telegram-Bot-Api-Secret-Token. */
export function verifyTelegramSecret(headerValue: string | null, secret: string): boolean {
  if (!headerValue || !secret) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Converte um Update do Telegram. `accountId` = nome do bot (vem da URL do webhook). */
export function parseTelegramUpdate(body: unknown, accountId: string | null = null): WebhookResult {
  const result: WebhookResult = { messages: [], statuses: [] };
  const message = obj(obj(body).message);
  const chatId = str(obj(message.chat).id);
  const messageId = str(message.message_id);
  if (!chatId || !messageId) return result;

  const from = obj(message.from);
  const name = [str(from.first_name), str(from.last_name)].filter(Boolean).join(" ") || str(from.username);
  // Anexos: o Update traz o file_id (o arquivo é baixado depois, com o token do bot)
  const attachments: InboundAttachment[] = [];
  const ref = (id: string): MediaRef => (id.startsWith("sim:") ? { provider: "simulado", key: id.slice(4) } : { provider: "telegram", fileId: id });
  const add = (kind: AttachmentKind, f: Json) => {
    const id = str(f.file_id);
    if (id) attachments.push({ kind, ref: ref(id), mime: str(f.mime_type), fileName: str(f.file_name), sizeBytes: Number(f.file_size) || undefined });
  };
  const photos = Array.isArray(message.photo) ? (message.photo as Json[]) : [];
  if (photos.length) add("image", photos[photos.length - 1]!); // o último é o maior tamanho
  if (message.voice) add("audio", obj(message.voice));
  if (message.audio) add("audio", obj(message.audio));
  if (message.video) add("video", obj(message.video));
  if (message.document) add("document", obj(message.document));
  const text = str(message.text) ?? str(message.caption) ?? (attachments[0] ? attachmentLabel(attachments[0].kind, attachments[0].fileName) : "[mensagem]");

  result.messages.push({
    channel: "telegram",
    accountId,
    // message_id só é único dentro do chat: combinamos os dois
    externalMessageId: `${chatId}:${messageId}`,
    from: { externalId: chatId, name },
    text,
    receivedAt: new Date(Number(str(message.date) ?? Date.now() / 1000) * 1000),
    ...(attachments.length ? { attachments } : {}),
  });
  return result;
}

export function createTelegramAdapter(creds: ChannelCredentials, fetchFn: FetchLike = fetch as unknown as FetchLike): ChannelAdapter {
  return {
    channel: "telegram",
    mode: "real",
    parseWebhook: (body) => parseTelegramUpdate(body, creds.accountId ?? null),
    async send(message) {
      if (!creds.botToken) throw new ChannelError("Credenciais ausentes para Telegram: botToken", false);
      let res: Awaited<ReturnType<FetchLike>>;
      if (message.media) {
        // Um método por tipo; nota de voz (OGG) vai como voz, o resto de áudio como música
        const m = message.media;
        const [method, field] =
          m.kind === "image"
            ? ["sendPhoto", "photo"]
            : m.kind === "video"
              ? ["sendVideo", "video"]
              : m.kind === "audio"
                ? m.mime === "audio/ogg"
                  ? ["sendVoice", "voice"]
                  : ["sendAudio", "audio"]
                : ["sendDocument", "document"];
        const form = new FormData();
        form.append("chat_id", message.to);
        if (message.text.trim()) form.append("caption", message.text.slice(0, 1024));
        form.append(field, toBlob(m.bytes, m.mime), m.fileName);
        res = await fetchFn(`https://api.telegram.org/bot${creds.botToken}/${method}`, { method: "POST", headers: {}, body: form });
      } else {
        res = await fetchFn(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: message.to, text: message.text }),
        });
      }
      const data = obj(await res.json().catch(() => ({})));
      if (!res.ok || data.ok !== true) {
        throw new ChannelError(`Telegram recusou o envio: ${str(data.description) ?? `HTTP ${res.status}`}`, res.status === 429 || res.status >= 500);
      }
      const id = str(obj(data.result).message_id);
      return { externalMessageId: `${message.to}:${id ?? Date.now()}` };
    },
    /** getFile devolve o caminho; o download usa o token do bot (limite do Telegram: 20 MB) */
    async downloadMedia(ref, maxBytes) {
      if (ref.provider !== "telegram") throw new ChannelError("Referência de arquivo de outro canal.", false);
      if (!creds.botToken) throw new ChannelError("Credenciais ausentes para Telegram: botToken", false);
      const res = await fetchFn(`https://api.telegram.org/bot${creds.botToken}/getFile?file_id=${encodeURIComponent(ref.fileId)}`, { method: "GET", headers: {} });
      const data = obj(await res.json().catch(() => ({})));
      const path = str(obj(data.result).file_path);
      if (!res.ok || !path) throw new ChannelError(`Telegram não achou o arquivo: ${str(data.description) ?? `HTTP ${res.status}`}`, res.status === 429 || res.status >= 500);
      if (Number(obj(data.result).file_size ?? 0) > maxBytes) throw new ChannelError("Arquivo maior que o limite.", false);
      const file = await fetchBytes(fetchFn, `https://api.telegram.org/file/bot${creds.botToken}/${path}`, {}, maxBytes);
      return { bytes: file.bytes, mime: file.mime };
    },
  };
}

/** Update de exemplo no formato oficial (usado pelo simulador e pelos testes). */
export function sampleTelegramUpdate(p: { chatId: string; name?: string; text: string; messageId: number; at: Date; media?: { kind: AttachmentKind; key: string; mime: string; fileName: string } }) {
  const [first, ...rest] = (p.name ?? p.chatId).split(" ");
  const m = p.media;
  const file = m ? { file_id: `sim:${m.key}`, file_unique_id: m.key, mime_type: m.mime, file_name: m.fileName } : null;
  const media = !m
    ? { text: p.text }
    : {
        ...(p.text ? { caption: p.text } : {}),
        ...(m.kind === "image" ? { photo: [file] } : m.kind === "audio" ? { voice: file } : m.kind === "video" ? { video: file } : { document: file }),
      };
  return {
    update_id: p.messageId,
    message: {
      message_id: p.messageId,
      from: { id: p.chatId, is_bot: false, first_name: first, last_name: rest.join(" ") || undefined },
      chat: { id: p.chatId, type: "private" },
      date: Math.floor(p.at.getTime() / 1000),
      ...media,
    },
  };
}
