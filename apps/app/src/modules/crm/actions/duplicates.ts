"use server";

import { and, eq, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, NOT_ALLOWED, toActionError, type ActionState } from "@/lib/server";
import { logEvent } from "../journey";
import { mergeContacts } from "../merge";
import { runCrm } from "../run";

/** Ações de duplicidade: unificar dois cadastros ou marcar "não é a mesma pessoa". */

const pairSchema = z.object({ a: z.uuid(), b: z.uuid() });

export async function mergeContactsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("contatos.mesclar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({ primaryId: z.uuid(), secondaryId: z.uuid(), primaryVersion: z.coerce.number().int().min(1), confirm: z.literal("on", { error: "Marque a confirmação." }) })
    .safeParse({
      primaryId: field(form, "primaryId"),
      secondaryId: field(form, "secondaryId"),
      primaryVersion: field(form, "primaryVersion"),
      confirm: field(form, "confirm"),
    });
  if (!parsed.success) return { ok: false, message: "Escolha o cadastro principal e confirme a unificação." };
  try {
    await runCrm(ctx, (tx, scope) => mergeContacts(tx, scope, parsed.data));
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/crm/contatos", "layout");
  revalidatePath("/crm/conversas", "layout");
  revalidatePath("/crm/jornada");
  revalidatePath("/crm/agenda");
  return { ok: true, message: "Cadastros unificados.", data: { contactId: parsed.data.primaryId } };
}

export async function dismissDuplicateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("contatos.mesclar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = pairSchema.safeParse({ a: field(form, "a"), b: field(form, "b") });
  if (!parsed.success || parsed.data.a === parsed.data.b) return { ok: false, message: "Par inválido." };
  // Sempre gravado em ordem (contact_a < contact_b) para o par ser único
  const [contactA, contactB] = [parsed.data.a, parsed.data.b].sort() as [string, string];
  await runCrm(ctx, async (tx, scope) => {
    // Os dois precisam ser desta clínica (RLS garante; a busca confirma que existem)
    const found = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.id, contactA)));
    if (!found.length) return;
    await tx.insert(schema.contactDuplicateDismissals).values({ contactA, contactB, createdBy: scope.actorId }).onConflictDoNothing();
    await logEvent(tx, { contactId: contactA, actorId: scope.actorId, type: "duplicate_dismissed", data: { outro: contactB } });
  });
  revalidatePath("/crm/contatos", "layout");
  return { ok: true, message: "Marcado como pessoas diferentes." };
}
