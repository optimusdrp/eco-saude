"use server";

import { generateToken, hashToken } from "@ecosaude/auth/crypto";
import { flattenErrors, forgotPasswordSchema, resetPasswordSchema } from "@ecosaude/core/validation";
import { and, db, eq, gt, isNull, schema, sql } from "@ecosaude/db";
import bcrypt from "bcryptjs";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { appUrl, emailStatus, sendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email/templates";
import { clientIp, field, type ActionState } from "@/lib/server";
import { hitThrottle, notifyPasswordChanged, RESET_MINUTES, RESET_PER_EMAIL_HOUR, RESET_PER_IP_HOUR } from "./recovery-core";

/**
 * "ESQUECI MINHA SENHA" (ambiente da clínica)
 *
 * 1. A pessoa informa o e-mail. A resposta é SEMPRE a mesma, exista a conta ou não,
 *    e chega no mesmo tempo (o trabalho roda depois da resposta): ninguém descobre
 *    quais e-mails têm acesso testando o formulário.
 * 2. Se a conta existe e está ativa, vai um link com um token aleatório de 256 bits.
 *    O banco guarda só o HASH; o link vale 30 minutos, uma vez; pedir de novo cancela o anterior.
 *    O token vai depois do "#" no link: não aparece em log de servidor nem é repassado a outros sites.
 * 3. Com a nova senha: todas as sessões são encerradas, o bloqueio por tentativas é limpo
 *    e chega um e-mail "sua senha foi alterada".
 * 4. A verificação em duas etapas CONTINUA valendo: quem só tem o e-mail não entra sem o celular.
 *    A pessoa não fica conectada automaticamente: entra de novo, com 2FA quando ativa.
 */

const SENT_MESSAGE = `Se este e-mail tiver acesso ao Tropi, o link chega em instantes. Confira também a caixa de spam. O link vale por ${RESET_MINUTES} minutos.`;
const INVALID_LINK = "Este link expirou ou já foi usado. Peça um novo abaixo.";

export async function requestPasswordResetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: field(form, "email"),
  });
  if (!parsed.success)
    return {
      ok: false,
      errors: flattenErrors(parsed.error),
      values: { email: field(form, "email") },
    };
  if (!emailStatus().configured) {
    return {
      ok: false,
      message: "A recuperação por e-mail não está disponível. Peça para a gestão da clínica redefinir a sua senha.",
    };
  }
  const email = parsed.data.email;
  const ip = await clientIp();

  // Limite por aparelho: aqui SIM avisamos (não revela nada sobre a conta)
  if (ip && !(await hitThrottle("reset_ip", ip, RESET_PER_IP_HOUR))) {
    return {
      ok: false,
      message: "Muitos pedidos feitos deste aparelho. Aguarde uma hora e tente de novo.",
    };
  }
  // Limite por e-mail: resposta igual, só não envia (evita lotar a caixa de alguém)
  const withinEmailLimit = await hitThrottle("reset_email", email, RESET_PER_EMAIL_HOUR);

  after(async () => {
    if (!withinEmailLimit) return;
    try {
      await sendResetLink(email, ip);
    } catch (error) {
      console.error("[recuperação de senha]", (error as Error).message);
    }
  });
  return { ok: true, message: SENT_MESSAGE };
}

/** Cria o link e envia (roda depois da resposta). */
async function sendResetLink(email: string, ip: string | null): Promise<void> {
  const [u] = await db
    .select({
      user: schema.clinicUsers,
      clinicName: schema.clinics.tradeName,
      timeZone: schema.clinics.timeZone,
    })
    .from(schema.clinicUsers)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(sql`lower(${schema.clinicUsers.email}) = ${email}`);
  if (!u || !u.user.active) return;
  const base = appUrl();
  if (!base) {
    console.error("[recuperação de senha] APP_URL ausente ou sem https: link não enviado.");
    return;
  }

  const token = generateToken();
  const now = new Date();
  await db.transaction(async (tx) => {
    // Um link válido por pessoa: o novo cancela o anterior
    await tx
      .update(schema.passwordResets)
      .set({ revokedAt: now })
      .where(and(eq(schema.passwordResets.userId, u.user.id), isNull(schema.passwordResets.usedAt), isNull(schema.passwordResets.revokedAt)));
    await tx.insert(schema.passwordResets).values({
      userId: u.user.id,
      clinicId: u.user.clinicId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000),
      requestedIp: ip,
    });
    await tx.insert(schema.crmEvents).values({
      clinicId: u.user.clinicId,
      actorId: u.user.id,
      type: "auth.password_reset_requested",
      data: { ip },
    });
  });

  const result = await sendEmail(
    passwordResetEmail({
      to: u.user.email,
      name: u.user.name,
      clinicName: u.clinicName,
      link: `${base}/login/nova-senha#t=${token}`,
      minutes: RESET_MINUTES,
      requestedAt: now,
      timeZone: u.timeZone,
    }),
  );
  await db.insert(schema.crmEvents).values({
    clinicId: u.user.clinicId,
    actorId: u.user.id,
    type: result.ok ? "auth.password_reset_sent" : "auth.email_failed",
    data: result.ok ? { via: result.via, reserva: result.usedFallback } : { tipo: "recuperacao-senha", erros: result.errors },
  });
}

