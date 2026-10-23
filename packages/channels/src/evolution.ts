/**
 * WHATSAPP VIA EVOLUTION API (v2)
 *
 * A Evolution é um servidor que a Tropi hospeda à parte (Docker) e que fala com o WhatsApp
 * de duas formas, escolhidas por clínica:
 *
 *  1) WHATSAPP-BAILEYS: o WhatsApp do celular da clínica, pareado por QR code OU por um
 *     código de 8 caracteres ("Conectar com número de telefone"). Funciona como o WhatsApp Web.
 *     ATENÇÃO: não é uma API oficial da Meta. O número pode ser bloqueado se mandar muitas
 *     mensagens para quem não conversou antes. Por isso o Tropi mantém a regra de 24h também aqui.
 *  2) WHATSAPP-BUSINESS: a API oficial (Cloud API) da Meta, com a Evolution no meio. A Meta
 *     chama a Evolution (/webhook/meta), e a Evolution chama o Tropi no mesmo formato do item 1.
 *
 * Formatos conferidos no código-fonte da Evolution API v2.3 (a documentação OpenAPI pública
 * ainda mistura campos da v1, como "textMessage"):
 *  - envio de texto:  POST /message/sendText/{instancia}   { number, text }
 *  - envio de mídia:  POST /message/sendMedia/{instancia}  { number, mediatype, mimetype, caption, media (base64), fileName }
 *  - nota de voz:     POST /message/sendWhatsAppAudio/{instancia} { number, audio (base64) }
 *  - baixar arquivo:  POST /chat/getBase64FromMediaMessage/{instancia} { message: { key: { id } } }
 *  - conectar:        GET  /instance/connect/{instancia}?number=55...  (com number: devolve o código de pareamento)
 *  - webhook:         POST no endereço configurado, corpo { event: "messages.upsert", instance, data, ... }
 *
 * Segurança: a Evolution não assina o webhook. O Tropi configura um cabeçalho secreto por
 * instância (x-tropi-evolution) e confere em tempo constante a cada chamada.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { attachmentLabel, type AttachmentKind } from "@ecosaude/core/crm";
import { ChannelError, type ChannelAdapter, type FetchLike, type InboundAttachment, type InboundMessage, type StatusUpdate, type WebhookResult } from "./types";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

export const EVOLUTION_HEADER = "x-tropi-evolution";

/** Eventos que o Tropi pede para receber (o resto só geraria tráfego) */
export const EVOLUTION_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"] as const;

export interface EvolutionConfig {
  /** Endereço do servidor da Evolution, ex.: https://evolution.suaempresa.com.br */
  baseUrl: string;
  /** Chave global (AUTHENTICATION_API_KEY da Evolution). Fica só no servidor do Tropi. */
  apiKey: string;
  fetchFn?: FetchLike;
}

export type EvolutionState = "open" | "connecting" | "close";

export interface EvolutionQr {
  /** Imagem do QR code (data:image/png;base64,...) */
  base64?: string;
  /** Código de pareamento de 8 caracteres (quando pedido com o número) */
  pairingCode?: string;
}

/* --------------------------------- Rede ------------------------------------- */

