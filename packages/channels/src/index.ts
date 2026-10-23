/**
 * @ecosaude/channels: integração do Tropi com WhatsApp, Telegram, Instagram e Messenger.
 *
 * Cada clínica escolhe, em Ajustes > Canais, COMO cada canal se conecta:
 *  - WhatsApp: celular por QR code/código (Evolution), API oficial via Evolution ou API oficial direto na Meta
 *  - Instagram: login do Instagram ou página do Facebook; Messenger: página; Telegram: bot
 * Nenhuma tela nem regra do Tropi muda com a escolha: só o adaptador usado.
 *
 * Este pacote não depende de Next.js nem de banco: pode ser movido para um
 * microsserviço próprio (ex.: AWS Lambda + fila SQS) sem alterações.
 */
import { randomUUID } from "node:crypto";
import { CHANNEL_WINDOW_HOURS, type Channel, type ChannelMode } from "@ecosaude/core/crm";
import { createMessagingAdapter, createWhatsAppAdapter, parseMessagingWebhook, parseWhatsAppWebhook, sampleMessagingPayload, sampleWhatsAppPayload, type SampleMedia } from "./meta";
import { createEvolutionAdapter } from "./evolution";
import { createTelegramAdapter, parseTelegramUpdate, sampleTelegramUpdate } from "./telegram";
import { ChannelError, type ChannelAdapter, type ChannelCredentials, type FetchLike, type WebhookResult } from "./types";

export * from "./evolution";
export * from "./evolution-capture";
export * from "./media";
export * from "./meta";
export * from "./telegram";
export * from "./types";

/* -------------------------------- Simulação --------------------------------- */

/**
 * Adaptador de simulação: "envia" sem sair do servidor e devolve um ID falso.
 * Lê webhooks no formato oficial de cada provedor (os mesmos parsers do modo real).
 */
export function createSimulatedAdapter(channel: Channel): ChannelAdapter {
  return {
    channel,
    mode: "simulacao",
    parseWebhook: (body) => parseWebhook(channel, body),
    async send() {
      return { externalMessageId: `sim-${randomUUID()}` };
    },
  };
}

/** Lê o webhook de qualquer canal no formato oficial. */
export function parseWebhook(channel: Channel, body: unknown, accountId: string | null = null): WebhookResult {
  switch (channel) {
    case "whatsapp":
      return parseWhatsAppWebhook(body);
    case "facebook":
    case "instagram":
      return parseMessagingWebhook(body, channel);
    case "telegram":
      return parseTelegramUpdate(body, accountId);
  }
}

/** Escolhe o adaptador conforme o modo do canal na clínica. */
export function getAdapter(channel: Channel, mode: ChannelMode, creds: ChannelCredentials = {}, fetchFn?: FetchLike): ChannelAdapter {
  if (mode === "simulacao") return createSimulatedAdapter(channel);
  switch (channel) {
    case "whatsapp":
      // QR code ou Cloud API pela Evolution: o mesmo adaptador (a Evolution padroniza os dois)
      if (creds.kind === "evolution_qr" || creds.kind === "evolution_cloud") {
        if (!creds.evolutionUrl || !creds.evolutionApiKey || !creds.instance) throw new ChannelError("Evolution API não configurada no servidor (EVOLUTION_API_URL e EVOLUTION_API_KEY).", false);
        return createEvolutionAdapter({ baseUrl: creds.evolutionUrl, apiKey: creds.evolutionApiKey, ...(fetchFn ? { fetchFn } : {}) }, creds.instance, { cloud: creds.kind === "evolution_cloud" });
      }
      return createWhatsAppAdapter(creds, fetchFn);
    case "telegram":
      return createTelegramAdapter(creds, fetchFn);
    case "facebook":
    case "instagram":
      return createMessagingAdapter(channel, creds, fetchFn);
  }
}

/**
 * Credenciais a partir do ambiente (uma conta por canal).
 * Para várias clínicas com contas próprias, troque por uma busca no cofre de
 * segredos usando channel_connections.external_account_id como chave.
 */
export function credentialsFromEnv(channel: Channel, env: Record<string, string | undefined> = process.env): ChannelCredentials {
  const graphVersion = env.META_GRAPH_VERSION;
  switch (channel) {
    case "whatsapp":
      return { accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, graphVersion };
    case "facebook":
      return { accessToken: env.MESSENGER_PAGE_TOKEN, accountId: env.MESSENGER_PAGE_ID, graphVersion };
    case "instagram":
      return { accessToken: env.INSTAGRAM_ACCESS_TOKEN, accountId: env.INSTAGRAM_ACCOUNT_ID, graphVersion };
    case "telegram":
      return { botToken: env.TELEGRAM_BOT_TOKEN, accountId: env.TELEGRAM_BOT_USERNAME };
  }
}

/* ----------------------------- Janela de 24 horas --------------------------- */

export interface WindowState {
  /** Pode mandar mensagem livre agora? */
  open: boolean;
  /** Quando a janela fecha (null = canal sem janela, ou já fechada) */
  closesAt: Date | null;
}

/**
 * Regra da Meta: mensagem livre só até 24h após a última mensagem do paciente.
 * Fora disso, só modelos aprovados. O Telegram não tem essa regra.
 */
/**
 * Credenciais de UMA clínica: o token vem do ambiente (app do Tropi como
 * provedor de tecnologia da Meta / cofre de segredos) e o identificador da
 * conta vem do cadastro do canal da clínica (channel_connections).
 * Assim várias clínicas usam o mesmo app, cada uma com seu número/página.
 */
export function credentialsFor(channel: Channel, externalAccountId: string | null | undefined, env: Record<string, string | undefined> = process.env): ChannelCredentials {
  const base = credentialsFromEnv(channel, env);
  if (!externalAccountId) return base;
  return channel === "whatsapp" ? { ...base, phoneNumberId: externalAccountId } : { ...base, accountId: externalAccountId };
}

/** O ambiente tem o segredo necessário para operar este canal de verdade? */
export function hasRealCredentials(channel: Channel, env: Record<string, string | undefined> = process.env): boolean {
  const c = credentialsFromEnv(channel, env);
  return channel === "telegram" ? !!c.botToken : !!c.accessToken;
}

export function messagingWindow(channel: Channel, lastInboundAt: Date | null, now = new Date()): WindowState {
  const hours = CHANNEL_WINDOW_HOURS[channel];
  if (hours === null) return { open: true, closesAt: null };
  if (!lastInboundAt) return { open: false, closesAt: null };
  const closesAt = new Date(lastInboundAt.getTime() + hours * 3_600_000);
  return closesAt > now ? { open: true, closesAt } : { open: false, closesAt: null };
}

/* ------------------------- Webhook de exemplo (simulador) ------------------- */

/** Monta o webhook que o provedor enviaria se o paciente mandasse `text`. */
export function samplePayload(channel: Channel, p: { accountId: string; from: string; name?: string; text: string; at?: Date; media?: SampleMedia }): unknown {
  const at = p.at ?? new Date();
  const id = `sim-in-${randomUUID()}`;
  switch (channel) {
    case "whatsapp":
      return sampleWhatsAppPayload({ accountId: p.accountId, from: p.from, name: p.name, text: p.text, id: `wamid.${id}`, at, media: p.media });
    case "facebook":
    case "instagram":
      return sampleMessagingPayload(channel, { accountId: p.accountId, from: p.from, text: p.text, id: `m_${id}`, at, media: p.media });
    case "telegram":
      return sampleTelegramUpdate({ chatId: p.from, name: p.name, text: p.text, messageId: Math.floor(Math.random() * 1e9), at, media: p.media });
  }
}
