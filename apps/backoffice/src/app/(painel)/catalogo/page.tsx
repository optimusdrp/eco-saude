import { can, formatCents } from "@ecosaude/core";
import { asc, count, db, inArray, schema } from "@ecosaude/db";
import { Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/styles";
import { Badge, ModuleBadge, PageHeader, Panel } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Catálogo" };
export const dynamic = "force-dynamic";

/**
 * Catálogo: módulos, funcionalidades e planos que alimentam as contratações.
 * As funcionalidades em si (chaves como "crm.waitlist") vêm do código,
 * porque os sistemas precisam reconhecê-las; aqui se decide qual plano inclui o quê.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ salvo?: string }> }) {
  const user = await requirePermission("catalog.view");
  const saved = (await searchParams).salvo;
  const canEdit = can(user.role, "catalog.edit");

  const modules = await db.query.modules.findMany({
    orderBy: asc(schema.modules.sortOrder),
    with: {
      submodules: { orderBy: asc(schema.submodules.sortOrder) },
      plans: { orderBy: asc(schema.plans.priceMonthlyCents), with: { submodules: true } },
    },
  });

  // Quantas contratações em aberto usam cada plano
  const usage = await db
    .select({ planId: schema.subscriptions.planId, n: count() })
    .from(schema.subscriptions)
    .where(inArray(schema.subscriptions.status, ["teste", "ativa", "suspensa"]))
    .groupBy(schema.subscriptions.planId);
  const usageMap = new Map(usage.map((u) => [u.planId, u.n]));

  return (
    <>
      <PageHeader title="Catálogo" description="Planos de cada módulo e as funcionalidades que eles incluem." />
      {saved ? (
        <p role="status" className="mb-5 rounded-xl bg-ok-tint px-4 py-3 font-semibold text-ok-ink">
          Plano salvo.
        </p>
      ) : null}

      <div className="space-y-6">
        {modules.map((mod) => (
          <Panel
            key={mod.id}
            title={`${mod.name}: ${mod.description ?? ""}`}
            description={`${mod.submodules.length} funcionalidades, ${mod.plans.length} planos`}
            actions={
              canEdit ? (
                <Link href={`/catalogo/planos/novo?modulo=${mod.id}`} className={buttonStyles("secondary")}>
                  <Plus className="size-4" aria-hidden /> Novo plano
                </Link>
              ) : null
            }
          >
            {/* Matriz: funcionalidades x planos. No celular, rola na horizontal. */}
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">Funcionalidades incluídas em cada plano do módulo {mod.name}</caption>
                <thead>
                  <tr className="align-bottom">
                    <th scope="col" className="w-[40%] pb-3 text-left">
                      <ModuleBadge id={mod.id} />
                    </th>
                    {mod.plans.map((plan) => (
                      <th key={plan.id} scope="col" className="px-2 pb-3 text-left font-normal">
                        <span className="flex items-center gap-1">
                          <span className="font-display text-base font-bold">{plan.name}</span>
                          {canEdit ? (
                            <Link href={`/catalogo/planos/${plan.id}`} aria-label={`Editar plano ${plan.name}`} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-ink/5 hover:text-ink">
                              <Pencil className="size-4" aria-hidden />
                            </Link>
                          ) : null}
                        </span>
                        <span className="block font-semibold tabular">{formatCents(plan.priceMonthlyCents)}/mês</span>
                        <span className="block text-xs text-ink-soft">
                          {plan.maxUsers ? `Até ${plan.maxUsers} usuários` : "Usuários ilimitados"}, {usageMap.get(plan.id) ?? 0} em uso
                        </span>
                        {!plan.active ? <Badge className="mt-1">Inativo</Badge> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {mod.submodules.map((s) => (
                    <tr key={s.id}>
                      <th scope="row" className="py-2 pr-2 text-left font-normal">
                        <span className="block font-semibold">{s.name}</span>
                        <span className="block text-xs text-ink-soft">{s.key}</span>
                      </th>
                      {mod.plans.map((plan) => {
                        const included = plan.submodules.some((ps) => ps.submoduleId === s.id);
                        return (
                          <td key={plan.id} className="px-2 py-2">
                            {included ? (
                              <span className="font-semibold text-ok-ink">Incluída</span>
                            ) : (
                              <span className="text-ink-soft">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

