import { ROLE_PRESETS } from "@ecosaude/core/crm";
import { withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { listRoles, teamAccess } from "@/modules/crm/permissions";
import { RolesWorkspace, type RoleView } from "./RolesWorkspace";

export const metadata: Metadata = { title: "Perfis e permissões" };
export const dynamic = "force-dynamic";

/**
 * PERFIS E PERMISSÕES (exige "config.permissoes")
 *
 *  - Perfis (cargos): os 3 do sistema + os criados pela clínica a partir de
 *    modelos (Coordenação, Financeiro, Comercial, Enfermagem, Auditoria...).
 *  - Editor: todas as permissões agrupadas por área, com liga/desliga.
 *  - Comparar: tabela de perfis x permissões.
 * O ajuste de UMA pessoa (liberar ou bloquear algo só para ela) fica em Equipe.
 */
export default async function RolesPage({ searchParams }: { searchParams: Promise<{ perfil?: string }> }) {
  const ctx = await requireCrm("config.permissoes");
  const { perfil } = await searchParams;
  const { roles, team } = await withTenant(ctx.user.clinicId, async (tx) => {
    const roles = await listRoles(tx);
    return { roles, team: await teamAccess(tx, roles) };
  });

  const views: RoleView[] = roles.map((r) => {
    const people = team.filter((u) => u.roleId === r.id);
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      base: r.base,
      system: r.systemKey !== null,
      permissions: r.permissions,
      people: people.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, adjusted: u.grants.length + u.revokes.length > 0 })),
    };
  });

  return (
    <>
      <PageHeader
        title="Perfis e permissões"
        description={
          <>
            Cada perfil é um cargo da clínica com o que ele pode fazer. Para liberar ou bloquear algo para uma pessoa só, use{" "}
            <Link href="/configuracoes/equipe" className="font-semibold text-crm hover:underline">
              Equipe
            </Link>
            .
          </>
        }
      />
      <RolesWorkspace roles={views} presets={ROLE_PRESETS.map((p) => ({ ...p, permissions: [...p.permissions] }))} initialId={perfil ?? null} myId={ctx.user.id} />
    </>
  );
}
