/**
 * Canais da Meta: WhatsApp Cloud API, Messenger e Instagram.
 *
 * O que já está pronto para uso real:
 *  - leitura dos webhooks nos formatos oficiais (mensagens e status)
 *  - verificação da assinatura X-Hub-Signature-256 (HMAC SHA-256 com o App Secret)
 *  - resposta ao desafio de verificação do webhook (hub.challenge)
 *  - envio de texto e de modelo aprovado
 *
 * ATENÇÃO: o envio foi escrito conforme a documentação pública da Graph API,
 * mas ainda NÃO foi testado contra a API real (precisa de conta Meta Business
 * verificada). Antes de ligar em produção, valide com o número de teste da Meta.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { attachmentLabel, type AttachmentKind } from "@ecosaude/core/crm";
import { fetchBytes, toBlob } from "./media";
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelCredentials,
  type FetchLike,
  type InboundAttachment,
  type InboundMessage,
  type MediaRef,
  type OutboundMessage,
  type StatusUpdate,
  type WebhookResult,
} from "./types";

const DEFAULT_GRAPH_VERSION = "v23.0";

/* ------------------------------- Segurança ---------------------------------- */

/**
 * Confere se o webhook veio mesmo da Meta.
 * A Meta assina o corpo BRUTO (exatamente os bytes recebidos) com o App Secret.
 * Compare antes de fazer JSON.parse: um espaço a mais muda a assinatura.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  // timingSafeEqual: comparação em tempo constante (evita ataque por medição de tempo)
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verificação do webhook (GET) ao cadastrar a URL no painel da Meta.
 * Retorna o "challenge" para responder com status 200, ou null para responder 403.
 */
export function verifyMetaSubscription(params: URLSearchParams, verifyToken: string): string | null {
  const ok = params.get("hub.mode") === "subscribe" && !!verifyToken && params.get("hub.verify_token") === verifyToken;
  return ok ? params.get("hub.challenge") : null;
}

/* ------------------------------- Leitura ------------------------------------ */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

/** Mensagens que não são texto viram uma descrição legível para a equipe. */
const MEDIA_LABEL: Record<string, string> = {
  image: "[imagem]",
  audio: "[áudio]",
  video: "[vídeo]",
  document: "[documento]",
  sticker: "[figurinha]",
  location: "[localização]",
  contacts: "[contato]",
};

/** Tipos de mensagem do WhatsApp que trazem arquivo */
const WA_KIND: Record<string, AttachmentKind> = { image: "image", sticker: "image", audio: "audio", video: "video", document: "document" };

/** O simulador usa "sim:<chave>" no lugar do ID da Meta (o arquivo já está guardado) */
const waRef = (id: string): MediaRef => (id.startsWith("sim:") ? { provider: "simulado", key: id.slice(4) } : { provider: "whatsapp", mediaId: id });

/** Messenger/Instagram: tipo do anexo -> tipo do CRM */
const MSG_KIND: Record<string, AttachmentKind> = { image: "image", audio: "audio", video: "video", file: "document" };

const WHATSAPP_STATUS: Record<string, StatusUpdate["status"]> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
};

/** Webhook da WhatsApp Cloud API (object = "whatsapp_business_account"). */
export function parseWhatsAppWebhook(body: unknown): WebhookResult {
  const result: WebhookResult = { messages: [], statuses: [] };
  const root = obj(body);
  if (root.object !== "whatsapp_business_account") return result;

  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      const accountId = str(obj(value.metadata).phone_number_id) ?? null;
      const names = new Map(arr(value.contacts).map((c) => [str(obj(c).wa_id), str(obj(obj(c).profile).name)]));

      for (const m of arr(value.messages)) {
        const msg = obj(m);
        const type = str(msg.type) ?? "text";
        const from = str(msg.from);
        const id = str(msg.id);
        if (!from || !id) continue;
        let text = MEDIA_LABEL[type] ?? `[${type}]`;
        // Anexo: o webhook traz só o ID da mídia (o arquivo é baixado depois, com o token)
        const attachments: InboundAttachment[] = [];
        const kind = WA_KIND[type];
        if (kind) {
          const media = obj(msg[type]);
          const mediaId = str(media.id);
          if (mediaId) {
            const fileName = str(media.filename);
            attachments.push({ kind, ref: waRef(mediaId), mime: str(media.mime_type), fileName });
            text = str(media.caption) ?? attachmentLabel(kind, fileName);
          }
        }
        if (type === "text") text = str(obj(msg.text).body) ?? "";
        if (type === "button") text = str(obj(msg.button).text) ?? text;
        if (type === "interactive") {
          const inter = obj(msg.interactive);
          text = str(obj(inter.button_reply).title) ?? str(obj(inter.list_reply).title) ?? text;
        }
        result.messages.push({
          channel: "whatsapp",
          accountId,
          externalMessageId: id,
          from: { externalId: from, phone: from, name: names.get(from) },
          text,
          receivedAt: new Date(Number(str(msg.timestamp) ?? Date.now() / 1000) * 1000),
          ...(attachments.length ? { attachments } : {}),
        });
      }

      for (const s of arr(value.statuses)) {
        const st = obj(s);
        const status = WHATSAPP_STATUS[str(st.status) ?? ""];
        const id = str(st.id);
        if (!status || !id) continue;
        result.statuses.push({
          channel: "whatsapp",
          externalMessageId: id,
          status,
          error: str(obj(arr(st.errors)[0]).title),
          at: new Date(Number(str(st.timestamp) ?? Date.now() / 1000) * 1000),
        });
      }
    }
  }
  return result;
}

