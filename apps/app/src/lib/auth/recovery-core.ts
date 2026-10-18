import "server-only";
import { createHmac } from "node:crypto";
import { and, db, eq, gte, isNull, lt, schema, sql } from "@ecosaude/db";
import { appUrl, sendEmail } from "@/lib/email";
import { passwordChangedEmail } from "@/lib/email/templates";

/**
 * RECUPERAÇÃO DE SENHA: regras compartilhadas (não são actions: nada aqui é chamável do navegador)
 */

/** Validade do link do e-mail */
export const RESET_MINUTES = 30;
/** Pedidos por e-mail por hora (acima disso, não manda mais: evita lotar a caixa de alguém) */
export const RESET_PER_EMAIL_HOUR = 3;
/** Pedidos por aparelho (IP) por hora */
export const RESET_PER_IP_HOUR = 10;

/**
 * Hash da chave do limite (IP ou e-mail): o banco não guarda o IP nem o e-mail digitado em claro.
 * HMAC com segredo do servidor: sem ele, não dá para testar "qual IP gerou este hash".
 */
export function throttleKey(value: string): string {
  const secret = process.env.LGPD_HASH_SECRET || process.env.TOTP_ENCRYPTION_KEY;
  if (!secret) throw new Error("LGPD_HASH_SECRET (ou TOTP_ENCRYPTION_KEY) não definida.");
  return createHmac("sha256", secret).update(`throttle:${value.toLowerCase()}`).digest("hex");
}

/**
 * Registra uma tentativa e diz se ainda está dentro do limite.
 * Conta ANTES de registrar: o pedido que estoura o limite também fica anotado
 * (quem insiste continua bloqueado até a janela andar).
 */
export async function hitThrottle(bucket: string, value: string, maxPerHour: number): Promise<boolean> {
  const keyHash = throttleKey(value);
  const since = new Date(Date.now() - 3_600_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.authThrottle)
    .where(and(eq(schema.authThrottle.bucket, bucket), eq(schema.authThrottle.keyHash, keyHash), gte(schema.authThrottle.createdAt, since)));
  await db.insert(schema.authThrottle).values({ bucket, keyHash });
  return (row?.n ?? 0) < maxPerHour;
}

/** Cancela os links de recuperação em aberto (senha trocada por outro caminho, conta desativada...). */
export async function revokeOpenResets(userId: string): Promise<void> {
  await db
    .update(schema.passwordResets)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.passwordResets.userId, userId), isNull(schema.passwordResets.usedAt), isNull(schema.passwordResets.revokedAt)));
}

/** Limpeza da rotina: tentativas com mais de 1 dia e links com mais de 30 dias. */
export async function cleanupAuthRecords(): Promise<{
  throttle: number;
  resets: number;
}> {
  const throttle = await db
    .delete(schema.authThrottle)
    .where(lt(schema.authThrottle.createdAt, new Date(Date.now() - 86_400_000)))
    .returning({ id: schema.authThrottle.id });
  const resets = await db
    .delete(schema.passwordResets)
    .where(lt(schema.passwordResets.createdAt, new Date(Date.now() - 30 * 86_400_000)))
    .returning({ id: schema.passwordResets.id });
  return { throttle: throttle.length, resets: resets.length };
}

/**
 * Avisa por e-mail que a senha mudou ("não foi você? fale com a gestão").
 * Melhor esforço: falha no envio não desfaz a troca, só fica registrada.
 */
export async function notifyPasswordChanged(userId: string, how: "link" | "conta"): Promise<void> {
  const [u] = await db
    .select({
      email: schema.clinicUsers.email,
      name: schema.clinicUsers.name,
      clinicId: schema.clinicUsers.clinicId,
      clinicName: schema.clinics.tradeName,
      timeZone: schema.clinics.timeZone,
    })
    .from(schema.clinicUsers)
    .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicUsers.clinicId))
    .where(eq(schema.clinicUsers.id, userId));
  if (!u) return;
  const result = await sendEmail(
    passwordChangedEmail({
      to: u.email,
      name: u.name,
      clinicName: u.clinicName,
      changedAt: new Date(),
      timeZone: u.timeZone,
      loginUrl: appUrl(),
      how,
    }),
  );
  if (!result.ok) {
    await db.insert(schema.crmEvents).values({
      clinicId: u.clinicId,
      actorId: userId,
      type: "auth.email_failed",
      data: { tipo: "senha-alterada", erros: result.errors },
    });
  }
}
