"use server";

import { CRM_FEATURES, zonedToUtc } from "@ecosaude/core/crm";
import { appointmentDetailsSchema, appointmentSchema, appointmentStatusSchema, rescheduleSchema, waitlistSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { and, eq, inArray, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, formValues, NOT_ALLOWED, toActionError, type ActionState } from "@/lib/server";
import { recordScheduleOutcome } from "../ai/schedule";
import { logEvent } from "../journey";
import { runCrm } from "../run";
import {
  cancelOffer,
  changeAppointmentStatus,
  createAppointment,
  expireOffers,
  finishAppointment,
  offerSlot,
  requestConfirmations,
  rescheduleAppointment,
  ScheduleWarning,
  updateAppointmentDetails,
} from "../scheduling";

/**
 * Ações da agenda. Padrão de todas as actions do CRM:
 *  1. authorizeCrm(permissão, funcionalidade) -> sem acesso, para aqui
 *  2. validar com zod (o navegador pode ser burlado; o servidor não)
 *  3. runCrm: transação isolada na clínica + despacho das mensagens
 *  4. revalidatePath: as telas mostram o dado novo
 */

function refreshAgenda() {
  revalidatePath("/crm/agenda");
  revalidatePath("/crm/espera");
  revalidatePath("/hoje");
  revalidatePath("/crm/jornada");
}

export async function createAppointmentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("agenda.editar");
  if (!ctx) return NOT_ALLOWED;

  const parsed = appointmentSchema.safeParse({
    contactId: field(form, "contactId"),
    professionalId: field(form, "professionalId"),
    date: field(form, "date"),
    time: field(form, "time"),
    service: field(form, "service"),
    notes: field(form, "notes"),
    source: field(form, "source") || "recepcao",
    notifyConversationId: field(form, "notifyConversationId"),
    durationMinutes: field(form, "durationMinutes"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const data = parsed.data;

  try {
    // Veio do "Agendar pelo pedido" (IA ou regras)? Guarda se virou consulta e se usou o horário sugerido
    const aiSuggestionId = z.uuid().safeParse(field(form, "aiSuggestionId"));
    const appt = await runCrm(
      ctx,
      async (tx, scope) => {
        const startsAt = zonedToUtc(data.date, data.time);
        const created = await createAppointment(tx, scope, {
          contactId: data.contactId,
          professionalId: data.professionalId,
          startsAt,
          service: data.service,
          notes: data.notes,
          source: data.source,
          notifyConversationId: form.get("notify") === "on" ? data.notifyConversationId : undefined,
          durationMinutes: data.durationMinutes,
          force: form.get("force") === "on",
        });
        if (aiSuggestionId.success) await recordScheduleOutcome(tx, aiSuggestionId.data, created.id, startsAt);
        return created;
      },
      { dispatch: true },
    );
    refreshAgenda();
    if (data.notifyConversationId) revalidatePath(`/crm/conversas/${data.notifyConversationId}`);
    revalidatePath(`/crm/contatos/${data.contactId}`);
    return { ok: true, message: "Consulta marcada.", data: { appointmentId: appt.id } };
  } catch (error) {
    return warningOrError(error, form);
  }
}

export async function changeAppointmentStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("agenda.editar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = appointmentStatusSchema.safeParse({
    id: field(form, "id"),
    status: field(form, "status"),
    reason: field(form, "reason"),
    version: field(form, "version"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error) };
  // Cancelar é uma permissão à parte (libera o horário para outra pessoa)
  if (parsed.data.status === "cancelado" && !ctx.can("agenda.cancelar")) return { ok: false, message: "Seu perfil não pode cancelar consultas." };

  try {
    const result = await runCrm(ctx, (tx, scope) => changeAppointmentStatus(tx, scope, parsed.data), { dispatch: true });
    refreshAgenda();
    return {
      ok: true,
      message: result.npsQueued ? "Status atualizado. Pesquisa de satisfação enviada ao paciente." : "Status atualizado.",
      // Horário liberado: a tela oferece para a lista de espera
      data: result.freed && ctx.has(CRM_FEATURES.waitlist) ? { freed: result.freed } : undefined,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function requestConfirmationsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("agenda.confirmacoes", CRM_FEATURES.confirmations);
  if (!ctx) return NOT_ALLOWED;
  const ids = z.array(z.uuid()).safeParse(form.getAll("appointmentId"));
  if (!ids.success || ids.data.length === 0) return { ok: false, message: "Nenhuma consulta escolhida." };
  try {
    const { sent, skipped } = await runCrm(ctx, (tx, scope) => requestConfirmations(tx, scope, ids.data), { dispatch: true });
    refreshAgenda();
    revalidatePath("/crm/conversas");
    const skippedText = skipped.length ? ` Não enviado para: ${skipped.join(", ")}.` : "";
    return { ok: sent > 0, message: sent ? `Pedido de confirmação enviado para ${sent} ${sent === 1 ? "paciente" : "pacientes"}.${skippedText}` : `Nada a enviar.${skippedText}` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function offerSlotAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("espera.gerir", CRM_FEATURES.waitlist);
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({
      professionalId: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      originAppointmentId: z.union([z.uuid(), z.literal("")]).optional(),
      entryIds: z.array(z.uuid()),
    })
    .safeParse({
      professionalId: field(form, "professionalId"),
      startsAt: field(form, "startsAt"),
      endsAt: field(form, "endsAt"),
      originAppointmentId: field(form, "originAppointmentId"),
      entryIds: form.getAll("entryId"),
    });
  if (!parsed.success) return { ok: false, message: "Escolha os pacientes da lista." };
  const d = parsed.data;
  try {
    const result = await runCrm(
      ctx,
      async (tx, scope) => {
        await expireOffers(tx);
        return offerSlot(tx, scope, {
          professionalId: d.professionalId,
          startsAt: new Date(d.startsAt),
          endsAt: new Date(d.endsAt),
          originAppointmentId: d.originAppointmentId || undefined,
          entryIds: d.entryIds,
        });
      },
      { dispatch: true },
    );
    refreshAgenda();
    revalidatePath("/crm/conversas");
    return { ok: true, message: `Horário oferecido a ${result.offered.join(", ")}. Quem responder SIM primeiro fica com ele.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function addToWaitlistAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("espera.gerir", CRM_FEATURES.waitlist);
  if (!ctx) return NOT_ALLOWED;
  const parsed = waitlistSchema.safeParse({
    contactId: field(form, "contactId"),
    professionalId: field(form, "professionalId"),
    period: field(form, "period") || "qualquer",
    notes: field(form, "notes"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const updated = await runCrm(ctx, async (tx, scope) => {
    // Evita a mesma pessoa duas vezes na lista. Já está? Atualiza SEM perder o lugar na fila.
    const [existing] = await tx
      .select({ id: schema.waitlistEntries.id })
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.contactId, parsed.data.contactId), inArray(schema.waitlistEntries.status, ["aguardando", "oferecido"])));
    if (existing) {
      await tx
        .update(schema.waitlistEntries)
        .set({ professionalId: parsed.data.professionalId ?? null, period: parsed.data.period, notes: parsed.data.notes ?? null })
        .where(eq(schema.waitlistEntries.id, existing.id));
      return true;
    }
    await tx.insert(schema.waitlistEntries).values({
      contactId: parsed.data.contactId,
      professionalId: parsed.data.professionalId ?? null,
      period: parsed.data.period,
      notes: parsed.data.notes ?? null,
    });
    await logEvent(tx, { contactId: parsed.data.contactId, actorId: scope.actorId, type: "waitlist_added" });
    return false;
  });
  refreshAgenda();
  revalidatePath(`/crm/contatos/${parsed.data.contactId}`);
  return { ok: true, message: updated ? "Preferências da lista de espera atualizadas (o lugar na fila foi mantido)." : "Paciente na lista de espera." };
}

export async function removeFromWaitlistAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("espera.gerir", CRM_FEATURES.waitlist);
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  await runCrm(ctx, (tx) => tx.update(schema.waitlistEntries).set({ status: "removido", resolvedAt: new Date() }).where(eq(schema.waitlistEntries.id, id.data)));
  refreshAgenda();
  return { ok: true, message: "Removido da lista de espera." };
}

/**
 * Remarcar consulta (mesma consulta, novo dia/horário/profissional).
 * Devolve o horário antigo liberado para a tela oferecer à lista de espera.
 */
export async function rescheduleAppointmentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("agenda.editar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = rescheduleSchema.safeParse({
    id: field(form, "id"),
    version: field(form, "version"),
    professionalId: field(form, "professionalId"),
    date: field(form, "date"),
    time: field(form, "time"),
    notify: form.get("notify") === "on",
    durationMinutes: field(form, "durationMinutes"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;
  try {
    const result = await runCrm(
      ctx,
      (tx, scope) =>
        rescheduleAppointment(tx, scope, {
          id: d.id,
          version: d.version,
          professionalId: d.professionalId,
          startsAt: zonedToUtc(d.date, d.time),
          notify: d.notify,
          durationMinutes: d.durationMinutes,
          force: form.get("force") === "on",
        }),
      { dispatch: true },
    );
    refreshAgenda();
    revalidatePath("/crm/conversas");
    const note = result.notified ? " Paciente avisado." : result.notifySkipped ? ` Aviso não enviado: ${result.notifySkipped}.` : "";
    return {
      ok: true,
      message: `Consulta remarcada.${note}`,
      data: result.freed && ctx.has(CRM_FEATURES.waitlist) ? { freed: result.freed } : undefined,
    };
  } catch (error) {
    return warningOrError(error, form);
  }
}

/** Aviso (fora do expediente, paciente com outra consulta): a tela mostra "marcar mesmo assim". */
function warningOrError(error: unknown, form: FormData): ActionState {
  if (error instanceof ScheduleWarning) return { ok: false, message: error.message, values: formValues(form), data: { warning: true } };
  return { ...toActionError(error), values: formValues(form) };
}

/** Corrigir serviço, observações e duração de uma consulta. */
export async function updateAppointmentDetailsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("agenda.editar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = appointmentDetailsSchema.safeParse({
    id: field(form, "id"),
    version: field(form, "version"),
    service: field(form, "service"),
    notes: field(form, "notes"),
    durationMinutes: field(form, "durationMinutes"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  try {
    await runCrm(ctx, (tx, scope) => updateAppointmentDetails(tx, scope, parsed.data));
  } catch (error) {
    return { ...toActionError(error), values: formValues(form) };
  }
  refreshAgenda();
  return { ok: true, message: "Consulta atualizada." };
}

/** Cancelar uma oferta da lista de espera que ainda está aberta. */
export async function cancelOfferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("espera.gerir", CRM_FEATURES.waitlist);
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "offerId"));
  if (!id.success) return { ok: false, message: "Inválido." };
  try {
    await runCrm(ctx, (tx, scope) => cancelOffer(tx, scope, id.data));
  } catch (error) {
    return toActionError(error);
  }
  refreshAgenda();
  return { ok: true, message: "Oferta cancelada. Os pacientes voltaram para a fila." };
}

/** "Finalizar atendimento": registra a saída do paciente (duração real). */
export async function finishAppointmentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("agenda.editar");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Consulta inválida." };
  try {
    const r = await runCrm(ctx, (tx, scope) => finishAppointment(tx, scope, id.data));
    refreshAgenda();
    return { ok: true, message: `Atendimento finalizado (${r.minutes} min).` };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Aplica a duração de um procedimento para um profissional (Ajustes > Duração das consultas).
 * Vale para os PRÓXIMOS agendamentos (o diálogo de agendar já vem com ela); nada muda nas marcadas.
 */
export async function applyDurationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const p = z
    .object({ professionalId: z.uuid(), serviceKey: z.string().max(80), serviceLabel: z.string().max(80), minutes: z.coerce.number().int().min(5).max(480), remove: z.enum(["", "1"]) })
    .safeParse({
      professionalId: field(form, "professionalId"),
      serviceKey: field(form, "serviceKey"),
      serviceLabel: field(form, "serviceLabel"),
      minutes: field(form, "minutes") || "30",
      remove: field(form, "remove"),
    });
  if (!p.success) return { ok: false, message: "Dados inválidos." };
  const d = p.data;
  await runCrm(ctx, async (tx, scope) => {
    if (d.remove) {
      await tx.delete(schema.serviceDurations).where(and(eq(schema.serviceDurations.professionalId, d.professionalId), eq(schema.serviceDurations.serviceKey, d.serviceKey)));
      return;
    }
    await tx
      .insert(schema.serviceDurations)
      .values({ professionalId: d.professionalId, serviceKey: d.serviceKey, serviceLabel: d.serviceLabel || "Sem procedimento", minutes: d.minutes, updatedBy: scope.actorId })
      .onConflictDoUpdate({
        target: [schema.serviceDurations.clinicId, schema.serviceDurations.professionalId, schema.serviceDurations.serviceKey],
        set: { minutes: d.minutes, updatedBy: scope.actorId, updatedAt: new Date() },
      });
  });
  revalidatePath("/configuracoes/duracoes");
  return { ok: true, message: d.remove ? "Voltou para a duração padrão." : `Duração de ${d.minutes} min aplicada aos próximos agendamentos.` };
}