/**
 * Webhook do Messenger (object = "page") e do Instagram (object = "instagram").
 * Os dois usam o mesmo formato "messaging".
 */
export function parseMessagingWebhook(body: unknown, channel: "facebook" | "instagram"): WebhookResult {
  const result: WebhookResult = { messages: [], statuses: [] };
  const root = obj(body);
  const expected = channel === "facebook" ? "page" : "instagram";
  if (root.object !== expected) return result;

  for (const e of arr(root.entry)) {
    const entry = obj(e);
    const accountId = str(entry.id) ?? null;
    for (const ev of arr(entry.messaging)) {
      const event = obj(ev);
      const sender = str(obj(event.sender).id);
      const message = obj(event.message);
      const at = new Date(Number(str(event.timestamp) ?? Date.now()));

      // Mensagens enviadas pela própria página voltam como "echo": ignorar
      if (sender && str(message.mid) && message.is_echo !== true) {
        const raw = arr(message.attachments);
        // Anexos com link temporário (payload.url). Localização e similares não viram arquivo.
        const attachments: InboundAttachment[] = [];
        for (const a of raw) {
          const kind = MSG_KIND[str(obj(a).type) ?? ""];
          const url = str(obj(obj(a).payload).url);
          if (kind && url) attachments.push({ kind, ref: url.startsWith("sim://") ? { provider: "simulado", key: url.slice(6) } : { provider: "url", url } });
        }
        const text = str(message.text) ?? (attachments[0] ? attachmentLabel(attachments[0].kind) : raw.length ? (MEDIA_LABEL[str(obj(raw[0]).type) ?? ""] ?? "[anexo]") : "");
        result.messages.push({
          channel,
          accountId,
          externalMessageId: str(message.mid)!,
          from: { externalId: sender },
          text,
          receivedAt: at,
          ...(attachments.length ? { attachments } : {}),
        });
      }

      for (const mid of arr(obj(event.delivery).mids)) {
        const id = str(mid);
        if (id) result.statuses.push({ channel, externalMessageId: id, status: "entregue", at });
      }
    }
  }
  return result;
}

/* -------------------------------- Envio ------------------------------------- */

async function graphPost(fetchFn: FetchLike, url: string, token: string, payload: unknown): Promise<Json> {
  const multipart = payload instanceof FormData;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, {
      method: "POST",
      // Multipart: o fetch define o Content-Type com o "boundary" sozinho
      headers: multipart ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: multipart ? payload : JSON.stringify(payload),
    });
  } catch (error) {
    throw new ChannelError(`Falha de rede ao falar com a Meta: ${(error as Error).message}`, true);
  }
  const data = obj(await res.json().catch(() => ({})));
  if (!res.ok) {
    const message = str(obj(data.error).message) ?? `HTTP ${res.status}`;
    // 429 e 5xx: vale tentar de novo depois; 4xx: erro de dados/permissão
    throw new ChannelError(`Meta recusou o envio: ${message}`, res.status === 429 || res.status >= 500);
  }
  return data;
}

function requireCreds(creds: ChannelCredentials, keys: (keyof ChannelCredentials)[], channel: string) {
  const missing = keys.filter((k) => !creds[k]);
  if (missing.length) throw new ChannelError(`Credenciais ausentes para ${channel}: ${missing.join(", ")}`, false);
}

