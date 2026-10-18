"use server";

import { LEAD_STAGE_LABEL } from "@ecosaude/core";
import { flattenErrors, leadNoteSchema, leadUpdateSchema } from "@ecosaude/core/validation";
import { db, eq, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth/dal";
import { audit, field, formValues, NOT_ALLOWED, type ActionState } from "@/lib/server";

/**
 * Ações dos leads. Padrão de TODAS as actions do backoffice:
 *  1. authorize(permissão)  -> quem não pode, para aqui
 *  2. validar com zod       -> nunca confiar no que vem do navegador
 *  3. alterar + auditar na MESMA transação
 *  4. revalidatePath        -> a tela mostra o dado novo
 */

export async function updateLeadAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("leads.edit");
  if (!user) return NOT_ALLOWED;

  const parsed = leadUpdateSchema.safeParse({
    id: field(form, "id"),
    stage: field(form, "stage"),
    ownerId: field(form, "ownerId"),
    lostReason: field(form, "lostReason"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const data = parsed.data;

  if (data.stage === "perdido" && !data.lostReason) {
    return { ok: false, errors: { lostReason: "Conte por que o lead foi perdido." }, values: formValues(form) };
  }

  const before = await db.query.leads.findFirst({ where: eq(schema.leads.id, data.id) });
  if (!before) return { ok: false, message: "Lead não encontrado." };

  // O responsável precisa ser alguém ativo da equipe
  if (data.ownerId) {
    const owner = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, data.ownerId) });
    if (!owner?.active) return { ok: false, errors: { ownerId: "Escolha um responsável ativo." } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.leads)
      .set({
        stage: data.stage,
        ownerId: data.ownerId,
        lostReason: data.stage === "perdido" ? (data.lostReason ?? null) : null,
      })
      .where(eq(schema.leads.id, data.id));

    // Registra só o que mudou (fica mais fácil de ler na auditoria)
    const changes: Record<string, unknown> = {};
    if (before.stage !== data.stage) changes.stage = { de: before.stage, para: data.stage };
    if (before.ownerId !== data.ownerId) changes.ownerId = { de: before.ownerId, para: data.ownerId };
    if (data.stage === "perdido" && before.lostReason !== data.lostReason) changes.lostReason = data.lostReason;
    if (Object.keys(changes).length > 0) {
      await audit(tx, user, "lead.updated", "lead", data.id, changes);
    }
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${data.id}`);
  return { ok: true, message: `Lead atualizado: ${LEAD_STAGE_LABEL[data.stage]}.` };
}

export async function addLeadNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await authorize("leads.edit");
  if (!user) return NOT_ALLOWED;

  const parsed = leadNoteSchema.safeParse({ leadId: field(form, "leadId"), body: field(form, "body") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };

  await db.transaction(async (tx) => {
    const [note] = await tx
      .insert(schema.leadNotes)
      .values({ leadId: parsed.data.leadId, authorId: user.id, body: parsed.data.body })
      .returning({ id: schema.leadNotes.id });
    await audit(tx, user, "lead.note_added", "lead", parsed.data.leadId, { noteId: note?.id });
  });

  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true, message: "Anotação salva." };
}
