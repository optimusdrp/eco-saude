import { and, count, db, desc, eq, ilike, schema, type SQL } from "@ecosaude/db";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/styles";
import { EmptyState, PageHeader } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Auditoria" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Nomes legíveis das entidades. */
const entityLabel: Record<string, string> = {
  lead: "Lead",
  clinic: "Clínica",
  plan: "Plano",
  staff_user: "Equipe",
};

/** Link para o registro afetado, quando existe uma página para ele. */
function entityHref(entity: string, id: string | null): string | null {
  if (!id) return null;
  if (entity === "lead") return `/leads/${id}`;
  if (entity === "clinic") return `/clinicas/${id}`;
  if (entity === "plan") return `/catalogo/planos/${id}`;
  return null;
}

/**
 * Trilha de auditoria: somente leitura (o banco bloqueia alterações).
 * Filtros por tipo de registro, ação e pessoa; paginação de 50 em 50.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entidade?: string; acao?: string; quem?: string; pagina?: string }>;
}) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.pagina) || 1);

  const filters: SQL[] = [];
  if (sp.entidade && sp.entidade in entityLabel) filters.push(eq(schema.auditLog.entity, sp.entidade));
  if (sp.acao) filters.push(ilike(schema.auditLog.action, `%${sp.acao}%`));
  if (sp.quem) filters.push(ilike(schema.auditLog.actorEmail, `%${sp.quem}%`));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, total] = await Promise.all([
    db.query.auditLog.findMany({ where, orderBy: desc(schema.auditLog.createdAt), limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    db.select({ n: count() }).from(schema.auditLog).where(where).then((r) => r[0]?.n ?? 0),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ entidade: sp.entidade, acao: sp.acao, quem: sp.quem })) if (v) params.set(k, v);
    params.set("pagina", String(p));
    return `/auditoria?${params}`;
  };

  return (
    <>
      <PageHeader title="Auditoria" description={`Registro permanente de todas as ações. ${total} registros.`} />

      <form className="mb-5 grid gap-3 rounded-2xl bg-paper p-4 ring-1 ring-line sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="entidade" className="text-sm font-semibold">Tipo</label>
          <select id="entidade" name="entidade" defaultValue={sp.entidade ?? ""} className="mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-line sm:min-h-10">
            <option value="">Todos</option>
            {Object.entries(entityLabel).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="acao" className="text-sm font-semibold">Ação contém</label>
          <input id="acao" name="acao" defaultValue={sp.acao} placeholder="ex.: login, status" className="mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-line sm:min-h-10" />
        </div>
        <div>
          <label htmlFor="quem" className="text-sm font-semibold">Pessoa (e-mail)</label>
          <input id="quem" name="quem" defaultValue={sp.quem} className="mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-line sm:min-h-10" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonStyles("primary", "flex-1")}>Filtrar</button>
          <Link href="/auditoria" className={buttonStyles("ghost")}>Limpar</Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nenhum registro com esses filtros" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-paper ring-1 ring-line">
          {rows.map((r) => {
            const href = entityHref(r.entity, r.entityId);
            return (
              <li key={r.id} className="grid gap-1 px-4 py-3 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.2fr)] md:gap-4">
                <span className="text-sm text-ink-soft tabular">{formatDateTime(r.createdAt)}</span>
                <span className="min-w-0">
                  <span className="block font-semibold break-all">{r.action}</span>
                  <span className="block text-sm break-all text-ink-soft">
                    {r.actorEmail ?? "Sistema"}
                    {r.ip ? `, IP ${r.ip}` : ""}
                  </span>
                </span>
                <span className="min-w-0 text-sm">
                  {href ? (
                    <Link href={href} className="font-semibold text-crm hover:underline">
                      {entityLabel[r.entity] ?? r.entity}
                    </Link>
                  ) : (
                    <span className="font-semibold">{entityLabel[r.entity] ?? r.entity}</span>
                  )}
                  {r.data && Object.keys(r.data).length ? (
                    <code className="mt-1 block max-h-24 overflow-auto rounded-lg bg-fog px-2 py-1 text-xs break-all whitespace-pre-wrap">
                      {JSON.stringify(r.data)}
                    </code>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Páginas" className="mt-5 flex items-center justify-between gap-3">
          {page > 1 ? <Link href={pageHref(page - 1)} className={buttonStyles("secondary")}>Anterior</Link> : <span />}
          <span className="text-sm text-ink-soft">Página {page} de {pages}</span>
          {page < pages ? <Link href={pageHref(page + 1)} className={buttonStyles("secondary")}>Próxima</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
