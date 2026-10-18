"use server";

import { isClinicPermission, normalizePermissions, ROLE_PRESETS, type ClinicPermission } from "@ecosaude/core/crm";
import { clinicRoleSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { count, eq, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, formValues, isUniqueViolation, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { logEvent } from "../journey";
import { assertAdminRemains, ensureSystemRoles, roleById } from "../permissions";
import { runCrm } from "../run";

/**
 * PERFIS E PERMISSÕES (exige "config.permissoes")
 *
 *  - saveRoleAction: cria ou altera um perfil (nome, descrição, nível, permissões)
 *  - deleteRoleAction: exclui um cargo criado pela clínica, movendo as pessoas
 *  - setUserAccessAction: perfil + ajuste fino (liberar/bloquear) de UMA pessoa
 *
 * Toda mudança roda numa transação que termina conferindo que ainda há quem
 * administre a clínica (assertAdminRemains). Se não houver, nada é gravado.
 */

function refresh() {
  revalidatePath("/configuracoes/perfis");
  revalidatePath("/configuracoes/equipe");
  // O menu de quem teve o acesso alterado muda na próxima tela aberta
  revalidatePath("/", "layout");
}

/** Permissões marcadas no formulário (caixas name="perm" value="agenda.ver"). */
function checkedPermissions(form: FormData): ClinicPermission[] {
  return normalizePermissions(form.getAll("perm").filter((v): v is string => typeof v === "string"));
}

export async function saveRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.permissoes");
  if (!ctx) return NOT_ALLOWED;
  const parsed = clinicRoleSchema.safeParse({ id: field(form, "id"), name: field(form, "name"), description: field(form, "description"), base: field(form, "base") || "recepcao" });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;
  // Novo perfil a partir de um modelo pronto: as permissões vêm do modelo
  const preset = ROLE_PRESETS.find((p) => p.id === field(form, "preset"));
  const copyFrom = field(form, "copyFrom");
  let permissions = checkedPermissions(form);

  try {
    const saved = await runCrm(ctx, async (tx, scope) => {
      await ensureSystemRoles(tx);
      if (!d.id && preset) permissions = [...preset.permissions];
      if (!d.id && copyFrom) permissions = normalizePermissions((await roleById(tx, copyFrom)).permissions);

      let roleId: string;
      if (d.id) {
        const current = await roleById(tx, d.id);
        // O nível (base) dos perfis do sistema não muda: eles representam gestão, recepção e profissional
        const base = current.systemKey ?? d.base;
        await tx.update(schema.clinicRoles).set({ name: d.name, description: d.description, base, permissions }).where(eq(schema.clinicRoles.id, d.id));
        // O nível de referência das pessoas acompanha o perfil
        await tx.update(schema.clinicUsers).set({ role: base }).where(eq(schema.clinicUsers.roleId, d.id));
        roleId = d.id;
      } else {
        const [created] = await tx
          .insert(schema.clinicRoles)
          .values({ name: d.name, description: d.description ?? preset?.description ?? null, base: preset?.base ?? d.base, permissions })
          .returning({ id: schema.clinicRoles.id });
        roleId = created!.id;
      }
      await assertAdminRemains(tx);
      await logEvent(tx, { actorId: scope.actorId, type: d.id ? "role_updated" : "role_created", data: { perfil: d.name, permissoes: permissions.length } });
      return roleId;
    });
    refresh();
    return { ok: true, message: d.id ? `Perfil “${d.name}” salvo.` : `Perfil “${d.name}” criado.`, data: { id: saved } };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, errors: { name: "Já existe um perfil com este nome." }, values: formValues(form) };
    return { ...toActionError(error), values: formValues(form) };
  }
}

export async function deleteRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.permissoes");
  if (!ctx) return NOT_ALLOWED;
  const ids = z.object({ id: z.uuid(), moveTo: z.union([z.uuid(), z.literal("")]) }).safeParse({ id: field(form, "id"), moveTo: field(form, "moveTo") });
  if (!ids.success) return { ok: false, message: "Inválido." };
  try {
    const name = await runCrm(ctx, async (tx, scope) => {
      const role = await roleById(tx, ids.data.id);
      if (role.systemKey) throw new UserError("Os perfis do sistema não podem ser excluídos (dá para mudar as permissões deles).");
      const [people] = await tx.select({ n: count() }).from(schema.clinicUsers).where(eq(schema.clinicUsers.roleId, role.id));
      if (people && people.n > 0) {
        if (!ids.data.moveTo || ids.data.moveTo === role.id) throw new UserError(`Escolha para qual perfil vão as ${people.n} pessoas com “${role.name}”.`);
        const target = await roleById(tx, ids.data.moveTo);
        await tx.update(schema.clinicUsers).set({ roleId: target.id, role: target.base }).where(eq(schema.clinicUsers.roleId, role.id));
      }
      await tx.delete(schema.clinicRoles).where(eq(schema.clinicRoles.id, role.id));
      await assertAdminRemains(tx);
      await logEvent(tx, { actorId: scope.actorId, type: "role_deleted", data: { perfil: role.name } });
      return role.name;
    });
    refresh();
    return { ok: true, message: `Perfil “${name}” excluído.` };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Acesso de UMA pessoa: perfil + ajuste fino.
 * Cada permissão vem no formulário como access.<chave> = herdar | permitir | bloquear.
 * Só é gravado o que DIFERE do perfil (liberar o que o perfil não tem, bloquear o que tem).
 */
export async function setUserAccessAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.permissoes");
  if (!ctx) return NOT_ALLOWED;
  const ids = z.object({ id: z.uuid(), roleId: z.uuid() }).safeParse({ id: field(form, "id"), roleId: field(form, "roleId") });
  if (!ids.success) return { ok: false, message: "Escolha o perfil." };
  try {
    await runCrm(ctx, async (tx, scope) => {
      const role = await roleById(tx, ids.data.roleId);
      const has = new Set(role.permissions);
      const grants: string[] = [];
      const revokes: string[] = [];
      for (const [key, value] of form.entries()) {
        if (!key.startsWith("access.") || typeof value !== "string") continue;
        const perm = key.slice("access.".length);
        if (!isClinicPermission(perm)) continue;
        if (value === "permitir" && !has.has(perm)) grants.push(perm);
        if (value === "bloquear" && has.has(perm)) revokes.push(perm);
      }
      const rows = await tx
        .update(schema.clinicUsers)
        .set({ roleId: role.id, role: role.base, permissionGrants: normalizePermissions(grants), permissionRevokes: normalizePermissions(revokes) })
        .where(eq(schema.clinicUsers.id, ids.data.id))
        .returning({ id: schema.clinicUsers.id });
      if (!rows.length) throw new UserError("Pessoa não encontrada.");
      await assertAdminRemains(tx);
      await logEvent(tx, { actorId: scope.actorId, type: "user_access_updated", data: { userId: ids.data.id, perfilNome: role.name, liberadas: grants.length, bloqueadas: revokes.length } });
    });
    refresh();
    return { ok: true, message: "Acesso atualizado. Vale a partir da próxima tela que a pessoa abrir." };
  } catch (error) {
    return toActionError(error);
  }
}
