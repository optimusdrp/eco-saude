"use server";

import { todayIso } from "@ecosaude/core/crm";
import { taskSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { and, eq, inArray, isNotNull, isNull, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, formValues, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { logEvent } from "../journey";
import { runCrm } from "../run";

/**
 * TAREFAS: criar/editar (com responsável), excluir e reabrir.
 * Concluir continua em contacts.ts (completeTaskAction).
 */

function refresh(contactId?: string | null) {
  revalidatePath("/hoje");
  revalidatePath("/crm/tarefas");
  if (contactId) revalidatePath(`/crm/contatos/${contactId}`);
}

export async function saveTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("tarefas.gerir");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  const parsed = taskSchema.safeParse({
    contactId: field(form, "contactId"),
    title: field(form, "title"),
    dueDate: field(form, "dueDate") || todayIso(),
    assigneeId: field(form, "assigneeId"),
  });
  if (!parsed.success || (id && !z.uuid().safeParse(id).success)) {
    return { ok: false, errors: parsed.success ? {} : flattenErrors(parsed.error), values: formValues(form) };
  }
  const d = parsed.data;
  try {
    await runCrm(ctx, async (tx, scope) => {
      const assigneeId = d.assigneeId ?? scope.actorId;
      if (assigneeId) {
        // Responsável precisa ser da clínica e estar ativo (RLS limita à clínica)
        const [u] = await tx.select({ active: schema.clinicUsers.active }).from(schema.clinicUsers).where(eq(schema.clinicUsers.id, assigneeId));
        if (!u?.active) throw new UserError("Responsável não encontrado ou desativado.");
      }
      if (id) {
        const rows = await tx
          .update(schema.tasks)
          .set({ title: d.title, dueDate: d.dueDate, assigneeId, contactId: d.contactId ?? null })
          .where(eq(schema.tasks.id, id))
          .returning({ id: schema.tasks.id });
        if (!rows.length) throw new UserError("Tarefa não encontrada.");
      } else {
        await tx.insert(schema.tasks).values({ contactId: d.contactId ?? null, title: d.title, dueDate: d.dueDate, assigneeId, createdBy: scope.actorId });
      }
    });
  } catch (error) {
    return { ...toActionError(error), values: formValues(form) };
  }
  refresh(d.contactId);
  return { ok: true, message: id ? "Tarefa atualizada." : "Tarefa criada." };
}

export async function deleteTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("tarefas.gerir");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  const contactId = await runCrm(ctx, async (tx, scope) => {
    const [t] = await tx.delete(schema.tasks).where(eq(schema.tasks.id, id.data)).returning();
    if (t?.contactId) await logEvent(tx, { contactId: t.contactId, actorId: scope.actorId, type: "task_deleted", data: { title: t.title } });
    return t?.contactId ?? null;
  });
  refresh(contactId);
  return { ok: true, message: "Tarefa excluída." };
}

export async function reopenTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("tarefas.ver");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  const contactId = await runCrm(ctx, async (tx) => {
    const [t] = await tx
      .update(schema.tasks)
      .set({ doneAt: null })
      .where(and(eq(schema.tasks.id, id.data), isNotNull(schema.tasks.doneAt)))
      .returning({ contactId: schema.tasks.contactId });
    return t?.contactId ?? null;
  });
  refresh(contactId);
  return { ok: true, message: "Tarefa reaberta." };
}

/**
 * AÇÕES EM LOTE e atalhos da tela de Tarefas (também usadas com uma tarefa só):
 *  - concluir / reabrir
 *  - adiar: para uma data ("2026-10-20") — usado pelo arrastar no quadro e por "amanhã", "+7 dias"
 *  - atribuir: trocar o responsável ("" = ninguém)
 *  - excluir
 * Tudo numa transação: ou todas mudam, ou nenhuma.
 */
export async function bulkTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("tarefas.ver");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({
      ids: z.array(z.uuid()).min(1, "Escolha ao menos uma tarefa.").max(300),
      op: z.enum(["concluir", "reabrir", "adiar", "atribuir", "excluir"]),
      dueDate: z.iso.date().optional(),
      assigneeId: z.union([z.uuid(), z.literal("")]).optional(),
    })
    .safeParse({ ids: form.getAll("id"), op: field(form, "op"), dueDate: field(form, "dueDate") || undefined, assigneeId: field(form, "assigneeId") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { ids, op, dueDate } = parsed.data;
  // Editar/excluir exige permissão de edição; concluir/reabrir vale para quem vê (como antes)
  if ((op === "adiar" || op === "atribuir" || op === "excluir") && !ctx.can("pacientes.editar")) return NOT_ALLOWED;
  if (op === "adiar" && !dueDate) return { ok: false, message: "Escolha a nova data." };

  let assigneeName: string | null = null;
  try {
    await runCrm(ctx, async (tx, scope) => {
      if (op === "atribuir" && parsed.data.assigneeId) {
        const [u] = await tx.select({ name: schema.clinicUsers.name, active: schema.clinicUsers.active }).from(schema.clinicUsers).where(eq(schema.clinicUsers.id, parsed.data.assigneeId));
        if (!u?.active) throw new UserError("Responsável não encontrado ou desativado.");
        assigneeName = u.name;
      }
      const where = inArray(schema.tasks.id, ids);
      if (op === "concluir") {
        const done = await tx.update(schema.tasks).set({ doneAt: new Date() }).where(and(where, isNull(schema.tasks.doneAt))).returning();
        for (const t of done) if (t.contactId) await logEvent(tx, { contactId: t.contactId, actorId: scope.actorId, type: "task_done", data: { title: t.title } });
      }
      if (op === "reabrir") await tx.update(schema.tasks).set({ doneAt: null }).where(where);
      if (op === "adiar") await tx.update(schema.tasks).set({ dueDate: dueDate! }).where(where);
      if (op === "atribuir") await tx.update(schema.tasks).set({ assigneeId: parsed.data.assigneeId || null }).where(where);
      if (op === "excluir") {
        const gone = await tx.delete(schema.tasks).where(where).returning();
        for (const t of gone) if (t.contactId) await logEvent(tx, { contactId: t.contactId, actorId: scope.actorId, type: "task_deleted", data: { title: t.title } });
      }
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  revalidatePath("/crm/contatos", "layout");
  const n = ids.length;
  const s = n === 1 ? "" : "s";
  // Funções (e não textos prontos): só a mensagem da operação feita é montada
  const messages = {
    concluir: () => `${n} tarefa${s} concluída${s}.`,
    reabrir: () => `${n} tarefa${s} reaberta${s}.`,
    adiar: () => `${n} tarefa${s} para ${(dueDate ?? "").split("-").reverse().join("/")}.`,
    atribuir: () => (assigneeName ? `${n} tarefa${s} agora com ${assigneeName}.` : `${n} tarefa${s} sem responsável.`),
    excluir: () => `${n} tarefa${s} excluída${s}.`,
  };
  return { ok: true, message: messages[op](), data: { op, ids } };
}
