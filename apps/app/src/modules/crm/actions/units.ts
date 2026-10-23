"use server";

import { roomSchema, unitSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { and, count, eq, gt, inArray, ne, schema, sql } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { authorizeClinic } from "@/lib/auth/dal";
import { field, formValues, isUniqueViolation, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { logEvent } from "../journey";
import { runCrm } from "../run";

/**
 * UNIDADES DE ATENDIMENTO E CONSULTÓRIOS (exige "Clínica e profissionais")
 *
 * Nada é apagado: unidade e consultório são DESATIVADOS (consultas e atendimentos antigos
 * continuam apontando para eles). Para desativar, não pode haver consulta futura marcada
 * ali: a recepção remarca antes (assim nenhum paciente vai ao endereço errado).
 */

function refresh() {
  revalidatePath("/configuracoes/unidades");
  revalidatePath("/configuracoes/clinica");
  revalidatePath("/crm/agenda");
  revalidatePath("/consultorio");
}

const FUTURE = ["agendado", "confirmado"] as const;

export async function saveUnitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const parsed = unitSchema.safeParse({
    id: field(form, "id"),
    name: field(form, "name"),
    address: field(form, "address"),
    district: field(form, "district"),
    city: field(form, "city"),
    state: field(form, "state"),
    zip: field(form, "zip"),
    phone: field(form, "phone"),
    cnes: field(form, "cnes"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { id, ...d } = parsed.data;
  const values = { ...d, address: d.address ?? null, district: d.district ?? null, city: d.city ?? null, state: d.state ?? null, zip: d.zip ?? null, phone: d.phone ?? null, cnes: d.cnes ?? null };
  try {
    await runCrm(ctx, async (tx, scope) => {
      if (!id) {
        const [created] = await tx.insert(schema.clinicUnits).values({ ...values, active: true }).returning({ id: schema.clinicUnits.id });
        await logEvent(tx, { actorId: scope.actorId, type: "unit_created", data: { unitId: created!.id, nome: d.name } });
        return;
      }
      const [cur] = await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.id, id));
      if (!cur) throw new UserError("Unidade não encontrada.");
      if (cur.main && !d.active) throw new UserError("A unidade principal não pode ser desativada. Torne outra unidade a principal antes.");
      if (cur.active && !d.active) {
        const [f] = await tx
          .select({ n: count() })
          .from(schema.appointments)
          .where(and(eq(schema.appointments.unitId, id), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, FUTURE)));
        if (f?.n) throw new UserError(`Há ${f.n} consulta(s) futura(s) nesta unidade. Remarque antes de desativar (o paciente não pode ir ao endereço errado).`);
        // Consultórios da unidade saem junto
        await tx.update(schema.clinicRooms).set({ active: false }).where(eq(schema.clinicRooms.unitId, id));
      }
      await tx.update(schema.clinicUnits).set(values).where(eq(schema.clinicUnits.id, id));
      await logEvent(tx, { actorId: scope.actorId, type: "unit_updated", data: { unitId: id, nome: d.name, ativa: d.active } });
    });
  } catch (error) {
    if (isUniqueViolation(error, "clinic_units_name_unique")) return { ok: false, errors: { name: "Já existe uma unidade com este nome." }, values: formValues(form) };
    return { ...toActionError(error), values: formValues(form) };
  }
  refresh();
  return { ok: true, message: id ? "Unidade atualizada." : "Unidade cadastrada. Agora cadastre os consultórios e diga, na semana de cada profissional, em que dias ele atende aqui." };
}

/** Torna outra unidade a principal (consultas sem unidade e profissionais sem unidade definida ficam nela) */
export async function setMainUnitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  try {
    await runCrm(ctx, async (tx, scope) => {
      const [u] = await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.id, id));
      if (!u || !u.active) throw new UserError("Unidade não encontrada ou desativada.");
      // Professionais com períodos "sem unidade" iam para a principal antiga: fixa a antiga neles,
      // para a troca de principal não mudar o endereço de ninguém sem querer
      const [old] = await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.main, true));
      if (old && old.id !== id) {
        const pros = await tx.select({ id: schema.professionals.id, week: schema.professionals.weeklySchedule }).from(schema.professionals);
        for (const p of pros) {
          if (!p.week) continue;
          let changed = false;
          const week = structuredClone(p.week);
          for (const day of Object.values(week)) for (const per of day?.periods ?? []) if (!per.unitId) ((per.unitId = old.id), (changed = true));
          if (changed) await tx.update(schema.professionals).set({ weeklySchedule: week }).where(eq(schema.professionals.id, p.id));
        }
      }
      // Dois passos: o índice único só permite uma principal por vez
      await tx.update(schema.clinicUnits).set({ main: false }).where(ne(schema.clinicUnits.id, id));
      await tx.update(schema.clinicUnits).set({ main: true }).where(eq(schema.clinicUnits.id, id));
      await logEvent(tx, { actorId: scope.actorId, type: "unit_main_changed", data: { unitId: id, nome: u.name } });
    });
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { ok: true, message: "Unidade principal alterada." };
}