export function createWhatsAppAdapter(creds: ChannelCredentials, fetchFn: FetchLike = fetch as unknown as FetchLike): ChannelAdapter {
  return {
    channel: "whatsapp",
    mode: "real",
    parseWebhook: parseWhatsAppWebhook,
    async send(message: OutboundMessage) {
      requireCreds(creds, ["accessToken", "phoneNumberId"], "WhatsApp");
      const url = `https://graph.facebook.com/${creds.graphVersion ?? DEFAULT_GRAPH_VERSION}/${creds.phoneNumberId}/messages`;
      const base = `https://graph.facebook.com/${creds.graphVersion ?? DEFAULT_GRAPH_VERSION}/${creds.phoneNumberId}`;
      if (message.media) {
        // 1) sobe o arquivo para a Meta (devolve um ID); 2) manda a mensagem com o ID
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("type", message.media.mime);
        form.append("file", toBlob(message.media.bytes, message.media.mime), message.media.fileName);
        const up = await graphPost(fetchFn, `${base}/media`, creds.accessToken!, form);
        const mediaId = str(up.id);
        if (!mediaId) throw new ChannelError("WhatsApp não devolveu o ID do arquivo enviado.", true);
        const k = message.media.kind;
        const caption = message.text.trim();
        const body: Json = { id: mediaId };
        // Áudio não tem legenda no WhatsApp; documento leva o nome do arquivo
        if (caption && k !== "audio") body.caption = caption;
        if (k === "document") body.filename = message.media.fileName;
        const sent = await graphPost(fetchFn, `${base}/messages`, creds.accessToken!, { messaging_product: "whatsapp", recipient_type: "individual", to: message.to, type: k, [k]: body });
        const id = str(obj(arr(sent.messages)[0]).id);
        if (!id) throw new ChannelError("WhatsApp não devolveu o ID da mensagem.", true);
        if (caption && k === "audio") await graphPost(fetchFn, `${base}/messages`, creds.accessToken!, { messaging_product: "whatsapp", to: message.to, type: "text", text: { body: caption } });
        return { externalMessageId: id };
      }
      const payload = message.template
        ? {
            messaging_product: "whatsapp",
            to: message.to,
            type: "template",
            template: {
              name: message.template.name,
              language: { code: message.template.language },
              components: [{ type: "body", parameters: message.template.variables.map((text) => ({ type: "text", text })) }],
            },
          }
        : { messaging_product: "whatsapp", recipient_type: "individual", to: message.to, type: "text", text: { preview_url: false, body: message.text } };
      const data = await graphPost(fetchFn, url, creds.accessToken!, payload);
      const id = str(obj(arr(data.messages)[0]).id);
      if (!id) throw new ChannelError("WhatsApp não devolveu o ID da mensagem.", true);
      return { externalMessageId: id };
    },
    /** Baixa a mídia recebida: pega o link na Graph API (dura poucos minutos) e baixa com o token */
    async downloadMedia(ref, maxBytes) {
      if (ref.provider !== "whatsapp") throw new ChannelError("Referência de arquivo de outro canal.", false);
      requireCreds(creds, ["accessToken"], "WhatsApp");
      const info = await graphGet(fetchFn, `https://graph.facebook.com/${creds.graphVersion ?? DEFAULT_GRAPH_VERSION}/${ref.mediaId}`, creds.accessToken!);
      const url = str(info.url);
      if (!url) throw new ChannelError("WhatsApp não devolveu o link do arquivo.", true);
      if (Number(info.file_size ?? 0) > maxBytes) throw new ChannelError("Arquivo maior que o limite.", false);
      const file = await fetchBytes(fetchFn, url, { Authorization: `Bearer ${creds.accessToken}` }, maxBytes);
      return { bytes: file.bytes, mime: str(info.mime_type) ?? file.mime };
    },
  };
}

async function graphGet(fetchFn: FetchLike, url: string, token: string): Promise<Json> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new ChannelError(`Falha de rede: ${(error as Error).message}`, true);
  }
  const data = obj(await res.json().catch(() => ({})));
  if (!res.ok) throw new ChannelError(`Meta recusou: ${str(obj(data.error).message) ?? `HTTP ${res.status}`}`, res.status === 429 || res.status >= 500);
  return data;
}

