"use server";

import { CLOSURE_KINDS, nationalHolidays, validateOpeningHours, type OpeningHours } from "@ecosaude/core/crm";
import { eq, schema, withTenant } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeClinic } from "@/lib/auth/dal";
import { field, formValues, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { logEvent } from "../journey";
import { appointmentsInClosure } from "../opening";

/**
 * HORÁRIO DE FUNCIONAMENTO, FERIADOS E FECHAMENTOS (Ajustes > Unidades e consultórios).
 * Mesma permissão do cadastro de unidades: "Clínica e profissionais" (config.clinica).
 *
 * Fechamento NÃO cancela consultas: quem cadastra é avisado de quantas consultas já estão
 * marcadas no período, para remarcar pela Agenda (o paciente precisa ser avisado por alguém).
 */

function refresh() {
  revalidatePath("/configuracoes/unidades");
  revalidatePath("/configuracoes/clinica");
  revalidatePath("/crm/agenda");
  revalidatePath("/hoje");
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");
// partialRecord: no zod 4, record com chaves enum exige TODOS os dias; aqui dia ausente = fechado
const hoursSchema = z.partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.object({ periods: z.array(z.object({ start: HHMM, end: HHMM })).max(4) }));

/** Salva o horário de uma unidade. `inherit` (só para as não principais) volta a usar o da principal. */
export async function saveOpeningHoursAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const unitId = field(form, "unitId");
  if (!z.uuid().safeParse(unitId).success) return { ok: false, message: "Unidade inválida." };
  const inherit = field(form, "inherit") === "on";
  let hours: OpeningHours | null = null;
  if (!inherit) {
    let raw: unknown;
    try {
      raw = JSON.parse(field(form, "hours") || "{}");
    } catch {
      return { ok: false, message: "Horário inválido." };
    }
    const parsed = hoursSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: "Confira os horários: use o formato 08:00." };
    // Dias sem período ficam fora do objeto (= não abre)
    hours = Object.fromEntries(Object.entries(parsed.data).filter(([, d]) => d && d.periods.length)) as OpeningHours;
    const errors = validateOpeningHours(hours);
    if (errors.length) return { ok: false, message: `Confira: ${errors.join("; ")}.` };
  }
  try {
    await withTenant(ctx.user.clinicId, async (tx) => {
      const [unit] = await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.id, unitId));
      if (!unit) throw new UserError("Unidade não encontrada.");
      if (unit.main && inherit) throw new UserError("A unidade principal tem o horário da clínica: defina os dias e horários.");
      await tx.update(schema.clinicUnits).set({ openingHours: hours }).where(eq(schema.clinicUnits.id, unitId));
      await logEvent(tx, { actorId: ctx.user.id, type: "opening_hours_updated", data: { unidade: unit.name, herda: inherit } });
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { ok: true, message: inherit ? "A unidade volta a usar o horário da principal." : "Horário de funcionamento salvo." };
}

const closureSchema = z
  .object({
    unitId: z.union([z.literal(""), z.uuid()]),
    startsOn: z.iso.date("Data inválida"),
    endsOn: z.iso.date("Data inválida"),
    reason: z.string().trim().min(2, "Diga o motivo (ex.: Feriado municipal)").max(120),
    kind: z.enum(CLOSURE_KINDS),
  })
  .refine((d) => d.endsOn >= d.startsOn, { path: ["endsOn"], message: "O fim deve ser no mesmo dia ou depois do início" });

/** Novo feriado ou fechamento (da clínica inteira ou de uma unidade) */
export async function saveClosureAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const startsOn = field(form, "startsOn");
  const parsed = closureSchema.safeParse({ unitId: field(form, "unitId"), startsOn, endsOn: field(form, "endsOn") || startsOn, reason: field(form, "reason"), kind: field(form, "kind") || "feriado" });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { ok: false, errors, values: formValues(form) };
  }
  const d = parsed.data;
  let booked = 0;
  try {
    await withTenant(ctx.user.clinicId, async (tx) => {
      const unitId = d.unitId || null;
      await tx.insert(schema.clinicClosures).values({ unitId, startsOn: d.startsOn, endsOn: d.endsOn, reason: d.reason, kind: d.kind, createdBy: ctx.user.id });
      booked = await appointmentsInClosure(tx, { unitId, startsOn: d.startsOn, endsOn: d.endsOn });
      await logEvent(tx, { actorId: ctx.user.id, type: "closure_created", data: { motivo: d.reason, de: d.startsOn, ate: d.endsOn, unidade: unitId } });
    });
  } catch (error) {
    return { ...toActionError(error), values: formValues(form) };
  }
  refresh();
  return {
    ok: true,
    message: booked
      ? `Fechamento salvo. Atenção: ${booked} consulta(s) já marcada(s) nesse período. Remarque pela Agenda e avise os pacientes.`
      : "Fechamento salvo. Os horários desses dias saem da agenda livre.",
  };
}

export async function deleteClosureAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Fechamento inválido." };
  try {
    await withTenant(ctx.user.clinicId, async (tx) => {
      const [c] = await tx.delete(schema.clinicClosures).where(eq(schema.clinicClosures.id, id)).returning();
      if (!c) throw new UserError("Fechamento não encontrado.");
      await logEvent(tx, { actorId: ctx.user.id, type: "closure_deleted", data: { motivo: c.reason, de: c.startsOn, ate: c.endsOn } });
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { ok: true, message: "Fechamento removido: os horários desses dias voltam para a agenda." };
}

/**
 * Traz os feriados nacionais do ano (para a clínica inteira). Trazer de novo não duplica.
 * Pontos facultativos (Carnaval, Corpus Christi) só com a caixa marcada.
 */
export async function importHolidaysAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const year = Number(field(form, "year"));
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < thisYear || year > thisYear + 2) return { ok: false, message: "Escolha o ano." };
  const optional = field(form, "optional") === "on";
  let added = 0;
  let booked = 0;
  try {
    await withTenant(ctx.user.clinicId, async (tx) => {
      for (const h of nationalHolidays(year, { optional })) {
        const rows = await tx
          .insert(schema.clinicClosures)
          .values({ unitId: null, startsOn: h.date, endsOn: h.date, reason: h.name, kind: "feriado", national: true, createdBy: ctx.user.id })
          .onConflictDoNothing()
          .returning({ id: schema.clinicClosures.id });
        if (rows.length) {
          added++;
          booked += await appointmentsInClosure(tx, { unitId: null, startsOn: h.date, endsOn: h.date });
        }
      }
      if (added) await logEvent(tx, { actorId: ctx.user.id, type: "holidays_imported", data: { ano: year, feriados: added, facultativos: optional } });
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  if (!added) return { ok: true, message: `Os feriados nacionais de ${year} já estavam cadastrados.` };
  return {
    ok: true,
    message: `${added} feriado(s) de ${year} cadastrado(s).${booked ? ` Atenção: ${booked} consulta(s) já marcada(s) nesses dias. Remarque pela Agenda.` : ""}`,
  };
}

