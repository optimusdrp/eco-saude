import { asc, schema, withTenant } from "@ecosaude/db";
import { UserCog } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/server";
import { buttonStyles } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { ago } from "@/modules/crm/format";
import { listRoles, teamAccess } from "@/modules/crm/permissions";
import { listUnits } from "@/modules/crm/units";
import { NewUserButton } from "../forms";
import { TeamDirectory, type TeamMember } from "./TeamDirectory";

export const metadata: Metadata = { title: "Equipe" };
export const dynamic = "force-dynamic";

/**
 * EQUIPE (exige "config.equipe")
 *  - quantas pessoas ativas em cada perfil
 *  - diretório com busca e filtros (ativos / atenção / desativados / perfil)
 *  - por pessoa: editar, nova senha, 2 etapas, desativar e, para quem
 *    administra permissões, o ACESSO (perfil + liberar/bloquear só para ela)
 */
export default async function TeamPage() {
  const ctx = await requireCrm("config.equipe");
  const current = now();
  const { users, roles, access, units } = await withTenant(ctx.user.clinicId, async (tx) => {
    const roles = await listRoles(tx);
    const units = (await listUnits(tx)).filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
    const access = await teamAccess(tx, roles);
    const users = await tx
      .select({
        id: schema.clinicUsers.id,
        email: schema.clinicUsers.email,
        mustChangePassword: schema.clinicUsers.mustChangePassword,
        totpEnabled: schema.clinicUsers.totpEnabled,
        lastLoginAt: schema.clinicUsers.lastLoginAt,
        lockedUntil: schema.clinicUsers.lockedUntil,
      })
      .from(schema.clinicUsers)
      .orderBy(asc(schema.clinicUsers.name));
    return { users, roles, access, units };
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const members: TeamMember[] = access.map((a) => {
    const u = byId.get(a.id)!;
    const locked = !!u.lockedUntil && u.lockedUntil > current;
    return {
      id: a.id,
      name: a.name,
      email: u.email,
      role: a.base,
      roleId: a.roleId,
      roleName: a.roleName,
      grants: a.grants,
      revokes: a.revokes,
      permissionCount: a.permissions.length,
      active: a.active,
      temp: u.mustChangePassword,
      totp: u.totpEnabled,
      locked,
      lastLogin: u.lastLoginAt ? `Último acesso ${ago(u.lastLoginAt, current.getTime())}` : "Nunca acessou",
      isMe: a.id === ctx.user.id,
      attention: !u.totpEnabled || u.mustChangePassword || locked,
      healthProfessional: a.healthProfessional,
      unitIds: a.unitIds,
      health: a.health,
      linkedProfessional: a.linkedProfessional,
    };
  });
  const active = members.filter((m) => m.active);
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name, description: r.description ?? "", permissions: r.permissions }));
  // Contagem por perfil (só os perfis em uso aparecem no resumo)
  const perRole = roles.map((r) => ({ id: r.id, name: r.name, n: active.filter((m) => m.roleId === r.id).length })).filter((r) => r.n > 0);

  return (
    <>
      <PageHeader
        title="Equipe"
        description="Cada pessoa tem o próprio acesso: a atividade mostra quem fez o quê."
        actions={
          <>
            {ctx.can("config.permissoes") ? (
              <Link href="/configuracoes/perfis" className={buttonStyles("secondary")}>
                <UserCog className="size-4" aria-hidden /> Perfis e permissões
              </Link>
            ) : null}
            <NewUserButton roles={roleOptions} />
          </>
        }
      />

      <dl className="mb-5 flex flex-wrap gap-2">
        <Stat label="Acessos ativos" value={active.length} strong />
        {perRole.map((r) => (
          <Stat key={r.id} label={r.name} value={r.n} />
        ))}
      </dl>

      <TeamDirectory members={members} roles={roleOptions} canAccess={ctx.can("config.permissoes")} units={units} />
    </>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? "min-w-32 rounded-xl bg-night px-3 py-2 text-white" : "min-w-32 rounded-xl bg-paper px-3 py-2 ring-1 ring-line"}>
      <dt className={strong ? "truncate text-xs text-white/75" : "truncate text-xs text-ink-soft"}>{label}</dt>
      <dd className="font-display text-2xl font-bold tabular">{value}</dd>
    </div>
  );
}
