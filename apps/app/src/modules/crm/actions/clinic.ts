"use server";

import { clinicTimeZone, dayMinutes, effectiveHours, fitsDay, fixedRoomClashes, periodsOutsideHours, legacyFromWeekly, tightUnitChanges, unitAt, utcToZoned, validateWeekPlaces, WEEKDAY_LONG, weeklyOf, type WeeklySchedule } from "@ecosaude/core/crm";
import { absenceSchema, crmSettingsSchema, professionalSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { and, eq, gt, inArray, schema, sql } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { authorizeClinic, authorizeCrm } from "@/lib/auth/dal";
import { field, formValues, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { logEvent } from "../journey";
import { runCrm } from "../run";
import { listRooms, listUnits, mainUnit, toRoomRef, toUnitRef } from "../units";

/**
 * AJUSTES DA CLÍNICA (gestão): profissionais com seus horários e as
 * preferências do Tropi (confirmação automática).
 */

/* ------------------------------- Profissionais ------------------------------ */

export async function saveProfessionalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const parsed = professionalSchema.safeParse({
    id: field(form, "id"),
    name: field(form, "name"),
    specialty: field(form, "specialty"),
    council: field(form, "council"),
    councilNumber: field(form, "councilNumber"),
    councilUf: field(form, "councilUf"),
    color: field(form, "color"),
    slotMinutes: field(form, "slotMinutes"),
    weeklySchedule: field(form, "weeklySchedule"),
    userId: field(form, "userId"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { id, ...d } = parsed.data;
  const week = d.weeklySchedule as WeeklySchedule;
  const values = {
    ...d,
    weeklySchedule: week,
    // Resumo nas colunas antigas (primeiro início, último fim, primeiro intervalo)
    ...legacyFromWeekly(week),
    specialty: d.specialty ?? null,
    council: d.council ?? null,
    councilNumber: d.councilNumber ?? null,
    councilUf: d.councilUf ?? null,
    userId: d.userId ?? null,
  };

  let warning = "";
  try {
    await runCrm(ctx, async (tx, scope) => {
      // ONDE atende: unidades e consultórios da semana existem, estão em uso e combinam
      const [units, rooms, main] = [await listUnits(tx), await listRooms(tx), await mainUnit(tx)];
      const placeIssues = validateWeekPlaces(week, units.map(toUnitRef), rooms.map(toRoomRef));
      if (placeIssues.length) throw new UserError(placeIssues.join(" "));
      // Avisos (não impedem): consultório fixo dividido com outro profissional e troca de unidade apertada
      const others = (await tx.select().from(schema.professionals).where(eq(schema.professionals.active, true))).filter((o) => o.id !== id);
      const clashes = fixedRoomClashes(week, others.map((o) => ({ name: o.name, week: weeklyOf(o) })));
      const roomName = new Map(rooms.map((r) => [r.id, r.name]));
      const hops = tightUnitChanges(week, main.id);
      // Período fora do funcionamento da unidade: só avisa (a semana do profissional manda nos horários)
      const byId = new Map(units.map((u) => [u.id, u]));
      const mainRow = units.find((u) => u.main) ?? null;
      const outsideHours = periodsOutsideHours(week, main.id, (u) => effectiveHours(byId.get(u), mainRow), (u) => byId.get(u)?.name ?? "a unidade");
      const notes = [
        ...clashes.slice(0, 3).map((c) => `${roomName.get(c.roomId)} também é fixo de ${c.other} na ${WEEKDAY_LONG[c.weekday]!.toLowerCase()} (${c.theirs}); quando os dois tiverem consulta no mesmo horário, a segunda vai para outro consultório livre`),
        ...hops.slice(0, 2).map((h) => `na ${WEEKDAY_LONG[h.weekday]!.toLowerCase()} há só ${h.gap} min entre ${h.from} e ${h.to} para trocar de unidade`),
        ...(outsideHours.length ? [`fora do horário de funcionamento: ${outsideHours.slice(0, 3).join(", ")}${outsideHours.length > 3 ? " e outros" : ""} (os horários continuam livres; ajuste a semana ou o horário da unidade)`] : []),
      ];
      if (notes.length) warning += ` Atenção: ${notes.join("; ")}.`;

      if (!id) {
        const [created] = await tx.insert(schema.professionals).values(values).returning({ id: schema.professionals.id });
        await logEvent(tx, { actorId: scope.actorId, type: "professional_created", data: { professionalId: created!.id, nome: d.name } });
        return;
      }

      // Consultas futuras deste profissional: não podem "sumir" da agenda
      const future = await tx
        .select({ startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt, unitId: schema.appointments.unitId })
        .from(schema.appointments)
        .where(and(eq(schema.appointments.professionalId, id), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])));
      if (!d.active && future.length) {
        throw new UserError(`Há ${future.length} consulta(s) futura(s) com este profissional. Remarque ou cancele antes de desativar.`);
      }

      const rows = await tx.update(schema.professionals).set(values).where(eq(schema.professionals.id, id)).returning({ id: schema.professionals.id });
      if (rows.length === 0) throw new UserError("Profissional não encontrado.");
      await logEvent(tx, { actorId: scope.actorId, type: "professional_updated", data: { professionalId: id, nome: d.name } });

      // Mudou o horário? Avisa quais consultas já marcadas ficaram fora do novo expediente
      const outside = future.filter((a) => {
        const z = utcToZoned(a.startsAt);
        const start = z.minutes;
        const end = start + Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
        return !fitsDay(dayMinutes(week, z.weekday, d.slotMinutes), start, end).ok;
      });
      // Mudou a unidade de algum período? Consultas já marcadas continuam no endereço antigo: avisa
      const moved = future.filter((a) => {
        const z = utcToZoned(a.startsAt);
        const end = z.minutes + Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
        return a.unitId !== unitAt(week, z.weekday, z.minutes, end, main.id);
      });
      if (moved.length && units.length > 1) {
        warning += ` Atenção: ${moved.length} consulta(s) já marcada(s) continuam na unidade antiga. Remarque ou avise o paciente do novo endereço.`;
      }
      if (outside.length) {
        warning += ` Atenção: ${outside.length} consulta(s) já marcada(s) ficaram fora do novo horário. Elas continuam valendo; remarque se precisar.`;
      }
    });
  } catch (error) {
    return { ...toActionError(error), values: formValues(form) };
  }
  revalidatePath("/configuracoes/clinica");
  revalidatePath("/crm/agenda");
  revalidatePath("/", "layout");
  return { ok: true, message: (id ? "Profissional atualizado." : "Profissional cadastrado.") + warning };
}

/* ------------------------- Ausências (férias, folgas) ------------------------ */

/**
 * Registra uma ausência. Não cancela consultas: avisa quantas já estão
 * marcadas no período, para a recepção remarcar.
 */
export async function saveAbsenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const parsed = absenceSchema.safeParse({ professionalId: field(form, "professionalId"), startsOn: field(form, "startsOn"), endsOn: field(form, "endsOn"), reason: field(form, "reason") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;
  try {
    const clash = await runCrm(ctx, async (tx, scope) => {
      const pro = await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, d.professionalId), columns: { name: true } });
      if (!pro) throw new UserError("Profissional não encontrado.");
      await tx.insert(schema.professionalAbsences).values({ ...d, reason: d.reason ?? null, createdBy: scope.actorId });
      await logEvent(tx, { actorId: scope.actorId, type: "professional_absence", data: { professionalId: d.professionalId, nome: pro.name, de: d.startsOn, ate: d.endsOn, motivo: d.reason ?? null } });
      // Consultas já marcadas nesses dias (fuso da clínica)
      const [row] = await tx
        .execute<{ n: number }>(
          sql`
        select count(*)::int as n from appointments
         where professional_id = ${d.professionalId}
           and status in ('agendado', 'confirmado')
           and (starts_at at time zone ${clinicTimeZone()})::date between ${d.startsOn}::date and ${d.endsOn}::date`,
        )
        .then((r) => r.rows);
      return row?.n ?? 0;
    });
    revalidatePath("/configuracoes/clinica");
    revalidatePath("/crm/agenda");
    return {
      ok: true,
      message: clash
        ? `Ausência registrada. Atenção: ${clash} consulta(s) já marcada(s) nesses dias continuam valendo; remarque pela agenda.`
        : "Ausência registrada. Esses dias não terão horários livres.",
    };
  } catch (error) {
    return { ...toActionError(error), values: formValues(form) };
  }
}

