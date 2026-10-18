import "server-only";
import {
  ADMIN_PERMISSIONS,
  CLINIC_ROLE_LABEL,
  CLINIC_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  effectivePermissions,
  ROLE_DESCRIPTION,
  type ClinicPermission,
  type ClinicRole,
} from "@ecosaude/core/crm";
import { asc, eq, schema, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";

/**
 * PERFIS E PERMISSÕES (regras de servidor)
 *
 *  - ensureSystemRoles: clínicas criadas depois da migração ganham os 3 perfis
 *    do sistema na primeira vez que alguém abre a equipe.
 *  - teamAccess: cada pessoa com o perfil e as permissões efetivas.
 *  - assertAdminRemains: depois de QUALQUER mudança de acesso, confere que ainda
 *    existe alguém ativo que administra a equipe e as permissões. Roda dentro
 *    da mesma transação: se a regra falhar, a mudança é desfeita.
 *  - assertCanAssign: quem não administra permissões só pode dar a outra pessoa
 *    um perfil que não tenha mais poderes que o próprio (sem escalada de acesso).
 */

export type RoleRow = typeof schema.clinicRoles.$inferSelect;

export async function ensureSystemRoles(tx: Tx): Promise<void> {
  await tx
    .insert(schema.clinicRoles)
    .values(
      CLINIC_ROLES.map((key) => ({
        name: CLINIC_ROLE_LABEL[key],
        description: ROLE_DESCRIPTION[key],
        base: key,
        systemKey: key,
        permissions: [...DEFAULT_ROLE_PERMISSIONS[key]],
      })),
    )
    .onConflictDoNothing();
}

export async function listRoles(tx: Tx): Promise<RoleRow[]> {
  await ensureSystemRoles(tx);
  const rows = await tx.select().from(schema.clinicRoles).orderBy(asc(schema.clinicRoles.createdAt));
  // Perfis do sistema primeiro, na ordem gestor, recepção, profissional
  const order = (r: RoleRow) => (r.systemKey ? CLINIC_ROLES.indexOf(r.systemKey) : 10);
  return rows.sort((a, b) => order(a) - order(b));
}

export interface TeamAccess {
  id: string;
  name: string;
  active: boolean;
  base: ClinicRole;
  roleId: string | null;
  roleName: string;
  grants: string[];
  revokes: string[];
  permissions: ClinicPermission[];
}

/** Perfil efetivo de uma pessoa: o escolhido ou o do sistema do mesmo nível. */
export function roleFor(user: { roleId: string | null; role: ClinicRole }, roles: RoleRow[]): RoleRow | undefined {
  return roles.find((r) => r.id === user.roleId) ?? roles.find((r) => r.systemKey === user.role);
}

export async function teamAccess(tx: Tx, roles?: RoleRow[]): Promise<TeamAccess[]> {
  const allRoles = roles ?? (await listRoles(tx));
  const users = await tx
    .select({
      id: schema.clinicUsers.id,
      name: schema.clinicUsers.name,
      active: schema.clinicUsers.active,
      role: schema.clinicUsers.role,
      roleId: schema.clinicUsers.roleId,
      grants: schema.clinicUsers.permissionGrants,
      revokes: schema.clinicUsers.permissionRevokes,
    })
    .from(schema.clinicUsers)
    .orderBy(asc(schema.clinicUsers.name));
  return users.map((u) => {
    const role = roleFor(u, allRoles);
    return {
      id: u.id,
      name: u.name,
      active: u.active,
      base: u.role,
      roleId: role?.id ?? null,
      roleName: role?.name ?? CLINIC_ROLE_LABEL[u.role],
      grants: u.grants,
      revokes: u.revokes,
      permissions: effectivePermissions({ rolePermissions: role?.permissions, baseRole: u.role, grants: u.grants, revokes: u.revokes }),
    };
  });
}

/** Lança erro (e a transação é desfeita) se ninguém ativo puder mais administrar a clínica. */
export async function assertAdminRemains(tx: Tx): Promise<void> {
  const team = await teamAccess(tx);
  const admins = team.filter((u) => u.active && ADMIN_PERMISSIONS.every((p) => u.permissions.includes(p)));
  if (admins.length === 0) {
    throw new UserError("Pelo menos uma pessoa ativa precisa continuar com “Acessos da equipe” e “Perfis e permissões”. Senão ninguém mais conseguiria administrar a clínica.");
  }
}

/**
 * Quem tem "config.equipe" mas não "config.permissoes" (ex.: coordenação) pode
 * criar acessos, mas só com perfis que não passem dos próprios poderes.
 */
export function assertCanAssign(actorPermissions: readonly string[], role: RoleRow): void {
  if (actorPermissions.includes("config.permissoes")) return;
  const extra = role.permissions.filter((p) => !actorPermissions.includes(p));
  if (extra.length) throw new UserError(`O perfil “${role.name}” tem permissões que o seu não tem. Peça a quem administra as permissões.`);
}

export async function roleById(tx: Tx, id: string): Promise<RoleRow> {
  // RLS: só encontra perfis da própria clínica
  const [role] = await tx.select().from(schema.clinicRoles).where(eq(schema.clinicRoles.id, id));
  if (!role) throw new UserError("Perfil não encontrado.");
  return role;
}