/** Busca o link válido (não usado, não cancelado, no prazo) e a conta ativa. */
async function findValidReset(token: string) {
  const [row] = await db
    .select({
      reset: schema.passwordResets,
      user: schema.clinicUsers,
      clinicName: schema.clinics.tradeName,
    })
    .from(schema.passwordResets)
    .innerJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.passwordResets.userId))
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.passwordResets.clinicId))
    .where(and(eq(schema.passwordResets.tokenHash, hashToken(token)), isNull(schema.passwordResets.usedAt), isNull(schema.passwordResets.revokedAt), gt(schema.passwordResets.expiresAt, new Date())));
  return row && row.user.active ? row : null;
}

/** A tela confere o link antes de pedir a senha (para não digitar à toa num link vencido). */
export async function checkResetTokenAction(token: string): Promise<{ ok: true; firstName: string; clinicName: string; minutesLeft: number } | { ok: false }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false };
  const row = await findValidReset(token);
  if (!row) return { ok: false };
  return {
    ok: true,
    firstName: row.user.name.split(" ")[0] ?? row.user.name,
    clinicName: row.clinicName,
    minutesLeft: Math.max(1, Math.ceil((row.reset.expiresAt.getTime() - Date.now()) / 60_000)),
  };
}

export async function resetPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: field(form, "token"),
    next: field(form, "next"),
    confirm: field(form, "confirm"),
  });
  if (!parsed.success) {
    const errors = flattenErrors(parsed.error);
    if (errors.token) return { ok: false, message: INVALID_LINK, data: { expired: true } };
    return { ok: false, errors };
  }
  const { token, next } = parsed.data;
  const row = await findValidReset(token);
  if (!row) return { ok: false, message: INVALID_LINK, data: { expired: true } };
  if (await bcrypt.compare(next, row.user.passwordHash)) {
    return {
      ok: false,
      errors: { next: "A nova senha precisa ser diferente da anterior." },
    };
  }
  const hash = await bcrypt.hash(next, 12);
  const ip = await clientIp();

  const done = await db.transaction(async (tx) => {
    // Marca como usado SÓ se ainda estiver válido: dois envios ao mesmo tempo, só um passa
    const used = await tx
      .update(schema.passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.passwordResets.id, row.reset.id), isNull(schema.passwordResets.usedAt), isNull(schema.passwordResets.revokedAt), gt(schema.passwordResets.expiresAt, new Date())))
      .returning({ id: schema.passwordResets.id });
    if (!used.length) return false;
    await tx
      .update(schema.clinicUsers)
      .set({
        passwordHash: hash,
        mustChangePassword: false,
        failedLogins: 0,
        lockedUntil: null,
      })
      .where(eq(schema.clinicUsers.id, row.user.id));
    // Derruba TODAS as sessões (inclusive a de quem talvez tenha a senha antiga)
    await tx.delete(schema.clinicSessions).where(eq(schema.clinicSessions.userId, row.user.id));
    await tx.insert(schema.crmEvents).values({
      clinicId: row.user.clinicId,
      actorId: row.user.id,
      type: "auth.password_reset",
      data: { ip },
    });
    return true;
  });
  if (!done) return { ok: false, message: INVALID_LINK, data: { expired: true } };

  after(() => notifyPasswordChanged(row.user.id, "link").catch((e) => console.error("[aviso de senha]", (e as Error).message)));
  redirect("/login?senha=redefinida");
}
