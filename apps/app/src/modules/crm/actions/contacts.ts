"use server";

import { CRM_FEATURES, todayIso } from "@ecosaude/core/crm";
import { contactSchema, noteSchema, stageChangeSchema, taskSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { and, eq, isNull, schema, sql } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, formValues, isUniqueViolation, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { findDuplicatesFor } from "../duplicates";
import { logEvent, setStage } from "../journey";
import { sendReturnReminders } from "../returns";
import { runAiQueues } from "../ai/queue";
import { runCrm } from "../run";

/** Ações de pacientes/contatos, jornada, anotações, tarefas e retornos. */

/** Cadastro parecido encontrado: a tela mostra a opção "é outra pessoa, cadastrar mesmo assim". */
class DuplicateError extends UserError {}

function contactInput(form: FormData) {
  return contactSchema.safeParse({
    name: field(form, "name"),
    phone: field(form, "phone"),
    email: field(form, "email"),
    birthDate: field(form, "birthDate"),
    sex: field(form, "sex"),
    cpf: field(form, "cpf"),
    preferredChannel: field(form, "preferredChannel"),
    source: field(form, "source"),
    tags: field(form, "tags"),
    consentMarketing: form.get("consentMarketing") === "on",
    version: field(form, "version") || undefined,
  });
}

export async function createContactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = contactInput(form);
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;

  const id = await runCrm(ctx, async (tx, scope) => {
    // Já existe alguém que parece ser esta pessoa? Só cadastra se a recepção confirmar
    // que é outra pessoa (ex.: mãe e filho com o mesmo celular).
    const dups = await findDuplicatesFor(tx, { name: d.name, phone: d.phone, email: d.email, birthDate: d.birthDate });
    if (dups.length && form.get("allowDuplicate") !== "on") {
      const first = dups[0]!;
      throw new DuplicateError(`Já existe um cadastro parecido: ${first.name} (${first.reasons.join(", ")}). Abra o cadastro existente ou confirme que é outra pessoa.`);
    }
    const [c] = await tx
      .insert(schema.contacts)
      .values({
        name: d.name,
        phone: d.phone ?? null,
        email: d.email ?? null,
        birthDate: d.birthDate ?? null,
        sex: d.sex ?? null,
        cpf: d.cpf ?? null,
        preferredChannel: d.preferredChannel ?? (d.phone ? "whatsapp" : null),
        source: d.source ?? "recepção",
        tags: d.tags,
        consentMarketing: d.consentMarketing,
        consentAt: d.consentMarketing ? new Date() : null,
        ownerId: scope.actorId,
      })
      .returning({ id: schema.contacts.id });
    if (d.phone) await tx.insert(schema.contactIdentities).values({ contactId: c!.id, channel: "whatsapp", externalId: d.phone, displayName: d.name }).onConflictDoNothing();
    await logEvent(tx, { contactId: c!.id, actorId: scope.actorId, type: "contact_created", data: { origem: "cadastro" } });
    return c!.id;
  }).catch((e) => e as Error);

  if (id instanceof DuplicateError) return { ok: false, message: id.message, values: formValues(form), data: { duplicate: true } };
  if (id instanceof Error) return { ...toActionError(id), values: formValues(form) };
  revalidatePath("/crm/contatos");
  revalidatePath("/crm/jornada");
  return { ok: true, message: "Paciente cadastrado.", data: { contactId: id } };
}

export async function updateContactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  const parsed = contactInput(form);
  if (!parsed.success || !z.uuid().safeParse(id).success) {
    return { ok: false, errors: parsed.success ? {} : flattenErrors(parsed.error), values: formValues(form) };
  }
  const d = parsed.data;
  try {
    await runCrm(ctx, async (tx, scope) => {
      const before = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, id) });
      if (!before) throw new UserError("Paciente não encontrado.");
      // Controle de edição simultânea: a versão da tela precisa ser a atual
      const updated = await tx
        .update(schema.contacts)
        .set({
          name: d.name,
          phone: d.phone ?? null,
          email: d.email ?? null,
          birthDate: d.birthDate ?? null,
          sex: d.sex ?? null,
          cpf: d.cpf ?? null,
          preferredChannel: d.preferredChannel ?? null,
          source: d.source ?? null,
          tags: d.tags,
          consentMarketing: d.consentMarketing,
          consentAt: d.consentMarketing && !before.consentMarketing ? new Date() : before.consentAt,
          version: sql`${schema.contacts.version} + 1`,
        })
        .where(and(eq(schema.contacts.id, id), eq(schema.contacts.version, d.version ?? before.version)))
        .returning({ id: schema.contacts.id });
      if (updated.length === 0) throw new UserError("Este cadastro foi alterado por outra pessoa. Recarregue a página para ver a versão atual.");
      if ((d.phone ?? null) !== before.phone) {
        // Celular mudou: o número ANTIGO deixa de ser deste paciente. Sem isso,
        // lembretes poderiam ir para quem herdou o número (risco de LGPD).
        if (before.phone) {
          await tx
            .delete(schema.contactIdentities)
            .where(and(eq(schema.contactIdentities.contactId, id), eq(schema.contactIdentities.channel, "whatsapp"), eq(schema.contactIdentities.externalId, before.phone)));
        }
        if (d.phone) {
          await tx.insert(schema.contactIdentities).values({ contactId: id, channel: "whatsapp", externalId: d.phone, displayName: d.name }).onConflictDoNothing();
        }
        await logEvent(tx, { contactId: id, actorId: scope.actorId, type: "phone_changed", data: { de: before.phone, para: d.phone ?? null } });
      }
      await logEvent(tx, { contactId: id, actorId: scope.actorId, type: "contact_updated", data: { consentimento: d.consentMarketing } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: "Este telefone já está ligado a outro paciente.", values: formValues(form) };
    return { ...toActionError(error), values: formValues(form) };
  }
  revalidatePath(`/crm/contatos/${id}`);
  return { ok: true, message: "Cadastro atualizado." };
}

