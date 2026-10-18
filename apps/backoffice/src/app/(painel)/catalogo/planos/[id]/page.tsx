import { formatCents, MODULE_IDS, MODULE_LABEL, type ModuleId } from "@ecosaude/core";
import { and, asc, count, db, eq, inArray, schema } from "@ecosaude/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";
import { PlanForm } from "../../PlanForm";

export const metadata: Metadata = { title: "Plano" };
export const dynamic = "force-dynamic";

/**
 * Edição de plano (/catalogo/planos/<id>) ou criação (/catalogo/planos/novo?modulo=crm).
 */
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ modulo?: string }>;
}) {
  await requirePermission("catalog.edit");
  const { id } = await params;
  const isNew = id === "novo";

  let moduleId: ModuleId;
  let plan: Parameters<typeof PlanForm>[0]["plan"];
  let inUse = 0;

  if (isNew) {
    const m = (await searchParams).modulo;
    if (!MODULE_IDS.includes(m as ModuleId)) notFound();
    moduleId = m as ModuleId;
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const row = await db.query.plans.findFirst({ where: eq(schema.plans.id, id), with: { submodules: true } });
    if (!row) notFound();
    moduleId = row.moduleId;
    plan = {
      id: row.id,
      name: row.name,
      description: row.description,
      // Mostra o preço no formato brasileiro, sem "R$"
      priceMonthly: formatCents(row.priceMonthlyCents).replace(/^R\$\s?/, ""),
      maxUsers: row.maxUsers,
      active: row.active,
      submoduleIds: row.submodules.map((s) => s.submoduleId),
    };
    const [usage] = await db
      .select({ n: count() })
      .from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.planId, id), inArray(schema.subscriptions.status, ["teste", "ativa", "suspensa"])));
    inUse = usage?.n ?? 0;
  }

  const submodules = await db.query.submodules.findMany({
    where: eq(schema.submodules.moduleId, moduleId),
    orderBy: asc(schema.submodules.sortOrder),
    columns: { id: true, name: true, key: true },
  });

  return (
    <>
      <PageHeader
        back={
          <Link href="/catalogo" className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Catálogo
          </Link>
        }
        title={isNew ? `Novo plano de ${MODULE_LABEL[moduleId]}` : `Plano ${plan?.name} (${MODULE_LABEL[moduleId]})`}
        description={
          inUse > 0
            ? `Usado por ${inUse} contratações em aberto. Mudanças nas funcionalidades valem para elas na hora; mudanças de preço, só para novas contratações.`
            : undefined
        }
      />
      <Panel className="max-w-3xl">
        <PlanForm plan={plan} moduleId={moduleId} submodules={submodules} activeSubscriptions={inUse} />
      </Panel>
    </>
  );
}
