import { CLINIC_SIZE_LABEL, LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage } from "@ecosaude/core";
import { and, db, desc, eq, ilike, or, schema, type SQL } from "@ecosaude/db";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/components/ui/styles";
import { Badge, EmptyState, ModuleBadge, PageHeader } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

type Search = { q?: string; etapa?: string; meus?: string };

/**
 * Leads (pedidos de demonstração do site).
 * Desktop: quadro por etapa (kanban). Celular: lista com filtro por etapa.
 * Filtros ficam na URL (?etapa=novo&q=...), então dá para compartilhar o link.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("leads.view");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const stage = LEAD_STAGES.includes(params.etapa as LeadStage) ? (params.etapa as LeadStage) : undefined;
  const mine = params.meus === "1";

  // Monta os filtros conforme o que veio na URL
  const filters: SQL[] = [];
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(schema.leads.name, like), ilike(schema.leads.clinicName, like), ilike(schema.leads.email, like))!);
  }
  if (mine) filters.push(eq(schema.leads.ownerId, user.id));

  const leads = await db.query.leads.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: desc(schema.leads.createdAt),
    with: { owner: { columns: { name: true } } },
    limit: 300,
  });

  const byStage = new Map<LeadStage, typeof leads>(LEAD_STAGES.map((s) => [s, []]));
  for (const lead of leads) byStage.get(lead.stage)?.push(lead);
  const listed = stage ? (byStage.get(stage) ?? []) : leads;

  /** Gera o link mantendo os outros filtros. */
  const href = (next: Partial<Search>) => {
    const sp = new URLSearchParams();
    const merged = { q, etapa: stage, meus: mine ? "1" : undefined, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/leads?${s}` : "/leads";
  };

  return (
    <>
      <PageHeader title="Leads" description="Pedidos de demonstração recebidos pelo site." />

      {/* Busca e filtros */}
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
        <form className="relative flex-1" role="search">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <label htmlFor="q" className="sr-only">Buscar leads</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome, clínica ou e-mail"
            className="min-h-11 w-full rounded-xl bg-paper pr-3 pl-9 ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
          />
          {stage ? <input type="hidden" name="etapa" value={stage} /> : null}
          {mine ? <input type="hidden" name="meus" value="1" /> : null}
        </form>
        <div className="flex gap-2">
          <Link
            href={href({ meus: mine ? undefined : "1" })}
            aria-pressed={mine}
            className={cn(
              "inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1",
              mine ? "bg-ink text-white ring-ink" : "bg-paper ring-line hover:ring-ink/35",
            )}
          >
            Só os meus
          </Link>
          {q || stage || mine ? (
            <Link href="/leads" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-ink-soft hover:bg-ink/5">
              Limpar filtros
            </Link>
          ) : null}
        </div>
      </div>

      {leads.length === 0 ? (
        <EmptyState title={q || mine ? "Nenhum lead com esses filtros" : "Nenhum lead ainda"}>
          {q || mine ? "Tente outro termo ou limpe os filtros." : "Os pedidos de demonstração feitos no site aparecem aqui."}
        </EmptyState>
      ) : (
        <>
          {/* CELULAR E TABLET: filtro por etapa + lista */}
          <div className="lg:hidden">
            <nav aria-label="Filtrar por etapa" className="-mx-4 mb-4 overflow-x-auto px-4">
              <ul className="flex w-max gap-2">
                <li>
                  <StageChip href={href({ etapa: undefined })} active={!stage} label="Todas" count={leads.length} />
                </li>
                {LEAD_STAGES.map((s) => (
                  <li key={s}>
                    <StageChip href={href({ etapa: s })} active={stage === s} label={LEAD_STAGE_LABEL[s]} count={byStage.get(s)?.length ?? 0} />
                  </li>
                ))}
              </ul>
            </nav>
            <ul className="space-y-2">
              {listed.map((lead) => (
                <li key={lead.id}>
                  <LeadCard lead={lead} showStage />
                </li>
              ))}
            </ul>
          </div>

          {/* DESKTOP: quadro com uma coluna por etapa */}
          <div className="hidden auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 lg:grid">
            {LEAD_STAGES.map((s) => {
              const items = byStage.get(s) ?? [];
              return (
                <section key={s} aria-label={LEAD_STAGE_LABEL[s]} className="rounded-2xl bg-ink/[0.04] p-2">
                  <h2 className="flex items-center justify-between px-1.5 py-1 font-sans text-sm font-semibold">
                    {LEAD_STAGE_LABEL[s]}
                    <span className="text-ink-soft tabular">{items.length}</span>
                  </h2>
                  <ul className="mt-1 space-y-2">
                    {items.map((lead) => (
                      <li key={lead.id}>
                        <LeadCard lead={lead} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function StageChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap ring-1",
        active ? "bg-ink text-white ring-ink" : "bg-paper ring-line",
      )}
    >
      {label}
      <span className={active ? "text-white/70" : "text-ink-soft"}>{count}</span>
    </Link>
  );
}

interface LeadCardData {
  id: string;
  name: string;
  clinicName: string;
  size: keyof typeof CLINIC_SIZE_LABEL;
  interests: ("crm" | "erp" | "pep" | "bi")[];
  stage: LeadStage;
  createdAt: Date;
  owner: { name: string } | null;
}

function LeadCard({ lead, showStage = false }: { lead: LeadCardData; showStage?: boolean }) {
  return (
    <Link
      href={`/leads/${lead.id}`}
      className="block rounded-xl bg-paper p-3 ring-1 ring-line transition hover:ring-crm"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-semibold break-words">{lead.clinicName}</span>
        {showStage ? <Badge tone={lead.stage === "novo" ? "crm" : "neutral"}>{LEAD_STAGE_LABEL[lead.stage]}</Badge> : null}
      </span>
      <span className="block text-sm text-ink-soft">{lead.name}</span>
      <span className="mt-2 flex flex-wrap gap-1">
        {lead.interests.map((m) => (
          <ModuleBadge key={m} id={m} />
        ))}
      </span>
      <span className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-soft">
        <span className="truncate">{lead.owner?.name ?? "Sem responsável"}</span>
        <span className="shrink-0">{timeAgo(lead.createdAt)}</span>
      </span>
    </Link>
  );
}
