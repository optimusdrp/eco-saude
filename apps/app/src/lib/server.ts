import "server-only";
import { headers } from "next/headers";

/**
 * Utilitários das server actions do ambiente da clínica.
 */

/** Estado devolvido pelas actions para os formulários (padrão useActionState). */
export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Dado para mostrar uma única vez (senha temporária, chave da 2FA) */
  secret?: string;
  qr?: string;
  /** Valores digitados, devolvidos em caso de erro (o React limpa o formulário após o envio) */
  values?: Record<string, string>;
  /** Dado extra para a tela (ex.: id criado, horário liberado) */
  data?: Record<string, unknown>;
}

export const NOT_ALLOWED: ActionState = { ok: false, message: "Você não tem permissão para esta ação." };

/** IP de quem fez a requisição (a Vercel envia no cabeçalho x-forwarded-for). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/** Lê um campo de texto do FormData (string vazia se ausente). */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** FormData -> objeto simples, sem senhas (para devolver em `values`). */
export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && !/senha|password|current|next|confirm/i.test(key)) out[key] = value;
  }
  return out;
}

/** Código de erro do PostgreSQL, mesmo quando o drizzle embrulha o erro original. */
export function pgErrorCode(error: unknown): { code?: string; constraint?: string } {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: e?.cause?.code ?? e?.code, constraint: e?.cause?.constraint ?? e?.constraint };
}

/** 23505 = valor duplicado em campo único */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const { code, constraint: c } = pgErrorCode(error);
  return code === "23505" && (!constraint || c === constraint);
}

/** 23P01 = horário em conflito (restrição de exclusão da agenda: profissional OU consultório) */
export function isScheduleConflict(error: unknown): boolean {
  return pgErrorCode(error).code === "23P01";
}

/** O conflito foi do CONSULTÓRIO (outro profissional já está na sala nesse horário) */
export function isRoomConflict(error: unknown): boolean {
  const { code, constraint } = pgErrorCode(error);
  return code === "23P01" && constraint === "appointments_room_no_overlap";
}

/** Erro "esperado" (regra de negócio) com mensagem para mostrar na tela. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** Converte erros conhecidos em ActionState; erros desconhecidos sobem (aparecem no log). */
export function toActionError(error: unknown): ActionState {
  if (error instanceof UserError) return { ok: false, message: error.message };
  if (isRoomConflict(error)) return { ok: false, message: "O consultório já está ocupado nesse horário por outra consulta. Escolha outro consultório ou outro horário." };
  if (isScheduleConflict(error)) return { ok: false, message: "Esse horário acabou de ser ocupado. Escolha outro." };
  // EC002: unidade/consultório que não combinam (migração 0032)
  if (pgErrorCode(error).code === "EC002") return { ok: false, message: "O consultório escolhido não é da unidade da consulta. Escolha outro." };
  // EC001: trava do banco para fichas anonimizadas (migração 0024)
  if (pgErrorCode(error).code === "EC001")
    return { ok: false, message: "Os dados deste paciente foram apagados a pedido dele (LGPD). A ficha não pode mais ser alterada nem receber consultas, tarefas ou mensagens." };
  throw error;
}
