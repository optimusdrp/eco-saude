import {
  can,
  formatCents,
  LEAD_CLOSED_STAGES,
  LEAD_STAGE_LABEL,
  LEAD_STAGES,
  MODULE_LABEL,
} from "@ecosaude/core";
import { and, asc, count, db, desc, eq, gte, schema, sql, sum } from "@ecosaude/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/server";
import { requireUser } from "@/lib/auth/dal";
import { daysAgo, daysUntil, formatDate, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Painel" };

/**
 * Painel inicial: números do dia e o que precisa de atenção.
 * Cada bloco só aparece para quem tem permissão de ver aquele dado.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const seeLeads = can(user.role, "leads.view");
  const seeClinics = can(user.role, "clinics.view");
  const weekAgo = daysAgo(7);

  // As consultas independentes rodam em paralelo (Promise.all)
  const [newLeads, openLeads, funnel, latest, activeClinics, mrr, trials] = await Promise.all([
    seeLeads
      ? db.select({ n: count() }).from(schema.leads).where(gte(schema.leads.createdAt, weekAgo)).then((r) => r[0]?.n ?? 0)
      : 0,
    seeLeads
      ? db
          .select({ n: count() })
          .from(schema.leads)
          .where(sql`${schema.leads.stage} not in ('ganho', 'perdido')`)
          .then((r) => r[0]?.n ?? 0)
      : 0,
    seeLeads
      ? db.select({ stage: schema.leads.stage, n: count() }).from(schema.leads).groupBy(schema.leads.stage)
      : [],
    seeLeads ? db.query.leads.findMany({ orderBy: desc(schema.leads.createdAt), limit: 5 }) : [],
    seeClinics
      ? db
          .select({ n: sql<number>`count(distinct ${schema.subscriptions.clinicId})::int` })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.status, "ativa"))
          .then((r) => r[0]?.n ?? 0)
      : 0,
    seeClinics
      ? db
          .select({ total: sum(schema.subscriptions.priceMonthlyCents) })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.status, "ativa"))
          .then((r) => Number(r[0]?.total ?? 0))
      : 0,
    seeClinics
      ? db.query.subscriptions.findMany({
          where: and(eq(schema.subscriptions.status, "teste")),
          orderBy: asc(schema.subscriptions.trialEndsAt),
          with: { clinic: true, plan: true },
          limit: 8,
        })
      : [],
  ]);

  const funnelMap = new Map(funnel.map((f) => [f.stage, f.n]));
  const funnelMax = Math.max(1, ...funnel.map((f) => f.n));
  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader title={`Olá, ${firstName}`} description="Resumo do comercial e das contratações." />

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {seeLeads ? (
          <>
            <Kpi label="Leads nos últimos 7 dias" value={String(newLeads)} href="/leads" />
            <Kpi label="Leads em aberto" value={String(openLeads)} href="/leads" />
          </>
        ) : null}
        {seeClinics ? (
          <>
            <Kpi label="Clínicas com contratação ativa" value={String(activeClinics)} href="/clinicas" />
            <Kpi label="Receita mensal recorrente" value={formatCents(mrr)} href="/clinicas" />
          </>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {seeLeads ? (
          <Panel title="Funil comercial" description="Quantidade de leads em cada etapa.">
            <ul className="space-y-2.5">
              {LEAD_STAGES.map((stage) => {
                const n = funnelMap.get(stage) ?? 0;
                const closed = LEAD_CLOSED_STAGES.includes(stage);
                return (
                  <li key={stage} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm">
                    <Link href={`/leads?etapa=${stage}`} className="font-semibold hover:underline">
                      {LEAD_STAGE_LABEL[stage]}
                    </Link>
                    <span className="h-2.5 overflow-hidden rounded-full bg-fog" aria-hidden>
                      <span
                        className={stage === "perdido" ? "block h-full bg-ink/25" : closed ? "block h-full bg-ok" : "block h-full bg-crm"}
                        style={{ width: `${(n / funnelMax) * 100}%` }}
                      />
                    </span>
                    <span className="text-right font-semibold tabular">{n}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        {seeClinics ? (
          <Panel title="Testes em andamento" description="Converta ou encerre antes do prazo.">
            {trials.length === 0 ? (
              <EmptyState title="Nenhuma clínica em teste" />
            ) : (
              <ul className="divide-y divide-line">
                {trials.map((t) => {
                  const days = t.trialEndsAt ? daysUntil(t.trialEndsAt) : 0;
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <Link href={`/clinicas/${t.clinicId}`} className="min-w-0 font-semibold hover:underline">
                        {t.clinic.tradeName}
                        <span className="block text-sm font-normal text-ink-soft">
                          {MODULE_LABEL[t.moduleId]} {t.plan.name}
                        </span>
                      </Link>
                      <Badge tone={days < 0 ? "alert" : days <= 3 ? "warning" : "neutral"}>
                        {days < 0 ? `Venceu em ${formatDate(t.trialEndsAt)}` : days === 0 ? "Vence hoje" : `${days} dias restantes`}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        ) : null}

        {seeLeads ? (
          <Panel
            title="Últimos contatos"
            actions={
              <Link href="/leads" className="text-sm font-semibold text-crm hover:underline">
                Ver todos
              </Link>
            }
            className="xl:col-span-2"
          >
            {latest.length === 0 ? (
              <EmptyState title="Nenhum contato ainda">Os pedidos de demonstração do site aparecem aqui.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {latest.map((lead) => (
                  <li key={lead.id}>
                    <Link href={`/leads/${lead.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-fog/60">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{lead.clinicName}</span>
                        <span className="block text-sm text-ink-soft">{lead.name}</span>
                      </span>
                      <Badge tone={lead.stage === "novo" ? "crm" : "neutral"}>{LEAD_STAGE_LABEL[lead.stage]}</Badge>
                      <span className="w-24 text-right text-sm text-ink-soft">{timeAgo(lead.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </>
  );
}

/** Cartão de indicador: número grande com rótulo; inteiro clicável. */
function Kpi({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="rounded-2xl bg-paper p-4 ring-1 ring-line transition hover:ring-ink/30">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular sm:text-3xl">{value}</p>
    </Link>
  );
}

// Garante dados sempre atualizados (nada de cache entre requisições)
export const dynamic = "force-dynamic";