async function call(cfg: EvolutionConfig, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
  const fetchFn = cfg.fetchFn ?? (fetch as unknown as FetchLike);
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}${path}`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, {
      method,
      headers: { apikey: cfg.apiKey, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new ChannelError(`Servidor da Evolution fora do ar: ${(error as Error).message}`, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = obj(data);
    // A Evolution devolve { response: { message: [...] } } ou { message } nos erros.
    // A lista pode ter OBJETOS: número sem WhatsApp vem como [{ jid, exists: false, number }]
    // (whatsappNumber em whatsapp.baileys.service.ts, v2.3.7).
    const list = Array.isArray(obj(d.response).message) ? (obj(d.response).message as unknown[]) : Array.isArray(d.message) ? (d.message as unknown[]) : [];
    if (list.some((m) => obj(m).exists === false)) throw new ChannelError("Este número não tem WhatsApp. Confira o telefone do contato.", false);
    const detail = str(d.message) ?? (list.length ? list.map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join("; ") : undefined) ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new ChannelError("A Evolution recusou a chave (EVOLUTION_API_KEY).", false);
    if (res.status === 404) throw new ChannelError(`Instância não encontrada na Evolution: ${detail}`, false);
    // Celular reconectando ("Connection Closed"): não é erro da mensagem, vale tentar de novo
    const reconnecting = /connection closed|not connected|connecting/i.test(detail);
    throw new ChannelError(`Evolution: ${detail}`, reconnecting || res.status === 429 || res.status >= 500);
  }
  return data;
}

const path = (name: string) => encodeURIComponent(name);

/* ------------------------------ Instância ----------------------------------- */

export interface CreateInstanceInput {
  instanceName: string;
  /** "qrcode" = WhatsApp do celular; "cloud" = API oficial da Meta via Evolution */
  type: "qrcode" | "cloud";
  /** QR code: número para gerar o código de pareamento (só dígitos, com 55) */
  number?: string;
  /** Cloud: token permanente da Meta, Phone number ID e WhatsApp Business Account ID */
  cloud?: { token: string; phoneNumberId: string; businessId: string };
  webhookUrl: string;
  webhookSecret: string;
}

/** Cria a instância já com o webhook do Tropi e configurações seguras (ignora grupos, não marca como lida). */
export async function createEvolutionInstance(cfg: EvolutionConfig, input: CreateInstanceInput): Promise<{ qr: EvolutionQr | null }> {
  const body: Json = {
    instanceName: input.instanceName,
    integration: input.type === "cloud" ? "WHATSAPP-BUSINESS" : "WHATSAPP-BAILEYS",
    qrcode: input.type === "qrcode",
    // Grupos não são atendimento de paciente; status do WhatsApp também não
    groupsIgnore: true,
    readMessages: false,
    readStatus: false,
    alwaysOnline: false,
    syncFullHistory: false,
    rejectCall: false,
    webhook: {
      enabled: true,
      url: input.webhookUrl,
      byEvents: false,
      // Arquivos NÃO vão no webhook (passariam do limite de 4,5 MB da Vercel): o Tropi baixa depois
      base64: false,
      headers: { [EVOLUTION_HEADER]: input.webhookSecret },
      events: [...EVOLUTION_EVENTS],
    },
  };
  if (input.type === "qrcode" && input.number) body.number = input.number;
  if (input.type === "cloud") {
    if (!input.cloud) throw new ChannelError("Faltam os dados da API oficial (token, Phone number ID e Business ID).", false);
    body.token = input.cloud.token;
    body.number = input.cloud.phoneNumberId;
    body.businessId = input.cloud.businessId;
  }
  const data = obj(await call(cfg, "POST", "/instance/create", body));
  return { qr: readQr(obj(data.qrcode)) };
}

function readQr(q: Json): EvolutionQr | null {
  const base64 = str(q.base64);
  const pairingCode = str(q.pairingCode);
  return base64 || pairingCode ? { ...(base64 ? { base64 } : {}), ...(pairingCode ? { pairingCode } : {}) } : null;
}

/**
 * Pede um QR code novo (ou o código de pareamento, se vier o número).
 * Já conectada: devolve { state: "open" } sem QR.
 */
export async function connectEvolutionInstance(cfg: EvolutionConfig, instanceName: string, number?: string): Promise<{ state: EvolutionState; qr: EvolutionQr | null }> {
  const q = number ? `?number=${encodeURIComponent(number)}` : "";
  const data = obj(await call(cfg, "GET", `/instance/connect/${path(instanceName)}${q}`));
  const inst = obj(data.instance);
  if (str(inst.state) === "open") return { state: "open", qr: null };
  // A Evolution responde 200 com { error: true, message } quando algo dá errado ao conectar
  if (data.error === true) throw new ChannelError(`Evolution: ${str(data.message) ?? "falha ao conectar"}`, true);
  return { state: "connecting", qr: readQr(data) };
}

export async function evolutionState(cfg: EvolutionConfig, instanceName: string): Promise<EvolutionState> {
  const data = obj(await call(cfg, "GET", `/instance/connectionState/${path(instanceName)}`));
  const s = str(obj(data.instance).state);
  return s === "open" || s === "connecting" ? s : "close";
}

/** Número e nome do perfil conectado (para mostrar na tela). */
export async function evolutionInstanceInfo(cfg: EvolutionConfig, instanceName: string): Promise<{ number?: string; profileName?: string } | null> {
  const data = await call(cfg, "GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`);
  const row = obj(Array.isArray(data) ? data[0] : data);
  if (!Object.keys(row).length) return null;
  const owner = str(row.ownerJid)?.split("@")[0]?.split(":")[0];
  return { number: owner ?? str(row.number), profileName: str(row.profileName) };
}

