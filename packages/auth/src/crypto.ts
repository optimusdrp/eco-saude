import "server-only";
import { ensureEnv } from "@ecosaude/db";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Funções de criptografia usadas pela autenticação (backoffice e ambiente da clínica).
 * "server-only" faz o build FALHAR se alguém importar isto num componente
 * do navegador, evitando vazar código sensível.
 */

/** Token de sessão: 32 bytes aleatórios (256 bits), seguro contra adivinhação. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash do token guardado no banco. O token em si só existe no cookie. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Lê a chave de criptografia dos segredos de 2FA (32 bytes em base64). */
function encryptionKey(): Buffer {
  ensureEnv();
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOTP_ENCRYPTION_KEY não definida (veja .env.example).");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY deve ter 32 bytes em base64.");
  return key;
}

/**
 * Criptografa com AES-256-GCM (confidencialidade + detecção de adulteração).
 * Formato salvo: v1.<iv>.<tag>.<conteúdo>, tudo em base64url.
 */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Formato criptografado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Senha temporária forte para contas novas ou redefinidas. */
export function temporaryPassword(): string {
  // 12 caracteres aleatórios + garantia de maiúscula, minúscula e número
  return `${randomBytes(9).toString("base64url")}Aa7`;
}
