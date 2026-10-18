import { ROLE_PERMISSIONS, STAFF_ROLE_LABEL, STAFF_ROLES } from "@ecosaude/core";
import { asc, db, schema } from "@ecosaude/db";
import type { Metadata } from "next";
import { Badge, PageHeader, Panel } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { NewStaffForm, StaffRowForms } from "./forms";

export const metadata: Metadata = { title: "Equipe" };
export const dynamic = "force-dynamic";

/** Descrição curta do que cada permissão libera, para mostrar na tabela de perfis. */
const permissionLabel: Record<string, string> = {
  "leads.view": "Ver leads",
  "leads.edit": "Editar leads",
  "clinics.view": "Ver clínicas",
  "clinics.edit": "Editar clínicas",
  "subscriptions.edit": "Gerir contratações",
  "catalog.view": "Ver catálogo",
  "catalog.edit": "Editar catálogo",
  "staff.manage": "Gerir equipe",
  "audit.view": "Ver auditoria",
};

export default async function StaffPage() {
  const user = await requirePermission("staff.manage");
  const members = await db.query.staffUsers.findMany({
    orderBy: [asc(schema.staffUsers.active), asc(schema.staffUsers.name)],
    columns: { id: true, name: true, email: true, role: true, active: true, totpEnabled: true, lastLoginAt: true, lockedUntil: true, mustChangePassword: true },
  });
  // Ativos primeiro
  members.sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <>
      <PageHeader title="Equipe" description="Contas de acesso ao backoffice e o que cada perfil pode fazer." />

      <div className="space-y-6">
        <Panel title="Nova conta" description="A pessoa recebe uma senha temporária e cria a própria senha no primeiro acesso. A verificação em duas etapas pode ser ativada depois, em Minha conta.">
          <NewStaffForm />
        </Panel>

        <Panel title={`Contas (${members.length})`}>
          <ul className="divide-y divide-line">
            {members.map((m) => {
              const locked = m.lockedUntil && m.lockedUntil > new Date();
              return (
                <li key={m.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <div className="min-w-0">
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-sm break-all text-ink-soft">{m.email}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge tone="crm">{STAFF_ROLE_LABEL[m.role]}</Badge>
                      {!m.active ? <Badge>Desativada</Badge> : null}
                      {m.totpEnabled ? <Badge tone="success">2FA ativa</Badge> : <Badge>Sem 2FA</Badge>}
                      {m.mustChangePassword ? <Badge tone="warning">Senha temporária</Badge> : null}
                      {locked ? <Badge tone="alert">Bloqueada por tentativas</Badge> : null}
                    </div>
                    <p className="mt-2 text-xs text-ink-soft">Último acesso: {formatDateTime(m.lastLoginAt)}</p>
                  </div>
                  <StaffRowForms member={{ id: m.id, name: m.name, role: m.role, active: m.active, totpEnabled: m.totpEnabled }} isSelf={m.id === user.id} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="O que cada perfil pode fazer">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="pb-2">Permissão</th>
                  {STAFF_ROLES.map((r) => (
                    <th key={r} scope="col" className="px-2 pb-2">{STAFF_ROLE_LABEL[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {Object.entries(permissionLabel).map(([perm, label]) => (
                  <tr key={perm}>
                    <th scope="row" className="py-2 text-left font-normal">{label}</th>
                    {STAFF_ROLES.map((r) => (
                      <td key={r} className="px-2 py-2">
                        {(ROLE_PERMISSIONS[r] as readonly string[]).includes(perm) ? (
                          <span className="font-semibold text-pep-ink">Sim</span>
                        ) : (
                          <span className="text-ink-soft">Não</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