export async function deleteAbsenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "Inválido." };
  await runCrm(ctx, async (tx, scope) => {
    const rows = await tx.delete(schema.professionalAbsences).where(eq(schema.professionalAbsences.id, id)).returning({ professionalId: schema.professionalAbsences.professionalId });
    if (rows.length) await logEvent(tx, { actorId: scope.actorId, type: "professional_absence_removed", data: { professionalId: rows[0]!.professionalId } });
  });
  revalidatePath("/configuracoes/clinica");
  revalidatePath("/crm/agenda");
  return { ok: true, message: "Ausência removida." };
}

/* --------------------------- Preferências do Tropi ----------------------------- */

export async function saveCrmSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.automacoes");
  if (!ctx) return NOT_ALLOWED;
  const parsed = crmSettingsSchema.safeParse({
    autoConfirm: form.get("autoConfirm") === "on",
    confirmHour: field(form, "confirmHour"),
    confirmDaysBefore: field(form, "confirmDaysBefore"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  await runCrm(ctx, async (tx, scope) => {
    // Uma linha por clínica: cria na primeira vez, atualiza depois
    await tx
      .insert(schema.crmSettings)
      .values(parsed.data)
      .onConflictDoUpdate({ target: schema.crmSettings.clinicId, set: { ...parsed.data, updatedAt: new Date() } });
    await logEvent(tx, { actorId: scope.actorId, type: "crm_settings_updated", data: parsed.data });
  });
  revalidatePath("/configuracoes/clinica");
  return { ok: true, message: "Preferências salvas." };
}
