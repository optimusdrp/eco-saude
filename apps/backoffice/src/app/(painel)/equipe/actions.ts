"use server";

import { STAFF_ROLE_LABEL } from "@ecosaude/core";
import { flattenErrors, staffCreateSchema, staffUpdateSchema } from "@ecosaude/core/validation";
import { and, count, db, eq, ne, schema } from "@ecosaude/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { temporaryPassword } from "@/lib/auth/crypto";
import { authorize } from "@/lib/auth/dal";
import { destroyUserSessions } from "@/lib/auth/session";
import { audit, field, formValues, isUniqueViolation, NOT_ALLOWED, type ActionState } from "@/lib/server";

/**
 * Gestão da equipe interna (somente administradores).
 * Senhas temporárias aparecem UMA vez na tela e nunca ficam salvas em texto.
 */

export async function createStaffAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("staff.manage");
  if (!user) return NOT_ALLOWED;

  const parsed = staffCreateSchema.safeParse({ name: field(form, "name"), email: field(form, "email"), role: field(form, "role") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };

  const password = temporaryPassword();
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.staffUsers)
        .values({ ...parsed.data, passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true })
        .returning({ id: schema.staffUsers.id });
      await audit(tx, user, "staff.created", "staff_user", created!.id, { email: parsed.data.email, role: parsed.data.role });
    });
  } catch (error) {
    if (isUniqueViolation(error, "staff_users_email_unique")) {
      return { ok: false, errors: { email: "Já existe uma conta com este e-mail." }, values: formValues(form) };
    }
    throw error;
  }

  revalidatePath("/equipe");
  return {
    ok: true,
    message: `Conta criada para ${parsed.data.name}. Envie a senha temporária por um canal seguro; ela não será mostrada de novo.`,
    secret: password,
  };
}

/** Quantos administradores ativos existem (para nunca ficar sem nenhum). */
async function activeAdmins(exceptId?: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.staffUsers)
    .where(
      and(
        eq(schema.staffUsers.role, "admin"),
        eq(schema.staffUsers.active, true),
        exceptId ? ne(schema.staffUsers.id, exceptId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export async function updateStaffAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("staff.manage");
  if (!user) return NOT_ALLOWED;

  const parsed = staffUpdateSchema.safeParse({ id: field(form, "id"), role: field(form, "role"), active: form.get("active") === "on" });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };
  const { id, role, active } = parsed.data;

  const target = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, id) });
  if (!target) return { ok: false, message: "Usuário não encontrado." };

  // Proteções: ninguém tira o próprio acesso de admin, e sempre sobra um admin ativo
  if (id === user.id && (role !== "admin" || !active)) {
    return { ok: false, message: "Você não pode remover o seu próprio acesso de administrador." };
  }
  if (target.role === "admin" && (role !== "admin" || !active) && (await activeAdmins(id)) === 0) {
    return { ok: false, message: "É preciso manter pelo menos um administrador ativo." };
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.staffUsers).set({ role, active }).where(eq(schema.staffUsers.id, id));
    await audit(tx, user, "staff.updated", "staff_user", id, {
      role: target.role !== role ? { de: target.role, para: role } : undefined,
      active: target.active !== active ? active : undefined,
    });
  });
  // Desativado: derruba as sessões abertas na hora
  if (!active) await destroyUserSessions(id);

  revalidatePath("/equipe");
  return { ok: true, message: `${target.name}: ${STAFF_ROLE_LABEL[role]}, ${active ? "ativo" : "desativado"}.` };
}

export async function resetPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("staff.manage");
  if (!user) return NOT_ALLOWED;
  const id = field(form, "id");
  if (id === user.id) return { ok: false, message: "Para trocar a sua senha, use a página Minha conta." };

  const target = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, id) });
  if (!target) return { ok: false, message: "Usuário não encontrado." };

  const password = temporaryPassword();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.staffUsers)
      .set({ passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, failedLogins: 0, lockedUntil: null })
      .where(eq(schema.staffUsers.id, id));
    await audit(tx, user, "staff.password_reset", "staff_user", id);
  });
  await destroyUserSessions(id);

  revalidatePath("/equipe");
  return { ok: true, message: `Nova senha temporária para ${target.name}. Ela não será mostrada de novo.`, secret: password };
}

export async function resetTwoFactorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("staff.manage");
  if (!user) return NOT_ALLOWED;
  const id = field(form, "id");
  if (id === user.id) return { ok: false, message: "Você não pode redefinir a sua própria 2FA por aqui." };

  const target = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, id) });
  if (!target) return { ok: false, message: "Usuário não encontrado." };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.staffUsers)
      .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null })
      .where(eq(schema.staffUsers.id, id));
    await audit(tx, user, "staff.2fa_reset", "staff_user", id);
  });
  await destroyUserSessions(id);

  revalidatePath("/equipe");
  return { ok: true, message: `2FA de ${target.name} desativada. A pessoa pode ativar de novo em Minha conta.` };
}
