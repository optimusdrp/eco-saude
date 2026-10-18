"use server";

import { parseMoneyToCents } from "@ecosaude/core";
import { flattenErrors, planSchema } from "@ecosaude/core/validation";
import { and, db, eq, inArray, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize } from "@/lib/auth/dal";
import { audit, field, formValues, isUniqueViolation, NOT_ALLOWED, type ActionState } from "@/lib/server";

/**
 * Cria ou edita um plano.
 * Importante: mudar o preço NÃO altera contratações existentes
 * (elas guardam o preço do momento em que foram feitas).
 */
export async function savePlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("catalog.edit");
  if (!user) return NOT_ALLOWED;

  const parsed = planSchema.safeParse({
    id: field(form, "id"),
    moduleId: field(form, "moduleId"),
    name: field(form, "name"),
    description: field(form, "description"),
    priceMonthly: field(form, "priceMonthly"),
    maxUsers: field(form, "maxUsers") || undefined,
    active: form.get("active") === "on",
    submoduleIds: form.getAll("submoduleIds").filter((v): v is string => typeof v === "string"),
  });
  const values = formValues(form);
  // Campos repetidos (várias caixas marcadas) viram uma lista separada por vírgula
  values.submoduleIds = form.getAll("submoduleIds").join(",");
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values };
  const data = parsed.data;

  const cents = parseMoneyToCents(data.priceMonthly);
  if (cents === null) return { ok: false, errors: { priceMonthly: "Preço inválido. Ex.: 249,90" }, values };
  if (data.submoduleIds.length === 0) return { ok: false, errors: { submoduleIds: "Inclua pelo menos uma funcionalidade." }, values };

  // As funcionalidades precisam ser do mesmo módulo do plano
  const subs = await db.query.submodules.findMany({ where: inArray(schema.submodules.id, data.submoduleIds) });
  if (subs.length !== data.submoduleIds.length || subs.some((s) => s.moduleId !== data.moduleId)) {
    return { ok: false, errors: { submoduleIds: "Funcionalidade inválida para este módulo." }, values };
  }

  let planId = data.id;
  try {
    await db.transaction(async (tx) => {
      const row = {
        moduleId: data.moduleId,
        name: data.name,
        description: data.description ?? null,
        priceMonthlyCents: cents,
        maxUsers: data.maxUsers ?? null,
        active: data.active,
      };

      if (planId) {
        const before = await tx.query.plans.findFirst({ where: eq(schema.plans.id, planId) });
        if (!before) throw new Error("Plano não encontrado.");
        // O módulo de um plano não muda (contratações dependem disso)
        await tx.update(schema.plans).set({ ...row, moduleId: before.moduleId }).where(eq(schema.plans.id, planId));
        await audit(tx, user, "plan.updated", "plan", planId, {
          preco: before.priceMonthlyCents !== cents ? { de: before.priceMonthlyCents, para: cents } : undefined,
          ativo: before.active !== data.active ? data.active : undefined,
          nome: before.name !== data.name ? data.name : undefined,
        });
      } else {
        const [created] = await tx.insert(schema.plans).values(row).returning({ id: schema.plans.id });
        planId = created!.id;
        await audit(tx, user, "plan.created", "plan", planId, { module: data.moduleId, name: data.name, priceMonthlyCents: cents });
      }

      // Substitui a lista de funcionalidades do plano
      await tx.delete(schema.planSubmodules).where(and(eq(schema.planSubmodules.planId, planId!)));
      await tx.insert(schema.planSubmodules).values(data.submoduleIds.map((submoduleId) => ({ planId: planId!, submoduleId })));
    });
  } catch (error) {
    if (isUniqueViolation(error, "plans_module_name_unique")) {
      return { ok: false, errors: { name: "Já existe um plano com este nome neste módulo." }, values };
    }
    throw error;
  }

  revalidatePath("/catalogo");
  redirect(`/catalogo?salvo=${planId}`);
}
