"use server";

import { SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_TRANSITIONS } from "@ecosaude/core";
import { clinicSchema, flattenErrors, subscriptionCreateSchema, subscriptionOverrideSchema, subscriptionStatusSchema } from "@ecosaude/core/validation";
import { suggestTimeZone } from "@ecosaude/core/crm";
import { clinicUserSchema } from "@ecosaude/core/crm/validation";
import { and, db, eq, schema } from "@ecosaude/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { temporaryPassword } from "@/lib/auth/crypto";
import { authorize } from "@/lib/auth/dal";
import { audit, field, formValues, isUniqueViolation, NOT_ALLOWED, type ActionState } from "@/lib/server";

/** Lê os campos do formulário de clínica. */
function clinicInput(form: FormData) {
  return clinicSchema.safeParse({
    tradeName: field(form, "tradeName"),
    legalName: field(form, "legalName"),
    cnpj: field(form, "cnpj"),
    email: field(form, "email"),
    phone: field(form, "phone"),
    city: field(form, "city"),
    state: field(form, "state"),
    leadId: field(form, "leadId"),
  });
}

/* ------------------------------ Clínicas ---------------------------------- */

export async function createClinicAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("clinics.edit");
  if (!user) return NOT_ALLOWED;

  const parsed = clinicInput(form);
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { leadId, ...data } = parsed.data;

  let clinicId: string;
  try {
    clinicId = await db.transaction(async (tx) => {
      // Fuso inicial pelo estado (a clínica confere em Ajustes > Clínica)
      const [clinic] = await tx
        .insert(schema.clinics)
        .values({ ...data, timeZone: suggestTimeZone(data.state) })
        .returning({ id: schema.clinics.id });
      await audit(tx, user, "clinic.created", "clinic", clinic!.id, { tradeName: data.tradeName, fromLead: leadId ?? null });

      // Veio de um lead: liga os dois e marca o lead como ganho
      if (leadId) {
        const lead = await tx.query.leads.findFirst({ where: eq(schema.leads.id, leadId) });
        if (lead && !lead.clinicId) {
          await tx.update(schema.leads).set({ clinicId: clinic!.id, stage: "ganho" }).where(eq(schema.leads.id, leadId));
          await audit(tx, user, "lead.updated", "lead", leadId, {
            stage: { de: lead.stage, para: "ganho" },
            convertedTo: clinic!.id,
          });
        }
      }
      return clinic!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "clinics_cnpj_unique")) {
      return { ok: false, errors: { cnpj: "Já existe uma clínica com este CNPJ." }, values: formValues(form) };
    }
    throw error;
  }

  revalidatePath("/clinicas");
  redirect(`/clinicas/${clinicId}?criada=1`);
}

export async function updateClinicAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("clinics.edit");
  if (!user) return NOT_ALLOWED;

  const id = field(form, "id");
  const parsed = clinicInput(form);
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const data = parsed.data; // leadId é ignorado na edição

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.clinics)
        // undefined não altera a coluna no drizzle; por isso convertemos para null (apagar)
        .set({
          tradeName: data.tradeName,
          legalName: data.legalName ?? null,
          cnpj: data.cnpj ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
        })
        .where(eq(schema.clinics.id, id))
        .returning({ id: schema.clinics.id });
      if (updated.length === 0) throw new Error("Clínica não encontrada.");
      await audit(tx, user, "clinic.updated", "clinic", id, { ...data, leadId: undefined });
    });
  } catch (error) {
    if (isUniqueViolation(error, "clinics_cnpj_unique")) {
      return { ok: false, errors: { cnpj: "Já existe uma clínica com este CNPJ." }, values: formValues(form) };
    }
    throw error;
  }

  revalidatePath(`/clinicas/${id}`);
  return { ok: true, message: "Dados da clínica salvos." };
}

/* ---------------------------- Contratações -------------------------------- */

