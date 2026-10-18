import "server-only";
import { generateToken, hashToken } from "@ecosaude/auth/crypto";
import { db, eq, schema } from "@ecosaude/db";
import { cookies } from "next/headers";

/**
 * Sessões dos usuários da clínica, guardadas no banco (só o hash do token).
 * Assim dá para encerrar uma sessão na hora (usuário desativado, senha trocada).
 * Cookie diferente do backoffice: as duas áreas nunca compartilham login.
 */
export const SESSION_COOKIE = "eco_app_session";
const SESSION_HOURS = 12;

export async function createSession(opts: {
  userId: string;
  clinicId: string;
  twoFactorPassed: boolean;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await db.insert(schema.clinicSessions).values({
    id: hashToken(token),
    userId: opts.userId,
    clinicId: opts.clinicId,
    twoFactorPassed: opts.twoFactorPassed,
    expiresAt,
    ip: opts.ip,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.clinicSessions).where(eq(schema.clinicSessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

export async function destroyUserSessions(userId: string): Promise<void> {
  await db.delete(schema.clinicSessions).where(eq(schema.clinicSessions.userId, userId));
}