export async function moveStageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("jornada.editar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = stageChangeSchema.safeParse({ contactId: field(form, "contactId"), stage: field(form, "stage"), lostReason: field(form, "lostReason") });
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  if (parsed.data.stage === "perdido" && !parsed.data.lostReason) return { ok: false, errors: { lostReason: "Conte o motivo da perda." } };
  await runCrm(ctx, (tx, scope) => setStage(tx, parsed.data.contactId, parsed.data.stage, { actorId: scope.actorId, auto: false, reason: parsed.data.lostReason }));
  // Perdido: o motivo é organizado pela IA logo depois desta resposta
  if (parsed.data.stage === "perdido") after(() => runAiQueues(ctx.user.clinicId).then(() => undefined));
  revalidatePath("/crm/jornada");
  revalidatePath(`/crm/contatos/${parsed.data.contactId}`);
  return { ok: true, message: "Etapa atualizada." };
}

export async function addNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = noteSchema.safeParse({ contactId: field(form, "contactId"), body: field(form, "body"), clientId: field(form, "clientId") || undefined });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  await runCrm(ctx, (tx, scope) => logEvent(tx, { contactId: parsed.data.contactId, actorId: scope.actorId, type: "note", data: { body: parsed.data.body }, clientId: parsed.data.clientId }));
  revalidatePath(`/crm/contatos/${parsed.data.contactId}`);
  return { ok: true, message: "Anotação salva." };
}

export async function createTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("tarefas.gerir");
  if (!ctx) return NOT_ALLOWED;
  const parsed = taskSchema.safeParse({ contactId: field(form, "contactId"), title: field(form, "title"), dueDate: field(form, "dueDate") || todayIso() });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  await runCrm(ctx, (tx, scope) =>
    tx.insert(schema.tasks).values({ contactId: parsed.data.contactId ?? null, title: parsed.data.title, dueDate: parsed.data.dueDate, assigneeId: scope.actorId, createdBy: scope.actorId }),
  );
  revalidatePath("/hoje");
  if (parsed.data.contactId) revalidatePath(`/crm/contatos/${parsed.data.contactId}`);
  return { ok: true, message: "Tarefa criada." };
}

export async function completeTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("tarefas.ver");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  await runCrm(ctx, async (tx, scope) => {
    const [task] = await tx
      .update(schema.tasks)
      .set({ doneAt: new Date() })
      .where(and(eq(schema.tasks.id, id.data), isNull(schema.tasks.doneAt)))
      .returning();
    if (task?.contactId) await logEvent(tx, { contactId: task.contactId, actorId: scope.actorId, type: "task_done", data: { title: task.title } });
  });
  revalidatePath("/hoje");
  revalidatePath("/crm/tarefas");
  return { ok: true, message: "Tarefa concluída." };
}

export async function sendReturnRemindersAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("retornos.gerir", CRM_FEATURES.campaigns);
  if (!ctx) return NOT_ALLOWED;
  const pairs = form
    .getAll("pair")
    .filter((v): v is string => typeof v === "string")
    .map((v) => {
      const [contactId, protocolId] = v.split(":");
      return { contactId: contactId ?? "", protocolId: protocolId ?? "" };
    })
    .filter((p) => z.uuid().safeParse(p.contactId).success && z.uuid().safeParse(p.protocolId).success);
  if (pairs.length === 0) return { ok: false, message: "Escolha pelo menos um paciente." };
  const { sent, skipped, scheduled } = await runCrm(ctx, (tx, scope) => sendReturnReminders(tx, scope, pairs), { dispatch: true });
  // Retorno personalizado (Ajustes > IA): a IA adapta os textos logo depois desta resposta
  after(() => runAiQueues(ctx.user.clinicId).then(() => undefined));
  revalidatePath("/crm/retornos");
  revalidatePath("/hoje");
  revalidatePath("/crm/conversas");
  const skippedText = skipped.length ? ` Não enviado: ${skipped.join(", ")}.` : "";
  const scheduledText = scheduled ? ` ${scheduled} ${scheduled === 1 ? "sai" : "saem"} no melhor horário de cada paciente.` : "";
  return { ok: sent > 0, message: `${sent} ${sent === 1 ? "lembrete na fila" : "lembretes na fila"}.${scheduledText}${skippedText}` };
}

/**
 * O paciente pediu (por telefone, pessoalmente...) para VOLTAR a receber
 * mensagens depois de ter enviado SAIR. Registra quem liberou e quando.
 */
export async function resubscribeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "contactId"));
  if (!id.success) return { ok: false, message: "Inválido." };
  await runCrm(ctx, async (tx, scope) => {
    const rows = await tx
      .update(schema.contacts)
      .set({ optedOutAt: null, version: sql`${schema.contacts.version} + 1` })
      .where(eq(schema.contacts.id, id.data))
      .returning({ id: schema.contacts.id });
    if (rows.length) await logEvent(tx, { contactId: id.data, actorId: scope.actorId, type: "opt_in", data: { origem: "equipe" } });
  });
  revalidatePath(`/crm/contatos/${id.data}`);
  return { ok: true, message: "Paciente voltou a receber mensagens." };
}