export async function createSubscriptionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("subscriptions.edit");
  if (!user) return NOT_ALLOWED;

  const parsed = subscriptionCreateSchema.safeParse({
    clinicId: field(form, "clinicId"),
    planId: field(form, "planId"),
    status: field(form, "status"),
    billingCycle: field(form, "billingCycle"),
    trialDays: field(form, "trialDays") || undefined,
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const data = parsed.data;

  const plan = await db.query.plans.findFirst({ where: eq(schema.plans.id, data.planId) });
  if (!plan?.active) return { ok: false, errors: { planId: "Plano inexistente ou inativo." }, values: formValues(form) };

  try {
    await db.transaction(async (tx) => {
      const [sub] = await tx
        .insert(schema.subscriptions)
        .values({
          clinicId: data.clinicId,
          planId: plan.id,
          moduleId: plan.moduleId,
          status: data.status,
          billingCycle: data.billingCycle,
          priceMonthlyCents: plan.priceMonthlyCents, // preço congelado
          trialEndsAt: data.status === "teste" ? new Date(Date.now() + data.trialDays * 86_400_000) : null,
          createdBy: user.id,
        })
        .returning({ id: schema.subscriptions.id });
      await audit(tx, user, "subscription.created", "clinic", data.clinicId, {
        subscriptionId: sub!.id,
        module: plan.moduleId,
        plan: plan.name,
        status: data.status,
        priceMonthlyCents: plan.priceMonthlyCents,
      });
    });
  } catch (error) {
    // Índice único parcial: já existe contratação aberta deste módulo
    if (isUniqueViolation(error, "subscriptions_one_open_per_module")) {
      return {
        ok: false,
        message: "Esta clínica já tem uma contratação em aberto deste módulo. Cancele a atual ou troque o plano nela.",
        values: formValues(form),
      };
    }
    throw error;
  }

  revalidatePath(`/clinicas/${data.clinicId}`);
  return { ok: true, message: "Contratação criada." };
}

export async function changeSubscriptionStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("subscriptions.edit");
  if (!user) return NOT_ALLOWED;

  const parsed = subscriptionStatusSchema.safeParse({
    id: field(form, "id"),
    status: field(form, "status"),
    reason: field(form, "reason"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };
  const { id, status, reason } = parsed.data;

  const sub = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, id) });
  if (!sub) return { ok: false, message: "Contratação não encontrada." };

  // Só permite mudanças previstas (ex.: cancelada não volta a ativa)
  if (!SUBSCRIPTION_TRANSITIONS[sub.status].includes(status)) {
    return {
      ok: false,
      message: `Não é possível passar de "${SUBSCRIPTION_STATUS_LABEL[sub.status]}" para "${SUBSCRIPTION_STATUS_LABEL[status]}".`,
    };
  }
  if ((status === "cancelada" || status === "suspensa") && !reason) {
    return { ok: false, errors: { reason: "Informe o motivo." } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.subscriptions)
      .set({
        status,
        canceledAt: status === "cancelada" ? new Date() : sub.canceledAt,
        // Ao virar "ativa", o teste deixa de ter prazo
        trialEndsAt: status === "ativa" ? null : sub.trialEndsAt,
      })
      .where(eq(schema.subscriptions.id, id));
    await audit(tx, user, "subscription.status_changed", "clinic", sub.clinicId, {
      subscriptionId: id,
      module: sub.moduleId,
      de: sub.status,
      para: status,
      motivo: reason ?? null,
    });
  });

  revalidatePath(`/clinicas/${sub.clinicId}`);
  return { ok: true, message: `Contratação agora está: ${SUBSCRIPTION_STATUS_LABEL[status]}.` };
}

/** Libera ou bloqueia uma funcionalidade específica para uma contratação. */
export async function setOverrideAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("subscriptions.edit");
  if (!user) return NOT_ALLOWED;

  const parsed = subscriptionOverrideSchema.safeParse({
    subscriptionId: field(form, "subscriptionId"),
    submoduleId: field(form, "submoduleId"),
    mode: field(form, "mode"),
  });
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const { subscriptionId, submoduleId, mode } = parsed.data;

  const sub = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) });
  const submodule = await db.query.submodules.findFirst({ where: eq(schema.submodules.id, submoduleId) });
  // A funcionalidade precisa ser do MESMO módulo da contratação
  if (!sub || !submodule || submodule.moduleId !== sub.moduleId) return { ok: false, message: "Combinação inválida." };

  await db.transaction(async (tx) => {
    const where = and(eq(schema.subscriptionOverrides.subscriptionId, subscriptionId), eq(schema.subscriptionOverrides.submoduleId, submoduleId));
    if (mode === "default") {
      await tx.delete(schema.subscriptionOverrides).where(where);
    } else {
      await tx
        .insert(schema.subscriptionOverrides)
        .values({ subscriptionId, submoduleId, enabled: mode === "on" })
        .onConflictDoUpdate({
          target: [schema.subscriptionOverrides.subscriptionId, schema.subscriptionOverrides.submoduleId],
          set: { enabled: mode === "on" },
        });
    }
    await audit(tx, user, "subscription.feature_override", "clinic", sub.clinicId, {
      subscriptionId,
      feature: submodule.key,
      mode,
    });
  });

  revalidatePath(`/clinicas/${sub.clinicId}`);
  return { ok: true, message: "Funcionalidade atualizada." };
}

