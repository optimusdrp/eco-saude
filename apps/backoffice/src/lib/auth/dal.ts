import "server-only";
import { can, type Permission, type StaffRole } from "@ecosaude/core";
import { and, db, eq, gte, schema } from "@ecosaude/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { hashToken } from "./crypto";
import { readSessionToken } from "./session";

/**
 * DAL (Data Access Layer) de autenticação.
 * É AQUI que a segurança é garantida de verdade: toda página e toda
 * ação do servidor chama requireUser()/requirePermission() antes de ler
 * ou alterar dados. O proxy.ts é só um filtro rápido de redirecionamento.
 */

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  twoFactorPassed: boolean;
  sessionId: string;
}

/**
 * Busca a sessão válida e o usuário dono dela.
 * `cache` garante uma única consulta por requisição, mesmo chamada várias vezes.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;

  const [row] = await db
    .select({ session: schema.sessions, user: schema.staffUsers })
    .from(schema.sessions)
    .innerJoin(schema.staffUsers, eq(schema.sessions.userId, schema.staffUsers.id))
    .where(and(eq(schema.sessions.id, hashToken(token)), gte(schema.sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.user.active) return null;

  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.user.role,
    totpEnabled: row.user.totpEnabled,
    mustChangePassword: row.user.mustChangePassword,
    twoFactorPassed: row.session.twoFactorPassed,
    sessionId: row.session.id,
  };
});

/**
 * Etapas de segurança que podem estar pendentes, em ordem.
 * Usado para mandar o usuário para a tela certa.
 */
export type PendingStep = "two-factor" | "change-password" | null;

export function pendingStep(user: CurrentUser): PendingStep {
  if (user.totpEnabled && !user.twoFactorPassed) return "two-factor";
  if (user.mustChangePassword) return "change-password";
  // A 2FA é OPCIONAL: cada pessoa ativa em "Minha conta". Quando ativa, o código
  // é exigido a cada login (primeira linha desta função).
  return null;
}

const stepRoute: Record<Exclude<PendingStep, null>, string> = {
  "two-factor": "/login/verificacao",
  "change-password": "/primeiro-acesso/senha",
};

/** Exige usuário logado e com todas as etapas de segurança concluídas. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const step = pendingStep(user);
  if (step) redirect(stepRoute[step]);
  return user;
}

/** Exige uma permissão específica. Sem ela, mostra a página de acesso negado. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/sem-permissao");
  return user;
}

/** Versão para server actions: devolve null em vez de redirecionar. */
export async function authorize(permission: Permission): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user || pendingStep(user) || !can(user.role, permission)) return null;
  return user;
}

export function routeForStep(step: Exclude<PendingStep, null>): string {
  return stepRoute[step];
}
