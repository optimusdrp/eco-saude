import { can, formatCents, SUBSCRIPTION_OPEN_STATUSES, SUBSCRIPTION_STATUS_LABEL } from "@ecosaude/core";
import { asc, db, ilike, or, schema } from "@ecosaude/db";
import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/styles";
import { Badge, EmptyState, ModuleBadge, PageHeader } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Clínicas" };
export const dynamic = "force-dynamic";

/**
 * Lista de clínicas clientes.
 * Desktop: tabela. Celular: cartões (tabelas largas não cabem em telas pequenas).
 */
export default async function ClinicsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("clinics.view");
  const q = (await searchParams).q?.trim() ?? "";

  const clinics = await db.query.clinics.findMany({
    where: q ? or(ilike(schema.clinics.tradeName, `%${q}%`), ilike(schema.clinics.legalName, `%${q}%`), ilike(schema.clinics.cnpj, `%${q.replace(/\D/g, "") || q}%`)) : undefined,
    orderBy: asc(schema.clinics.tradeName),
    with: { subscriptions: { columns: { moduleId: true, status: true, priceMonthlyCents: true } } },
    limit: 300,
  });

  // Resumo por clínica: módulos em aberto e valor mensal das contratações ativas
  const rows = clinics.map((c) => {
    const open = c.subscriptions.filter((s) => SUBSCRIPTION_OPEN_STATUSES.includes(s.status));
    const mrr = c.subscriptions.filter((s) => s.status === "ativa").reduce((acc, s) => acc + s.priceMonthlyCents, 0);
    const trial = open.some((s) => s.status === "teste");
    const suspended = open.some((s) => s.status === "suspensa");
    return { ...c, open, mrr, trial, suspended };
  });

  return (
    <>
      <PageHeader
        title="Clínicas"
        description="Clientes, módulos contratados e situação de cada um."
        actions={
          can(user.role, "clinics.edit") ? (
            <Link href="/clinicas/nova" className={buttonStyles("primary")}>
              <Plus className="size-4" aria-hidden /> Nova clínica
            </Link>
          ) : null
        }
      />

      <form role="search" className="relative mb-5 max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
        <label htmlFor="q" className="sr-only">Buscar clínicas</label>
        <input id="q" name="q" defaultValue={q} placeholder="Buscar por nome, razão social ou CNPJ"
          className="min-h-11 w-full rounded-xl bg-paper pr-3 pl-9 ring-1 ring-line outline-none focus:ring-2 focus:ring-crm" />
      </form>

      {rows.length === 0 ? (
        <EmptyState title={q ? "Nenhuma clínica encontrada" : "Nenhuma clínica cadastrada"}>
          {q ? "Confira a busca." : "Converta um lead em cliente ou cadastre uma clínica."}
        </EmptyState>
      ) : (
        <>
          {/* Celular */}
          <ul className="space-y-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/clinicas/${c.id}`} className="block rounded-xl bg-paper p-3 ring-1 ring-line hover:ring-crm">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{c.tradeName}</span>
                    <StatusHint trial={c.trial} suspended={c.suspended} />
                  </span>
                  <span className="block text-sm text-ink-soft">{[c.city, c.state].filter(Boolean).join("/") || "Cidade não informada"}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-1">
                    {c.open.map((s) => <ModuleBadge key={s.moduleId} id={s.moduleId} />)}
                    <span className="ml-auto text-sm font-semibold tabular">{formatCents(c.mrr)}/mês</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop */}
          <div className="hidden overflow-hidden rounded-2xl bg-paper ring-1 ring-line md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-fog/70 text-xs text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Clínica</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Cidade</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Módulos</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Situação</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Mensal ativo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-fog/50">
                    <td className="px-4 py-3">
                      <Link href={`/clinicas/${c.id}`} className="font-semibold hover:text-crm hover:underline">{c.tradeName}</Link>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{[c.city, c.state].filter(Boolean).join("/") || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        {c.open.length ? c.open.map((s) => <ModuleBadge key={s.moduleId} id={s.moduleId} />) : <span className="text-ink-soft">Nenhum</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusHint trial={c.trial} suspended={c.suspended} /></td>
                    <td className="px-4 py-3 text-right font-semibold tabular">{formatCents(c.mrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function StatusHint({ trial, suspended }: { trial: boolean; suspended: boolean }) {
  if (suspended) return <Badge tone="alert">Com suspensão</Badge>;
  if (trial) return <Badge tone="warning">{SUBSCRIPTION_STATUS_LABEL.teste}</Badge>;
  return null;
}