/* ------------------------- Acesso da clínica (CRM) ------------------------- */

/**
 * Cria o PRIMEIRO acesso de gestão da clínica (ou um novo gestor).
 * Daí em diante, a própria clínica cadastra a equipe em Ajustes > Equipe.
 * A senha temporária aparece uma única vez e precisa ser trocada no primeiro login.
 */
export async function createClinicManagerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("clinics.edit");
  if (!user) return NOT_ALLOWED;
  const clinicId = field(form, "clinicId");
  const parsed = clinicUserSchema.safeParse({ name: field(form, "name"), email: field(form, "email").toLowerCase(), role: "gestor" });
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(clinicId)) {
    return { ok: false, errors: parsed.success ? {} : flattenErrors(parsed.error), values: formValues(form) };
  }
  const password = temporaryPassword();
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.clinicUsers)
        .values({ ...parsed.data, clinicId, passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true })
        .returning({ id: schema.clinicUsers.id });
      await audit(tx, user, "clinic.manager_created", "clinic", clinicId, { email: parsed.data.email, userId: created!.id });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, errors: { email: "Este e-mail já tem acesso ao EcoSaúde." }, values: formValues(form) };
    throw error;
  }
  revalidatePath(`/clinicas/${clinicId}`);
  return { ok: true, message: `Acesso criado para ${parsed.data.name}. Endereço: ambiente da clínica (porta 3002 em desenvolvimento).`, secret: password };
}

/**
 * Suporte ao acesso da clínica: quando o ÚNICO gestor perde a senha ou o
 * celular da verificação em duas etapas, só a equipe EcoSaúde consegue ajudar.
 *   kind = "senha" -> gera senha temporária (mostrada uma vez)
 *   kind = "2fa"   -> desliga a verificação em duas etapas
 * Em ambos os casos, as sessões abertas da pessoa são encerradas.
 */
export async function resetClinicUserAccessAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("clinics.edit");
  if (!user) return NOT_ALLOWED;
  const userId = field(form, "userId");
  const kind = field(form, "kind");
  if (!/^[0-9a-f-]{36}$/i.test(userId) || (kind !== "senha" && kind !== "2fa")) return { ok: false, message: "Pedido inválido." };
  const target = await db.query.clinicUsers.findFirst({ where: eq(schema.clinicUsers.id, userId), columns: { id: true, clinicId: true, email: true } });
  if (!target) return { ok: false, message: "Usuário não encontrado." };

  const password = kind === "senha" ? temporaryPassword() : undefined;
  await db.transaction(async (tx) => {
    if (password) {
      await tx
        .update(schema.clinicUsers)
        .set({ passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, failedLogins: 0, lockedUntil: null })
        .where(eq(schema.clinicUsers.id, userId));
    } else {
      await tx.update(schema.clinicUsers).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(schema.clinicUsers.id, userId));
    }
    await tx.delete(schema.clinicSessions).where(eq(schema.clinicSessions.userId, userId));
    await audit(tx, user, kind === "senha" ? "clinic.user_password_reset" : "clinic.user_2fa_reset", "clinic", target.clinicId, { email: target.email });
  });
  revalidatePath(`/clinicas/${target.clinicId}`);
  return password ? { ok: true, message: `Nova senha temporária para ${target.email}.`, secret: password } : { ok: true, message: `Verificação em duas etapas desligada para ${target.email}.` };
}
