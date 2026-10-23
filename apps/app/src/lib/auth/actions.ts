"use server";

import { decrypt, encrypt } from "@ecosaude/auth/crypto";
import { newTotpSecret, totpQrCode, verifyTotp } from "@ecosaude/auth/totp";
import { changePasswordSchema, flattenErrors, loginSchema, totpCodeSchema } from "@ecosaude/core/validation";
import { and, db, eq, ne, schema, sql } from "@ecosaude/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { clientIp, field, formValues, userAgent, type ActionState } from "@/lib/server";
import { getCurrentUser, pendingStep, routeForStep } from "./dal";
import { notifyPasswordChanged, revokeOpenResets } from "./recovery-core";
import { createSession, destroyCurrentSession } from "./session";

/**
 * Autenticação dos usuários da clínica.
 * Mesmas proteções do backoffice: bcrypt, tempo de resposta constante,
 * bloqueio após 5 tentativas, 2FA opcional, sessões encerráveis.
 * O login usa a conexão "dona" do banco (sem isolamento por clínica) porque
 * ainda não se sabe a clínica: ela é descoberta pelo e-mail.
 */
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const TOTP_ISSUER = "Tropi";
/** Hash de uma senha qualquer: comparado quando o e-mail não existe, para o tempo de resposta ser igual. */
const DUMMY_HASH = "$2b$12$j7EDoZ4zxfymqwg4ZzBA.u69pwuOqtveJ74t7FDZY/iw4HC8jQ3mq";

async function nextRoute(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "/login";
  const step = pendingStep(user);
  return step ? routeForStep(step) : "/";
}

async function registerFailure(userId: string) {
  await db
    .update(schema.clinicUsers)
    .set({
      failedLogins: sql`${schema.clinicUsers.failedLogins} + 1`,
      lockedUntil: sql`case when ${schema.clinicUsers.failedLogins} + 1 >= ${MAX_FAILURES}
        then now() + make_interval(mins => ${LOCK_MINUTES}) else ${schema.clinicUsers.lockedUntil} end`,
    })
    .where(eq(schema.clinicUsers.id, userId));
}

/** Registro de segurança na trilha da clínica (sem paciente associado). */
async function authEvent(clinicId: string, actorId: string, type: string) {
  await db.insert(schema.crmEvents).values({ clinicId, actorId, type, data: { ip: await clientIp() } });
}

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: field(form, "email"), password: field(form, "password") });
  const values = formValues(form);
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values };

  const { email, password } = parsed.data;
  const user = await db.query.clinicUsers.findFirst({ where: sql`lower(${schema.clinicUsers.email}) = lower(${email})` });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, message: `Muitas tentativas. Tente de novo em até ${LOCK_MINUTES} minutos.`, values };
  }
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.active) {
    if (user) {
      await registerFailure(user.id);
      await authEvent(user.clinicId, user.id, "auth.login_failed");
    }
    return { ok: false, message: "E-mail ou senha incorretos.", values };
  }

  await db
    .update(schema.clinicUsers)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(schema.clinicUsers.id, user.id));
  await db
    .delete(schema.clinicSessions)
    .where(and(eq(schema.clinicSessions.userId, user.id), sql`${schema.clinicSessions.expiresAt} < now()`));
  await createSession({
    userId: user.id,
    clinicId: user.clinicId,
    twoFactorPassed: !user.totpEnabled,
    ip: await clientIp(),
    userAgent: await userAgent(),
  });
  await authEvent(user.clinicId, user.id, "auth.login");
  redirect(await nextRoute());
}

