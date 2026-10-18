"use server";

import {
  changePasswordSchema,
  flattenErrors,
  loginSchema,
  totpCodeSchema,
} from "@ecosaude/core/validation";
import { and, db, eq, ne, schema, sql } from "@ecosaude/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, clientIp, field, formValues, userAgent, type ActionState } from "@/lib/server";
import { decrypt, encrypt } from "./crypto";
import { getCurrentUser, pendingStep, routeForStep } from "./dal";
import { createSession, destroyCurrentSession } from "./session";
import { newTotpSecret, totpQrCode, verifyTotp } from "./totp";

/**
 * Ações de autenticação (rodam SOMENTE no servidor por causa do "use server").
 */

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/**
 * Hash "falso" usado quando o e-mail não existe: assim o tempo de resposta
 * é o mesmo para e-mail existente ou não, e ninguém descobre quais e-mails
 * têm conta medindo a demora.
 */
const DUMMY_HASH = "$2b$12$j7EDoZ4zxfymqwg4ZzBA.u69pwuOqtveJ74t7FDZY/iw4HC8jQ3mq";

/** Para onde ir depois de concluir uma etapa. */
async function nextRoute(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "/login";
  const step = pendingStep(user);
  return step ? routeForStep(step) : "/";
}

/** Soma uma falha e bloqueia a conta temporariamente ao atingir o limite. */
async function registerFailure(userId: string) {
  await db
    .update(schema.staffUsers)
    .set({
      failedLogins: sql`${schema.staffUsers.failedLogins} + 1`,
      lockedUntil: sql`case when ${schema.staffUsers.failedLogins} + 1 >= ${MAX_FAILURES}
        then now() + make_interval(mins => ${LOCK_MINUTES}) else ${schema.staffUsers.lockedUntil} end`,
    })
    .where(eq(schema.staffUsers.id, userId));
}

/* --------------------------------- Login ---------------------------------- */

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: field(form, "email"), password: field(form, "password") });
  const values = formValues(form);
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values };

  const { email, password } = parsed.data;
  const user = await db.query.staffUsers.findFirst({
    where: sql`lower(${schema.staffUsers.email}) = lower(${email})`,
  });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, message: `Muitas tentativas. Tente de novo em até ${LOCK_MINUTES} minutos.`, values };
  }

  // Compara SEMPRE (mesmo sem usuário) para manter o tempo de resposta igual
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid || !user.active) {
    if (user) {
      await registerFailure(user.id);
      await audit(db, { id: user.id, email: user.email }, "auth.login_failed", "staff_user", user.id);
    }
    return { ok: false, message: "E-mail ou senha incorretos.", values };
  }

  await db
    .update(schema.staffUsers)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(schema.staffUsers.id, user.id));

  // Limpa sessões vencidas deste usuário
  await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, user.id), sql`${schema.sessions.expiresAt} < now()`));

  await createSession({
    userId: user.id,
    // Com 2FA ativa, a sessão nasce "incompleta" até o código ser conferido
    twoFactorPassed: !user.totpEnabled,
    ip: await clientIp(),
    userAgent: await userAgent(),
  });
  await audit(db, { id: user.id, email: user.email }, "auth.login", "staff_user", user.id);

  redirect(await nextRoute());
}

/* ------------------------------ Código da 2FA ------------------------------ */

export async function verifyTwoFactorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  const parsed = totpCodeSchema.safeParse({ code: field(form, "code") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };

  const user = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, current.id) });
  if (!user?.totpSecretEnc || !user.totpEnabled) redirect(await nextRoute());

  const step = verifyTotp(decrypt(user.totpSecretEnc), user.email, parsed.data.code, user.totpLastStep);
  if (step === null) {
    await registerFailure(user.id);
    await audit(db, current, "auth.2fa_failed", "staff_user", user.id);
    // Atingiu o limite: encerra a sessão por segurança
    if (user.failedLogins + 1 >= MAX_FAILURES) {
      await destroyCurrentSession();
      redirect("/login?bloqueado=1");
    }
    return { ok: false, errors: { code: "Código inválido ou já usado. Confira o aplicativo." } };
  }

  await db
    .update(schema.staffUsers)
    .set({ totpLastStep: step, failedLogins: 0 })
    .where(eq(schema.staffUsers.id, user.id));
  await db.update(schema.sessions).set({ twoFactorPassed: true }).where(eq(schema.sessions.id, current.sessionId));
  await audit(db, current, "auth.2fa_passed", "staff_user", user.id);

  redirect(await nextRoute());
}

