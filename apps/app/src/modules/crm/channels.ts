import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { decrypt, encrypt } from "@ecosaude/auth/crypto";
import type { ChannelCredentials, EvolutionConfig } from "@ecosaude/channels";
import { credentialsFromEnv } from "@ecosaude/channels";
import type { Channel, ConnectionKind } from "@ecosaude/core/crm";
import { appUrl } from "@/lib/email";

/**
 * CONEXÃO DOS CANAIS: configuração do servidor + credenciais de cada clínica
 *
 * Duas camadas:
 *  1. Do SERVIDOR (variáveis de ambiente, iguais para todas as clínicas):
 *     - Evolution API: EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET
 *     - App da Meta: META_APP_SECRET, META_VERIFY_TOKEN (e INSTAGRAM_APP_SECRET, no login do Instagram)
 *     - Telegram: TELEGRAM_WEBHOOK_SECRET (de onde sai o segredo de cada bot)
 *  2. De CADA CLÍNICA (tela de Canais): token da página, do Instagram, do bot.
 *     Guardados criptografados (AES-256-GCM) em channel_connections.credentials_enc;
 *     nunca voltam para o navegador.
 */

/** O que fica criptografado por clínica */
export interface StoredCredentials {
  accessToken?: string;
  botToken?: string;
}

export function encryptCredentials(c: StoredCredentials): string {
  return encrypt(JSON.stringify(c));
}

export function decryptCredentials(enc: string | null | undefined): StoredCredentials {
  if (!enc) return {};
  try {
    return JSON.parse(decrypt(enc)) as StoredCredentials;
  } catch {
    // Chave do servidor trocada ou dado corrompido: a clínica precisa conectar de novo
    return {};
  }
}

/** Endereços base (vazios = padrão dos provedores). Servem para testes e para o servidor local do Telegram. */
function bases(): Pick<ChannelCredentials, "graphBase" | "instagramBase" | "telegramBase"> {
  return {
    ...(process.env.META_GRAPH_BASE ? { graphBase: process.env.META_GRAPH_BASE } : {}),
    ...(process.env.INSTAGRAM_GRAPH_BASE ? { instagramBase: process.env.INSTAGRAM_GRAPH_BASE } : {}),
    ...(process.env.TELEGRAM_API_BASE ? { telegramBase: process.env.TELEGRAM_API_BASE } : {}),
  };
}

/** Evolution API configurada no servidor? */
export function evolutionConfig(): EvolutionConfig | null {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export interface ConnectionRow {
  channel: Channel;
  kind: string | null;
  externalAccountId: string | null;
  credentialsEnc: string | null;
}

/** Credenciais para o adaptador de UMA conexão (clínica), com o ambiente como reserva. */
export function connectionCredentials(conn: ConnectionRow | null | undefined, channel: Channel): ChannelCredentials {
  const env = credentialsFromEnv(channel);
  const own = decryptCredentials(conn?.credentialsEnc);
  const account = conn?.externalAccountId ?? undefined;
  const base: ChannelCredentials = { ...env, ...bases(), kind: conn?.kind ?? null };
  if (own.accessToken) base.accessToken = own.accessToken;
  if (own.botToken) base.botToken = own.botToken;
  if (account) {
    if (channel === "whatsapp") base.phoneNumberId = account;
    else base.accountId = account;
  }
  if (conn?.kind === "evolution_qr" || conn?.kind === "evolution_cloud") {
    const evo = evolutionConfig();
    if (evo) {
      base.evolutionUrl = evo.baseUrl;
      base.evolutionApiKey = evo.apiKey;
    }
    if (account) base.instance = account;
  }
  return base;
}

/** O que o SERVIDOR precisa para cada forma de conexão (a tela avisa o que falta) */
export function serverRequirements(kind: ConnectionKind): { ok: boolean; missing: string[] } {
  const need: Record<ConnectionKind, string[]> = {
    // A Evolution precisa de um endereço para chamar o Tropi: APP_URL (https) ou EVOLUTION_WEBHOOK_BASE_URL
    evolution_qr: ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_WEBHOOK_SECRET", "EVOLUTION_WEBHOOK"],
    evolution_cloud: ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_WEBHOOK_SECRET", "EVOLUTION_WEBHOOK"],
    meta_cloud: ["META_APP_SECRET", "META_VERIFY_TOKEN"],
    instagram_login: ["META_APP_SECRET", "META_VERIFY_TOKEN", "APP_URL"],
    facebook_login: ["META_APP_SECRET", "META_VERIFY_TOKEN", "APP_URL"],
    page: ["META_APP_SECRET", "META_VERIFY_TOKEN"],
    bot: ["TELEGRAM_WEBHOOK_SECRET", "APP_URL"],
  };
  const missing = need[kind]
    .filter((k) => (k === "APP_URL" ? !appUrl() : k === "EVOLUTION_WEBHOOK" ? !evolutionWebhookUrl() : !process.env[k]))
    .map((k) => (k === "EVOLUTION_WEBHOOK" ? "APP_URL (https) ou EVOLUTION_WEBHOOK_BASE_URL" : k));
  return { ok: missing.length === 0, missing };
}

/** Webhook que a Evolution chama (o mesmo para todas as instâncias; o segredo é por instância) */
/**
 * Endereço que a EVOLUTION usa para chamar o Tropi. Normalmente é o APP_URL; quando a Evolution
 * enxerga o Tropi por outro caminho (piloto local em Docker: http://host.docker.internal:3000;
 * rede interna na AWS), use EVOLUTION_WEBHOOK_BASE_URL.
 */
export function evolutionWebhookUrl(): string | null {
  const base = process.env.EVOLUTION_WEBHOOK_BASE_URL?.replace(/\/+$/, "") || appUrl();
  return base ? `${base}/api/webhooks/evolution` : null;
}

/** Nome da instância na Evolution: não revela a clínica, é único e estável */
export function newInstanceName(clinicId: string): string {
  return `tropi-${clinicId.replace(/-/g, "").slice(0, 8)}-${randomBytes(3).toString("hex")}`;
}

/* ------------------- Link temporário de arquivo (Instagram) ------------------- */

/**
 * O Instagram só aceita anexo por LINK. Em vez de deixar o arquivo público, o Tropi gera um
 * link assinado que vale poucos minutos e só abre UM anexo de mensagem ENVIADA pela clínica.
 */
const MEDIA_LINK_MINUTES = 15;

function mediaKey(): string {
  const k = process.env.MEDIA_LINK_SECRET || process.env.TOTP_ENCRYPTION_KEY;
  if (!k) throw new Error("MEDIA_LINK_SECRET (ou TOTP_ENCRYPTION_KEY) não definida.");
  return k;
}

export function signedMediaUrl(clinicId: string, attachmentId: string, now = Date.now()): string | null {
  const base = appUrl();
  if (!base) return null;
  const exp = Math.floor(now / 1000) + MEDIA_LINK_MINUTES * 60;
  const payload = Buffer.from(`${clinicId}.${attachmentId}.${exp}`).toString("base64url");
  const sig = createHmac("sha256", mediaKey()).update(payload).digest("base64url");
  return `${base}/api/midia/${payload}.${sig}`;
}

export function readMediaToken(token: string, now = Date.now()): { clinicId: string; attachmentId: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", mediaKey()).update(payload).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [clinicId, attachmentId, exp] = Buffer.from(payload, "base64url").toString().split(".");
  if (!clinicId || !attachmentId || !exp || Number(exp) * 1000 < now) return null;
  return { clinicId, attachmentId };
}