/** Desconecta o celular (a instância continua, pronta para parear de novo). */
export async function logoutEvolutionInstance(cfg: EvolutionConfig, instanceName: string): Promise<void> {
  await call(cfg, "DELETE", `/instance/logout/${path(instanceName)}`).catch((e) => {
    // Já desconectada: tudo certo
    if (!(e instanceof ChannelError) || e.retryable) throw e;
  });
}

/** Apaga a instância (e as mensagens que a Evolution guardou dela). */
export async function deleteEvolutionInstance(cfg: EvolutionConfig, instanceName: string): Promise<void> {
  await call(cfg, "DELETE", `/instance/delete/${path(instanceName)}`).catch((e) => {
    if (!(e instanceof ChannelError) || e.retryable) throw e;
  });
}

/** Reaponta o webhook (ex.: mudou o domínio do Tropi ou o segredo). */
export async function setEvolutionWebhook(cfg: EvolutionConfig, instanceName: string, url: string, secret: string): Promise<void> {
  await call(cfg, "POST", `/webhook/set/${path(instanceName)}`, {
    webhook: { enabled: true, url, byEvents: false, base64: false, headers: { [EVOLUTION_HEADER]: secret }, events: [...EVOLUTION_EVENTS] },
  });
}

/* ------------------------------- Segurança ---------------------------------- */

/**
 * Segredo do webhook de UMA instância: HMAC(segredo do servidor, nome da instância).
 * Não fica guardado em lugar nenhum: é recalculado para conferir.
 */
export function evolutionWebhookSecret(serverSecret: string, instanceName: string): string {
  if (!serverSecret) throw new Error("EVOLUTION_WEBHOOK_SECRET não definido.");
  return createHmac("sha256", serverSecret).update(`evolution:${instanceName}`).digest("hex");
}

