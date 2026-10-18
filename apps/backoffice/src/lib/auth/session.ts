import "server-only";
import { db, eq, schema } from "@ecosaude/db";
import { cookies } from "next/headers";
import { generateToken, hashToken } from "./crypto";

/**
 * Sessões guardadas no banco (e não em JWT), porque assim é possível
 * DERRUBAR uma sessão na hora: ao desativar um usuário, trocar a senha
 * ou resetar a 2FA, as sessões dele são apagadas e o acesso para imediatamente.
 */
export const SESSION_COOKIE = "eco_bo_session";
const SESSION_HOURS = 12;

export async function createSession(opts: {
  userId: string;
  twoFactorPassed: boolean;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  await db.insert(schema.sessions).values({
    id: hashToken(token),
    userId: opts.userId,
    twoFactorPassed: opts.twoFactorPassed,
    expiresAt,
    ip: opts.ip,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript da página não consegue ler
    secure: process.env.NODE_ENV === "production", // só por HTTPS em produção
    sameSite: "lax", // bloqueia envio em requisições de outros sites (CSRF)
    path: "/",
    expires: expiresAt,
  });
}

/** Lê o token do cookie (sem validar no banco). */
export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Encerra a sessão atual (logout). */
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** Derruba TODAS as sessões de um usuário (ex.: conta desativada). */
export async function destroyUserSessions(userId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}
