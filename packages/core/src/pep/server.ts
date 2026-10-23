/**
 * PRONTUÁRIO: partes que só rodam no servidor (criptografia).
 *
 * Registro finalizado e documento emitido recebem um hash SHA-256 do conteúdo canônico
 * (JSON com chaves ordenadas). Qualquer alteração no banco muda o hash e é detectada.
 * Documento ganha também um CÓDIGO DE VERIFICAÇÃO curto: a farmácia ou a escola confere
 * em /documento/<código> se ele é autêntico.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function contentHash(content: unknown): string {
  return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}

/** Sem 0/O e 1/I/L: lê e digita sem confusão */
const B32 = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código XXXX-XXXX-XXXX. Inclui um valor aleatório: dois documentos iguais têm códigos diferentes. */
export function verificationCode(hash: string, salt: string): string {
  const h = createHash("sha256").update(`${hash}:${salt}`).digest();
  let out = "";
  for (let i = 0; out.length < 12; i++) out += B32[h[i]! % B32.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function normalizeVerificationCode(v: string): string {
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}` : "";
}