/** Messenger e Instagram (Messenger Platform). */
export function createMessagingAdapter(channel: "facebook" | "instagram", creds: ChannelCredentials, fetchFn: FetchLike = fetch as unknown as FetchLike): ChannelAdapter {
  return {
    channel,
    mode: "real",
    parseWebhook: (body) => parseMessagingWebhook(body, channel),
    async send(message: OutboundMessage) {
      requireCreds(creds, ["accessToken", "accountId"], channel === "facebook" ? "Messenger" : "Instagram");
      const base = `https://graph.facebook.com/${creds.graphVersion ?? DEFAULT_GRAPH_VERSION}/${creds.accountId}`;
      const url = `${base}/messages`;
      if (message.media) {
        // 1) sobe o arquivo (Attachment Upload API); 2) manda a mensagem com o attachment_id
        const type = message.media.kind === "document" ? "file" : message.media.kind;
        const form = new FormData();
        form.append("message", JSON.stringify({ attachment: { type, payload: { is_reusable: false } } }));
        form.append("filedata", toBlob(message.media.bytes, message.media.mime), message.media.fileName);
        const up = await graphPost(fetchFn, `${base}/message_attachments`, creds.accessToken!, form);
        const attachmentId = str(up.attachment_id);
        if (!attachmentId) throw new ChannelError("A Meta não devolveu o ID do arquivo enviado.", true);
        const sent = await graphPost(fetchFn, url, creds.accessToken!, {
          recipient: { id: message.to },
          messaging_type: "RESPONSE",
          message: { attachment: { type, payload: { attachment_id: attachmentId } } },
        });
        const id = str(sent.message_id);
        if (!id) throw new ChannelError("A Meta não devolveu o ID da mensagem.", true);
        // Sem legenda nesses canais: o texto vai numa segunda mensagem
        if (message.text.trim()) await graphPost(fetchFn, url, creds.accessToken!, { recipient: { id: message.to }, messaging_type: "RESPONSE", message: { text: message.text } });
        return { externalMessageId: id };
      }
      const data = await graphPost(fetchFn, url, creds.accessToken!, {
        recipient: { id: message.to },
        // RESPONSE = resposta dentro da janela de 24h. Fora dela a Meta exige tags específicas.
        messaging_type: "RESPONSE",
        message: { text: message.text },
      });
      const id = str(data.message_id);
      if (!id) throw new ChannelError("A Meta não devolveu o ID da mensagem.", true);
      return { externalMessageId: id };
    },
    /** O webhook traz um link temporário: baixa direto (sem token) */
    async downloadMedia(ref, maxBytes) {
      if (ref.provider !== "url") throw new ChannelError("Referência de arquivo de outro canal.", false);
      if (!/^https:\/\//.test(ref.url)) throw new ChannelError("Link de arquivo inválido.", false);
      const file = await fetchBytes(fetchFn, ref.url, {}, maxBytes);
      return { bytes: file.bytes, mime: file.mime };
    },
  };
}

/* ------------------------ Payloads de exemplo (simulador) ------------------- */

/**
 * Monta um webhook no FORMATO OFICIAL do provedor.
 * O simulador usa isto para que a mensagem simulada passe pelo MESMO
 * parser que vai receber as mensagens reais: se funciona simulado, a leitura
 * do formato real já está validada.
 */
export interface SampleMedia {
  kind: AttachmentKind;
  /** Chave do arquivo que o simulador já guardou */
  key: string;
  mime: string;
  fileName: string;
}

export function sampleWhatsAppPayload(p: { accountId: string; from: string; name?: string; text: string; id: string; at: Date; media?: SampleMedia }) {
  // Com anexo: mesmo formato da Meta (type = image/audio/document...), com legenda quando houver
  const m = p.media;
  const message = m
    ? {
        from: p.from,
        id: p.id,
        timestamp: String(Math.floor(p.at.getTime() / 1000)),
        type: m.kind,
        [m.kind]: { id: `sim:${m.key}`, mime_type: m.mime, ...(m.kind === "document" ? { filename: m.fileName } : {}), ...(p.text && m.kind !== "audio" ? { caption: p.text } : {}) },
      }
    : { from: p.from, id: p.id, timestamp: String(Math.floor(p.at.getTime() / 1000)), type: "text", text: { body: p.text } };
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: p.accountId, phone_number_id: p.accountId },
              contacts: [{ profile: { name: p.name ?? p.from }, wa_id: p.from }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

export function sampleMessagingPayload(channel: "facebook" | "instagram", p: { accountId: string; from: string; text: string; id: string; at: Date; media?: SampleMedia }) {
  const m = p.media;
  const message = m
    ? { mid: p.id, ...(p.text ? { text: p.text } : {}), attachments: [{ type: m.kind === "document" ? "file" : m.kind, payload: { url: `sim://${m.key}` } }] }
    : { mid: p.id, text: p.text };
  return {
    object: channel === "facebook" ? "page" : "instagram",
    entry: [
      {
        id: p.accountId,
        time: p.at.getTime(),
        messaging: [{ sender: { id: p.from }, recipient: { id: p.accountId }, timestamp: p.at.getTime(), message }],
      },
    ],
  };
}