export function verifyEvolutionWebhook(headerValue: string | null, serverSecret: string, instanceName: string): boolean {
  if (!headerValue || !serverSecret || !instanceName) return false;
  const a = Buffer.from(evolutionWebhookSecret(serverSecret, instanceName));
  const b = Buffer.from(headerValue);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* -------------------------------- Leitura ----------------------------------- */

/** Tipos de mensagem do WhatsApp (formato Baileys) que trazem arquivo */
const MEDIA_TYPES: Record<string, AttachmentKind> = {
  imageMessage: "image",
  stickerMessage: "image",
  videoMessage: "video",
  ptvMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
};

const OTHER_LABEL: Record<string, string> = {
  locationMessage: "[localização]",
  liveLocationMessage: "[localização]",
  contactMessage: "[contato]",
  contactsArrayMessage: "[contatos]",
  pollCreationMessage: "[enquete]",
};

/** Mensagens que não são do paciente para a clínica (reação, apagada, edição, sistema) */
// albumMessage: aviso de "álbum" que vem ANTES das fotos (cada foto chega depois, sozinha)
const IGNORED = new Set(["reactionMessage", "protocolMessage", "senderKeyDistributionMessage", "messageContextInfo", "editedMessage", "pollUpdateMessage", "keepInChatMessage", "albumMessage", "speechToText"]);

const STATUS: Record<string, StatusUpdate["status"]> = {
  SERVER_ACK: "enviada",
  SENT: "enviada",
  DELIVERY_ACK: "entregue",
  DELIVERED: "entregue",
  READ: "lida",
  PLAYED: "lida",
  ERROR: "falhou",
  FAILED: "falhou",
};

/**
 * Quem mandou, no formato do Tropi:
 *  - número comum: só os dígitos (5551999990000)
 *  - conta com LID (identificador sem telefone que o WhatsApp vem adotando): "123@lid",
 *    a não ser que a Evolution mande o número junto (remoteJidAlt)
 *  - grupos, status e canais: null (não são atendimento)
 */
export function evolutionSender(key: Json): { externalId: string; phone?: string } | null {
  let jid = str(key.remoteJid) ?? "";
  const alt = str(key.remoteJidAlt) ?? str(key.senderPn);
  if (jid.endsWith("@lid") && alt?.endsWith("@s.whatsapp.net")) jid = alt;
  if (jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return null;
  if (jid.endsWith("@s.whatsapp.net")) {
    const digits = jid.split("@")[0]!.split(":")[0]!.replace(/\D/g, "");
    return digits ? { externalId: digits, phone: digits } : null;
  }
  if (jid.endsWith("@lid")) return { externalId: jid };
  // Cloud API via Evolution manda só o número
  const digits = jid.replace(/\D/g, "");
  return digits.length >= 8 ? { externalId: digits, phone: digits } : null;
}

/** Desembrulha mensagens "efêmeras" e "visualização única" */
function unwrap(message: Json): Json {
  // deviceSentMessage: cópia de mensagem enviada por OUTRO aparelho da mesma conta (o celular)
  for (const k of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage", "deviceSentMessage"]) {
    const inner = obj(obj(message[k]).message);
    if (Object.keys(inner).length) return unwrap({ ...message, ...inner, [k]: undefined });
  }
  return message;
}

export interface EvolutionConnectionEvent {
  /**
   * "refused": a Evolution desistiu depois de QRCODE_LIMIT QR codes sem leitura
   * (connectionUpdate em whatsapp.baileys.service.ts). Não é queda: ninguém conectou.
   */
  state: EvolutionState | "refused";
  /** Número conectado (wuid sem @) */
  number?: string;
  profileName?: string;
  /** Código do motivo da desconexão (401 = saiu pelo celular) */
  reason?: number;
}

/**
 * Estado e aviso para a tela de Canais a partir do connection.update da Evolution.
 * Motivos (statusReason, códigos do Baileys) que a Evolution NÃO reconecta sozinha:
 * 401 saiu pelo celular, 403 número proibido pelo WhatsApp, 402 e 406 sessão recusada.
 * Nos outros (queda de rede, 428, 440, 515...) ela reconecta e só manda "connecting"/"open".
 */
export function evolutionConnectionStatus(c: EvolutionConnectionEvent): { state: "conectado" | "conectando" | "desconectado"; error: string | null } {
  if (c.state === "open") return { state: "conectado", error: null };
  if (c.state === "connecting") return { state: "conectando", error: null };
  if (c.state === "refused") return { state: "desconectado", error: "O QR code (ou o código) expirou sem ser usado. Clique em Conectar e leia de novo." };
  switch (c.reason) {
    case 401:
      return { state: "desconectado", error: "O WhatsApp foi desconectado no celular. Conecte de novo pelo QR code." };
    case 403:
      return { state: "desconectado", error: "O WhatsApp bloqueou este número. Abra o WhatsApp no celular para ver o motivo; para volume, use a API oficial." };
    case 402:
    case 406:
      return { state: "desconectado", error: `O WhatsApp encerrou a sessão (motivo ${c.reason}). Conecte de novo pelo QR code.` };
    default:
      return { state: "desconectado", error: "A conexão com o WhatsApp caiu." };
  }
}

export interface EvolutionWebhook extends WebhookResult {
  instance: string | null;
  event: string | null;
  connection: EvolutionConnectionEvent | null;
  /**
   * Mensagens que a EQUIPE mandou direto pelo celular da clínica (key.fromMe), no mesmo formato
   * das recebidas; aqui `from` é o PACIENTE (a outra ponta da conversa). Entram em Conversas como
   * saída "enviada pelo celular", sem automações e sem mexer na janela de 24h do paciente.
   * As que o próprio Tropi enviou também podem voltar aqui: o app ignora pelo ID externo.
   */
  sentFromPhone: InboundMessage[];
}

/** Lê o webhook da Evolution (os dois tipos de conexão chegam no mesmo formato). */
export function parseEvolutionWebhook(body: unknown): EvolutionWebhook {
  const root = obj(body);
  const instance = str(root.instance) ?? null;
  // A Evolution manda "messages.upsert" (eventos por instância) ou "MESSAGES_UPSERT" (global)
  const event = str(root.event)?.toLowerCase().replace(/_/g, ".") ?? null;
  const out: EvolutionWebhook = { instance, event, connection: null, messages: [], statuses: [], sentFromPhone: [] };
  if (!instance || !event) return out;
  const data = root.data;

  if (event === "messages.upsert") {
    // Normalmente 1 mensagem por chamada; versões antigas mandam { messages: [...] }
    const list = Array.isArray(data) ? data : Array.isArray(obj(data).messages) ? (obj(data).messages as unknown[]) : [data];
    for (const item of list) {
      const m = obj(item);
      const key = obj(m.key);
      // fromMe = enviada pelo celular da clínica: vai para `sentFromPhone` (a outra ponta é o paciente)
      const fromMe = key.fromMe === true;
      const id = str(key.id);
      const who = evolutionSender(key);
      if (!id || !who) continue;
      const message = unwrap(obj(m.message));
      const type = Object.keys(message).find((k) => message[k] && !IGNORED.has(k) && k !== "base64" && k !== "contextInfo" && k !== "mediaUrl");
      if (!type) continue;
      let text = "";
      const attachments: InboundAttachment[] = [];
      if (type === "conversation") text = str(message.conversation) ?? "";
      else if (type === "extendedTextMessage") text = str(obj(message.extendedTextMessage).text) ?? "";
      else if (MEDIA_TYPES[type]) {
        const kind = MEDIA_TYPES[type]!;
        const media = obj(message[type]);
        const fileName = str(media.fileName) ?? str(media.filename);
        const mime = str(media.mimetype) ?? str(media.mime_type);
        const size = Number(str(media.fileLength) ?? str(obj(media.fileLength).low) ?? 0) || undefined;
        // API oficial via Evolution: o arquivo vem com o ID da Meta ({ id, mime_type, sha256 }),
        // sem mediaKey; a Evolution precisa desse ID para baixar (ela não guarda a mensagem).
        const cloudId = !media.mediaKey ? str(media.id) : undefined;
        attachments.push({
          kind,
          ref: { provider: "evolution", instance, messageId: id, ...(cloudId ? { cloud: { type, mediaId: cloudId, ...(mime ? { mime } : {}) } } : {}) },
          ...(mime ? { mime: mime.split(";")[0]!.trim() } : {}),
          ...(fileName ? { fileName } : {}),
          ...(size ? { sizeBytes: size } : {}),
        });
        text = str(media.caption) ?? attachmentLabel(kind, fileName);
      } else text = OTHER_LABEL[type] ?? `[${type.replace(/Message$/, "")}]`;
      if (!text && !attachments.length) continue;
      const ts = Number(str(m.messageTimestamp) ?? 0);
      const msg: InboundMessage = {
        channel: "whatsapp",
        // Na Evolution, a conta da clínica é a INSTÂNCIA (é ela que diz de qual clínica é a mensagem)
        accountId: instance,
        externalMessageId: id,
        // Nas enviadas pelo celular, pushName é o nome da CLÍNICA: não vira nome do paciente
        from: { externalId: who.externalId, ...(who.phone ? { phone: who.phone } : {}), ...(!fromMe && str(m.pushName) ? { name: str(m.pushName) } : {}) },
        text,
        receivedAt: ts ? new Date(ts * 1000) : new Date(),
        ...(attachments.length ? { attachments } : {}),
      };
      (fromMe ? out.sentFromPhone : out.messages).push(msg);
    }
    return out;
  }

  if (event === "messages.update") {
    const list = Array.isArray(data) ? data : [data];
    for (const item of list) {
      const u = obj(item);
      // NÃO filtra por fromMe: na API oficial via Evolution v2.3.7 todo status chega com
      // fromMe=false (whatsapp.business.service.ts compara o JID com o phone_number_id).
      // Quem garante que só mensagens ENVIADAS mudam é o app (applyStatusUpdate: direction = out).
      const id = str(u.keyId) ?? str(obj(u.key).id);
      const status = STATUS[str(u.status)?.toUpperCase() ?? ""];
      if (id && status) out.statuses.push({ channel: "whatsapp", externalMessageId: id, status, at: new Date() });
    }
    return out;
  }

  if (event === "connection.update") {
    const d = obj(data);
    const s = str(d.state);
    const state: EvolutionConnectionEvent["state"] = s === "open" || s === "connecting" || s === "refused" ? s : "close";
    const number = str(d.wuid)?.split("@")[0]?.split(":")[0];
    const reason = Number(d.statusReason);
    out.connection = { state, ...(number ? { number } : {}), ...(str(d.profileName) ? { profileName: str(d.profileName) } : {}), ...(Number.isFinite(reason) && reason ? { reason } : {}) };
    return out;
  }
  return out;
}

/* --------------------------------- Envio ------------------------------------ */

const MEDIATYPE: Record<AttachmentKind, "image" | "video" | "audio" | "document"> = { image: "image", video: "video", audio: "audio", document: "document" };

/**
 * Número/identificador no formato que a Evolution aceita (dígitos com DDI, ou o JID "@lid").
 * Cadastro sem o 55 (ex.: 51999990000): o Tropi atende clínicas brasileiras, completa com 55.
 */
export function evolutionRecipient(to: string): string {
  if (to.includes("@")) return to;
  const d = to.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/** Extensão padrão por tipo, para documento sem nome (a Evolution quebra sem fileName em documento enviado em base64) */
const DEFAULT_NAME: Record<AttachmentKind, string> = { image: "imagem.jpg", video: "video.mp4", audio: "audio.ogg", document: "documento" };

/**
 * `opts.cloud`: a instância é da API oficial (WHATSAPP-BUSINESS). Muda duas coisas:
 *  - nota de voz vai por sendMedia (o sendWhatsAppAudio da Cloud sobe o arquivo como .mp3);
 *  - o arquivo recebido é pedido com o ID da Meta (ver MediaRef).
 */
export function createEvolutionAdapter(cfg: EvolutionConfig, instanceName: string, opts: { cloud?: boolean } = {}): ChannelAdapter {
  const p = path(instanceName);
  return {
    channel: "whatsapp",
    mode: "real",
    parseWebhook: (body) => parseEvolutionWebhook(body),
    async send(message) {
      const number = evolutionRecipient(message.to);
      let data: Json;
      if (message.media) {
        const m = message.media;
        const base64 = Buffer.from(m.bytes).toString("base64");
        if (m.kind === "audio" && m.mime === "audio/ogg" && !opts.cloud) {
          // Nota de voz (OGG/Opus): chega como áudio gravado, não como arquivo
          data = obj(await call(cfg, "POST", `/message/sendWhatsAppAudio/${p}`, { number, audio: base64 }));
          if (message.text.trim()) await call(cfg, "POST", `/message/sendText/${p}`, { number, text: message.text });
        } else {
          data = obj(
            await call(cfg, "POST", `/message/sendMedia/${p}`, {
              number,
              mediatype: MEDIATYPE[m.kind],
              mimetype: m.mime,
              fileName: m.fileName || (m.kind === "document" ? `${DEFAULT_NAME.document}.${m.mime.split("/")[1]?.split(/[;+]/)[0] || "bin"}` : DEFAULT_NAME[m.kind]),
              ...(message.text.trim() && m.kind !== "audio" ? { caption: message.text } : {}),
              media: base64,
            }),
          );
          if (message.text.trim() && m.kind === "audio") await call(cfg, "POST", `/message/sendText/${p}`, { number, text: message.text });
        }
      } else {
        // Sem modelos aprovados no WhatsApp do celular: o texto do modelo vai como mensagem comum
        data = obj(await call(cfg, "POST", `/message/sendText/${p}`, { number, text: message.text }));
      }
      const id = str(obj(data.key).id);
      if (!id) throw new ChannelError("A Evolution não devolveu o ID da mensagem.", true);
      return { externalMessageId: id };
    },
    /** O webhook não traz o arquivo: a Evolution entrega em base64 quando pedimos */
    async downloadMedia(ref, maxBytes) {
      if (ref.provider !== "evolution") throw new ChannelError("Referência de arquivo de outro canal.", false);
      // Baileys: a Evolution acha a mensagem guardada pelo ID (DATABASE_SAVE_DATA_NEW_MESSAGE=true).
      // Cloud: manda o tipo e o ID do arquivo na Meta (a Evolution não procura no banco).
      const body = ref.cloud
        ? { message: { key: { id: ref.messageId }, messageType: ref.cloud.type, message: { [ref.cloud.type]: { id: ref.cloud.mediaId, ...(ref.cloud.mime ? { mime_type: ref.cloud.mime } : {}) } } } }
        : { message: { key: { id: ref.messageId } }, convertToMp4: false };
      let data: Json;
      try {
        data = obj(await call(cfg, "POST", `/chat/getBase64FromMediaMessage/${path(ref.instance)}`, body));
      } catch (e) {
        // A Evolution responde 400 para QUALQUER falha ao baixar (inclusive a rede do WhatsApp
        // oscilando). Só não adianta tentar de novo quando a mensagem não existe ou não é arquivo.
        if (e instanceof ChannelError && !e.retryable && /Evolution: /.test(e.message) && !/not found|not of the media type|does not contain/i.test(e.message)) {
          throw new ChannelError(e.message, true);
        }
        throw e;
      }
      const b64 = str(data.base64);
      if (!b64) throw new ChannelError("A Evolution não devolveu o arquivo (a mensagem pode ter sido apagada).", false);
      // base64 tem ~4/3 do tamanho: confere ANTES de decodificar
      if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) throw new ChannelError("Arquivo maior que o limite.", false);
      const bytes = new Uint8Array(Buffer.from(b64, "base64"));
      if (bytes.byteLength > maxBytes) throw new ChannelError("Arquivo maior que o limite.", false);
      return { bytes, ...(str(data.mimetype) ? { mime: str(data.mimetype)!.split(";")[0]!.trim() } : {}), ...(str(data.fileName) ? { fileName: str(data.fileName) } : {}) };
    },
  };
}

/* ------------------------- Webhook de exemplo (testes) ---------------------- */

export function sampleEvolutionMessage(p: { instance: string; from: string; name?: string; text?: string; id: string; at?: Date; media?: { kind: AttachmentKind; mime: string; fileName?: string }; fromMe?: boolean }) {
  const at = Math.floor((p.at ?? new Date()).getTime() / 1000);
  const type = p.media ? { image: "imageMessage", audio: "audioMessage", video: "videoMessage", document: "documentMessage" }[p.media.kind] : null;
  return {
    event: "messages.upsert",
    instance: p.instance,
    data: {
      key: { remoteJid: p.from.includes("@") ? p.from : `${p.from}@s.whatsapp.net`, fromMe: p.fromMe === true, id: p.id },
      pushName: p.name,
      message: type ? { [type]: { mimetype: p.media!.mime, ...(p.media!.fileName ? { fileName: p.media!.fileName } : {}), ...(p.text ? { caption: p.text } : {}) } } : { conversation: p.text ?? "" },
      messageType: type ?? "conversation",
      messageTimestamp: at,
    },
    destination: "https://tropi.example/api/webhooks/evolution",
    date_time: new Date(at * 1000).toISOString(),
    sender: "555133330000@s.whatsapp.net",
    server_url: "https://evolution.example",
  };
}