export async function saveRoomAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeClinic("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const parsed = roomSchema.safeParse({
    id: field(form, "id"),
    unitId: field(form, "unitId"),
    name: field(form, "name"),
    kind: field(form, "kind"),
    notes: field(form, "notes"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { id, ...d } = parsed.data;
  try {
    await runCrm(ctx, async (tx, scope) => {
      const [unit] = await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.id, d.unitId));
      if (!unit?.active) throw new UserError("Unidade não encontrada ou desativada.");
      if (!id) {
        const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${schema.clinicRooms.sortOrder}), 0)::int + 1` }).from(schema.clinicRooms).where(eq(schema.clinicRooms.unitId, d.unitId))) as [{ n: number }];
        await tx.insert(schema.clinicRooms).values({ ...d, notes: d.notes ?? null, active: true, sortOrder: n });
        await logEvent(tx, { actorId: scope.actorId, type: "room_created", data: { nome: d.name, unidade: unit.name } });
        return;
      }
      const [cur] = await tx.select().from(schema.clinicRooms).where(eq(schema.clinicRooms.id, id));
      if (!cur) throw new UserError("Consultório não encontrado.");
      if (cur.unitId !== d.unitId) throw new UserError("Um consultório não muda de unidade. Desative este e cadastre outro na unidade nova.");
      if (cur.active && !d.active) {
        const [f] = await tx
          .select({ n: count() })
          .from(schema.appointments)
          .where(and(eq(schema.appointments.roomId, id), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, FUTURE)));
        if (f?.n) throw new UserError(`Há ${f.n} consulta(s) futura(s) neste consultório. Troque o consultório delas (Agenda > consulta > Editar detalhes) antes de desativar.`);
        // Sai da semana dos profissionais que o tinham como fixo (o Tropi passa a escolher um livre)
        const pros = await tx.select({ id: schema.professionals.id, week: schema.professionals.weeklySchedule }).from(schema.professionals);
        for (const p of pros) {
          if (!p.week) continue;
          let changed = false;
          const week = structuredClone(p.week);
          for (const day of Object.values(week)) for (const per of day?.periods ?? []) if (per.roomId === id) (delete per.roomId, (changed = true));
          if (changed) await tx.update(schema.professionals).set({ weeklySchedule: week }).where(eq(schema.professionals.id, p.id));
        }
      }
      await tx.update(schema.clinicRooms).set({ name: d.name, kind: d.kind, notes: d.notes ?? null, active: d.active }).where(eq(schema.clinicRooms.id, id));
      await logEvent(tx, { actorId: scope.actorId, type: "room_updated", data: { nome: d.name, ativo: d.active } });
    });
  } catch (error) {
    if (isUniqueViolation(error, "clinic_rooms_name_unique")) return { ok: false, errors: { name: "Já existe um consultório com este nome nesta unidade." }, values: formValues(form) };
    return { ...toActionError(error), values: formValues(form) };
  }
  refresh();
  return { ok: true, message: id ? "Consultório atualizado." : "Consultório cadastrado." };
}