export async function verifyTwoFactorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const parsed = totpCodeSchema.safeParse({ code: field(form, "code") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };

  const user = await db.query.clinicUsers.findFirst({ where: eq(schema.clinicUsers.id, current.id) });
  if (!user?.totpSecretEnc || !user.totpEnabled) redirect(await nextRoute());

  const step = verifyTotp(decrypt(user.totpSecretEnc), user.email, parsed.data.code, user.totpLastStep);
  if (step === null) {
    await registerFailure(user.id);
    if (user.failedLogins + 1 >= MAX_FAILURES) {
      await destroyCurrentSession();
      redirect("/login?bloqueado=1");
    }
    return { ok: false, errors: { code: "Código inválido ou já usado. Confira o aplicativo." } };
  }
  await db.update(schema.clinicUsers).set({ totpLastStep: step, failedLogins: 0 }).where(eq(schema.clinicUsers.id, user.id));
  await db.update(schema.clinicSessions).set({ twoFactorPassed: true }).where(eq(schema.clinicSessions.id, current.sessionId));
  redirect(await nextRoute());
}

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.totpEnabled && !current.twoFactorPassed) redirect("/login/verificacao");

  const parsed = changePasswordSchema.safeParse({
    current: field(form, "current"),
    next: field(form, "next"),
    confirm: field(form, "confirm"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };

  const user = await db.query.clinicUsers.findFirst({ where: eq(schema.clinicUsers.id, current.id) });
  if (!user || !(await bcrypt.compare(parsed.data.current, user.passwordHash))) {
    return { ok: false, errors: { current: "Senha atual incorreta." } };
  }
  if (await bcrypt.compare(parsed.data.next, user.passwordHash)) {
    return { ok: false, errors: { next: "A nova senha precisa ser diferente da atual." } };
  }
  await db
    .update(schema.clinicUsers)
    .set({ passwordHash: await bcrypt.hash(parsed.data.next, 12), mustChangePassword: false })
    .where(eq(schema.clinicUsers.id, user.id));
  // Encerra as outras sessões (outros aparelhos)
  await db
    .delete(schema.clinicSessions)
    .where(and(eq(schema.clinicSessions.userId, user.id), ne(schema.clinicSessions.id, current.sessionId)));
  await authEvent(user.clinicId, user.id, "auth.password_changed");
  // Um link de "esqueci a senha" pedido antes não serve mais
  await revokeOpenResets(user.id);

  if (form.get("from") === "conta") {
    // Aviso por e-mail (troca na conta já aberta: se não foi a pessoa, ela fica sabendo)
    after(() => notifyPasswordChanged(user.id, "conta").catch((e) => console.error("[aviso de senha]", (e as Error).message)));
    return { ok: true, message: "Senha alterada." };
  }
  redirect(await nextRoute());
}

/* ----------------------- 2FA opcional (Configurações > Conta) ----------------------- */

export async function startTwoFactorSetupAction(): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.totpEnabled) return { ok: false, message: "A verificação em duas etapas já está ativa." };
  const secret = newTotpSecret();
  await db.update(schema.clinicUsers).set({ totpSecretEnc: encrypt(secret), totpLastStep: null }).where(eq(schema.clinicUsers.id, current.id));
  return { ok: true, secret: secret.match(/.{1,4}/g)?.join(" ") ?? secret, qr: await totpQrCode(secret, current.email, TOTP_ISSUER) };
}

export async function confirmTwoFactorSetupAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const parsed = totpCodeSchema.safeParse({ code: field(form, "code") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };

  const user = await db.query.clinicUsers.findFirst({ where: eq(schema.clinicUsers.id, current.id) });
  if (!user?.totpSecretEnc) return { ok: false, message: 'Clique em "Ativar" de novo para gerar um QR code.' };
  const step = verifyTotp(decrypt(user.totpSecretEnc), user.email, parsed.data.code, null);
  if (step === null) {
    return { ok: false, errors: { code: "Código não confere. Use o QR code mais recente e confira o horário automático do celular." } };
  }
  await db.update(schema.clinicUsers).set({ totpEnabled: true, totpLastStep: step }).where(eq(schema.clinicUsers.id, user.id));
  await db.update(schema.clinicSessions).set({ twoFactorPassed: true }).where(eq(schema.clinicSessions.id, current.sessionId));
  await authEvent(user.clinicId, user.id, "auth.2fa_enabled");
  revalidatePath("/configuracoes/conta");
  return { ok: true, message: "Verificação em duas etapas ativada." };
}

export async function disableTwoFactorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const password = field(form, "password");
  const user = await db.query.clinicUsers.findFirst({ where: eq(schema.clinicUsers.id, current.id) });
  if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) {
    return { ok: false, errors: { password: "Senha incorreta." } };
  }
  await db.update(schema.clinicUsers).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(schema.clinicUsers.id, user.id));
  await authEvent(user.clinicId, user.id, "auth.2fa_disabled");
  revalidatePath("/configuracoes/conta");
  return { ok: true, message: "Verificação em duas etapas desativada." };
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}

/* ----------------------- Aparelhos conectados (Ajustes > Minha conta) ----------------------- */

/**
 * Desconecta um aparelho (id) ou todos os OUTROS (sem id).
 * Só mexe nas sessões da própria pessoa; a sessão atual nunca é encerrada aqui.
 */
export async function endSessionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const id = field(form, "id");
  // O id da sessão é o hash SHA-256 do token (64 hex), nunca o token em si.
  // Com id inválido não fazemos nada: jamais cair em "desconectar todos".
  if (id && !/^[0-9a-f]{64}$/.test(id)) return { ok: false, message: "Aparelho não encontrado." };
  const mine = and(eq(schema.clinicSessions.userId, current.id), ne(schema.clinicSessions.id, current.sessionId));
  const gone = await db
    .delete(schema.clinicSessions)
    .where(id ? and(mine, eq(schema.clinicSessions.id, id)) : mine)
    .returning({ id: schema.clinicSessions.id });
  await authEvent(current.clinicId, current.id, "auth.sessions_ended");
  revalidatePath("/configuracoes/conta");
  return { ok: true, message: gone.length ? (gone.length === 1 ? "Aparelho desconectado." : `${gone.length} aparelhos desconectados.`) : "Nenhum outro aparelho conectado." };
}
