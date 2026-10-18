import "server-only";
import { writeAudit, type Database, type Tx } from "@ecosaude/db";
import { headers } from "next/headers";
import type { CurrentUser } from "./auth/dal";

/**
 * Utilitários usados pelas server actions.
 */

/** Estado devolvido pelas actions para o formulário (padrão useActionState). */
export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Dado extra para mostrar uma única vez (ex.: senha temporária, chave da 2FA). */
  secret?: string;
  /** QR code (imagem em data URL) da ativação da 2FA. */
  qr?: string;
  /**
   * Valores digitados, devolvidos quando há erro.
   * O React 19 limpa o formulário após cada envio; usando estes valores
   * como defaultValue, o usuário não perde o que digitou.
   */
  values?: Record<string, string>;
}

export const initialState: ActionState = {};

export const NOT_ALLOWED: ActionState = { ok: false, message: "Você não tem permissão para esta ação." };

/** IP de quem fez a requisição (a Vercel envia no cabeçalho x-forwarded-for). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  // Garante formato aceito pela coluna inet do PostgreSQL
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/** Registra auditoria com o usuário e o IP atuais. */
export async function audit(
  tx: Tx | Database,
  user: Pick<CurrentUser, "id" | "email"> | null,
  action: string,
  entity: string,
  entityId: string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  await writeAudit(tx, {
    actor: user ? { id: user.id, email: user.email } : null,
    action,
    entity,
    entityId,
    data,
    ip: await clientIp(),
  });
}

/** Converte o FormData em objeto simples (para devolver em `values`). */
export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && !/senha|password|current|next|confirm/i.test(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** Lê um campo de texto do FormData (string vazia se ausente). */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Erro de violação de unicidade do PostgreSQL (código 23505). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && (!constraint || name === constraint);
}