/* ------------------------------ Troca de senha ----------------------------- */

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  // Com 2FA ativa, só troca a senha depois de passar pelo código
  if (current.totpEnabled && !current.twoFactorPassed) redirect("/login/verificacao");

  const parsed = changePasswordSchema.safeParse({
    current: field(form, "current"),
    next: field(form, "next"),
    confirm: field(form, "confirm"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };

  const user = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, current.id) });
  if (!user || !(await bcrypt.compare(parsed.data.current, user.passwordHash))) {
    return { ok: false, errors: { current: "Senha atual incorreta." } };
  }
  if (await bcrypt.compare(parsed.data.next, user.passwordHash)) {
    return { ok: false, errors: { next: "A nova senha precisa ser diferente da atual." } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.staffUsers)
      .set({ passwordHash: await bcrypt.hash(parsed.data.next, 12), mustChangePassword: false })
      .where(eq(schema.staffUsers.id, user.id));
    // Derruba as OUTRAS sessões (outros navegadores); mantém a atual
    await tx
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, current.sessionId)));
    await audit(tx, current, "auth.password_changed", "staff_user", user.id);
  });

  if (form.get("from") === "conta") return { ok: true, message: "Senha alterada." };
  redirect(await nextRoute());
}

/* ------------------- 2FA opcional (página "Minha conta") ------------------- */

/**
 * Passo 1 da ativação: gera um segredo NOVO, guarda criptografado (ainda inativo)
 * e devolve o QR code. O segredo é criado só ao clicar em "Ativar"
 * (e não ao abrir a página), então nunca existe mais de um segredo "em disputa".
 */
export async function startTwoFactorSetupAction(): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.totpEnabled) return { ok: false, message: "A verificação em duas etapas já está ativa." };

  const secret = newTotpSecret();
  await db
    .update(schema.staffUsers)
    .set({ totpSecretEnc: encrypt(secret), totpLastStep: null })
    .where(eq(schema.staffUsers.id, current.id));

  return {
    ok: true,
    secret: secret.match(/.{1,4}/g)?.join(" ") ?? secret, // em blocos de 4 para digitar
    qr: await totpQrCode(secret, current.email),
  };
}

/** Passo 2 da ativação: confere um código do aplicativo e liga a 2FA. */
export async function confirmTwoFactorSetupAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  const parsed = totpCodeSchema.safeParse({ code: field(form, "code") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };

  const user = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, current.id) });
  if (!user?.totpSecretEnc) return { ok: false, message: "Clique em \"Ativar\" de novo para gerar um QR code." };
  if (user.totpEnabled) return { ok: true, message: "A verificação em duas etapas já está ativa." };

  const step = verifyTotp(decrypt(user.totpSecretEnc), user.email, parsed.data.code, null);
  if (step === null) {
    return {
      ok: false,
      errors: {
        code: "Código não confere. Confira se leu o QR code mais recente e se o relógio do computador e do celular estão no horário automático.",
      },
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.staffUsers)
      .set({ totpEnabled: true, totpLastStep: step })
      .where(eq(schema.staffUsers.id, user.id));
    // A sessão atual já conta como verificada (o código acabou de ser conferido)
    await tx.update(schema.sessions).set({ twoFactorPassed: true }).where(eq(schema.sessions.id, current.sessionId));
    await audit(tx, current, "auth.2fa_enabled", "staff_user", user.id);
  });

  revalidatePath("/conta");
  return { ok: true, message: "Verificação em duas etapas ativada. Ela será pedida nos próximos logins." };
}

/** Desativa a própria 2FA. Exige a senha atual, para ninguém desligar numa sessão esquecida aberta. */
export async function disableTwoFactorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  const password = field(form, "password");
  if (!password) return { ok: false, errors: { password: "Informe sua senha para confirmar." } };

  const user = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, current.id) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { ok: false, errors: { password: "Senha incorreta." } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.staffUsers)
      .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null })
      .where(eq(schema.staffUsers.id, user.id));
    await audit(tx, current, "auth.2fa_disabled", "staff_user", user.id);
  });

  revalidatePath("/conta");
  return { ok: true, message: "Verificação em duas etapas desativada." };
}

/* ---------------------------------- Sair ----------------------------------- */

export async function logoutAction(): Promise<void> {
  const current = await getCurrentUser();
  if (current) await audit(db, current, "auth.logout", "staff_user", current.id);
  await destroyCurrentSession();
  redirect("/login");
}
