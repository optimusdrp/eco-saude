import { ageYears } from "@ecosaude/core/pep";
import { and, asc, desc, eq, ilike, inArray, isNull, or, schema, sql, withTenant } from "@ecosaude/db";
import { ChevronRight, FilePen, Search, Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PepTabs } from "@/components/pep/PepTabs";
import { pepTabsFor } from "@/components/pep/tabs";
import { NewPatientButton } from "@/components/pep/widgets";
import { Avatar, Badge, EmptyState, PageHeader, Panel } from "@/components/ui/server";
import { requirePep } from "@/lib/auth/dal";
import { now as clockNow } from "@/lib/clock";
import { professionalOfUser } from "@/modules/pep/access";

export const metadata: Metadata = { title: "Prontuário" };

/**
 * PRONTUÁRIO: busca de pacientes e o histórico recente.
 * O dia (consultas, triagem, próximo paciente) fica no Consultório.
 *
 * Quem entra: quem lê prontuário (profissional de saúde) ou recebeu acesso parcial
 * (resumo de segurança, documentos emitidos). Cada ficha aberta mostra só o que a
 * permissão da pessoa permite, e a abertura fica registrada.
 */
export default async function PepHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePep();
  const canSearch = ctx.can("prontuario.ver") || ctx.can("prontuario.resumo") || ctx.can("prontuario.documentos") || ctx.can("prontuario.triagem");
  if (!canSearch) redirect(ctx.can("prontuario.modelos") ? "/prontuario/modelos" : ctx.can("prontuario.consultorio") ? "/consultorio" : "/sem-permissao");
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const canAttend = ctx.can("prontuario.atender");

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const pro = await professionalOfUser(tx, ctx.user.id);
    // Rascunhos e atendidos recentemente: só do próprio profissional
    const drafts = pro
      ? await tx
          .select({ id: schema.pepEncounters.id, startedAt: schema.pepEncounters.startedAt, name: schema.contacts.name, templateName: schema.pepEncounters.templateName })
          .from(schema.pepEncounters)
          .innerJoin(schema.contacts, eq(schema.contacts.id, schema.pepEncounters.contactId))
          .where(and(eq(schema.pepEncounters.status, "rascunho"), eq(schema.pepEncounters.professionalId, pro.id)))
          .orderBy(desc(schema.pepEncounters.startedAt))
          .limit(20)
      : [];
    const recent = pro
      ? await tx
          .select({ contactId: schema.contacts.id, name: schema.contacts.name, birthDate: schema.contacts.birthDate, last: sql<Date>`max(${schema.pepEncounters.finishedAt})`.mapWith((v) => new Date(v)) })
          .from(schema.pepEncounters)
          .innerJoin(schema.contacts, eq(schema.contacts.id, schema.pepEncounters.contactId))
          .where(and(eq(schema.pepEncounters.status, "finalizado"), eq(schema.pepEncounters.professionalId, pro.id)))
          .groupBy(schema.contacts.id, schema.contacts.name, schema.contacts.birthDate)
          .orderBy(sql`max(${schema.pepEncounters.finishedAt}) desc`)
          .limit(10)
      : [];

    let found: { id: string; name: string; birthDate: string | null; cpf: string | null }[] = [];
    if (q.length >= 2) {
      const digits = q.replace(/\D/g, "");
      found = await tx
        .select({ id: schema.contacts.id, name: schema.contacts.name, birthDate: schema.contacts.birthDate, cpf: schema.contacts.cpf })
        .from(schema.contacts)
        .where(
          and(
            isNull(schema.contacts.anonymizedAt),
            or(
              ilike(schema.contacts.name, `%${q.replace(/[%_\\]/g, "")}%`),
              digits.length >= 4 ? or(ilike(schema.contacts.cpf, `${digits}%`), ilike(schema.contacts.phone, `%${digits}%`)) : undefined,
            ),
          ),
        )
        .orderBy(asc(schema.contacts.name))
        .limit(20);
    }
    // Quem dos encontrados já tem prontuário (ajuda a escolher entre homônimos)
    const withRecord = found.length
      ? new Set((await tx.selectDistinct({ id: schema.pepEncounters.contactId }).from(schema.pepEncounters).where(inArray(schema.pepEncounters.contactId, found.map((f) => f.id)))).map((r) => r.id))
      : new Set<string>();
    return { pro, drafts, recent, found, withRecord };
  });

  const { pro, drafts, recent, found, withRecord } = data;
  const now = clockNow().getTime();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Prontuário" description={ctx.can("prontuario.ver") ? "Busque o paciente para abrir o prontuário." : "Seu acesso mostra só parte da ficha (resumo de segurança, triagem ou documentos)."} />
      <PepTabs tabs={pepTabsFor(ctx.can)} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-5">
          {/* ------------------------------ Buscar paciente ------------------------------ */}
          <Panel title="Buscar paciente">
            <form role="search" className="flex gap-2">
              <label htmlFor="pep-q" className="sr-only">
                Nome, CPF ou celular
              </label>
              <input
                id="pep-q"
                name="q"
                defaultValue={q}
                placeholder="Nome, CPF ou celular"
                autoComplete="off"
                className="min-h-11 min-w-0 flex-1 rounded-xl bg-paper px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-pep sm:min-h-10"
              />
              <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pep px-4 text-sm font-semibold text-white hover:bg-pep-ink sm:min-h-10" aria-label="Buscar">
                <Search className="size-4" aria-hidden />
                <span className="hidden sm:inline">Buscar</span>
              </button>
            </form>
            {q.length >= 2 ? (
              found.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {found.map((c) => {
                    const age = ageYears(c.birthDate);
                    return (
                      <li key={c.id}>
                        <Link href={`/prontuario/pacientes/${c.id}`} className="flex min-h-12 items-center gap-3 py-2 hover:bg-fog">
                          <Avatar name={c.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{c.name}</span>
                            <span className="block truncate text-xs text-ink-soft">
                              {[age !== null ? `${age} anos` : null, c.cpf ? `CPF final ${c.cpf.slice(-4)}` : null].filter(Boolean).join(", ") || "Sem nascimento e CPF"}
                            </span>
                          </span>
                          {withRecord.has(c.id) ? <Badge tone="pep">Tem prontuário</Badge> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-soft">Ninguém encontrado com &quot;{q}&quot;.</p>
              )
            ) : null}
            {canAttend ? (
              <div className="mt-4 border-t border-line pt-4">
                <NewPatientButton initialName={found.length ? "" : /\d/.test(q) ? "" : q} />
              </div>
            ) : null}
          </Panel>

          {/* ------------------------------ Atendidos recentemente ------------------------------ */}
          {pro ? (
            <Panel title="Atendidos recentemente">
              {recent.length ? (
                <ul className="divide-y divide-line">
                  {recent.map((r) => (
                    <li key={r.contactId}>
                      <Link href={`/prontuario/pacientes/${r.contactId}`} className="flex min-h-12 items-center gap-3 py-2 hover:bg-fog">
                        <Avatar name={r.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{r.name}</span>
                          <span className="block text-xs text-ink-soft">Último atendimento em {r.last.toLocaleDateString("pt-BR")}</span>
                        </span>
                        <ChevronRight className="size-4 text-ink-soft" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nenhum atendimento finalizado ainda">Os pacientes que você atender aparecem aqui.</EmptyState>
              )}
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          {ctx.can("prontuario.consultorio") ? (
            <Link href="/consultorio" className="flex items-center gap-3 rounded-2xl bg-pep-tint p-4 ring-1 ring-pep/30 hover:ring-pep">
              <Stethoscope className="size-6 shrink-0 text-pep" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-bold">Consultório</span>
                <span className="block text-sm text-pep-ink">Pacientes do dia, triagem e próximo atendimento</span>
              </span>
              <ChevronRight className="size-5 text-pep" aria-hidden />
            </Link>
          ) : null}

          {/* --------------------------------- Rascunhos --------------------------------- */}
          {drafts.length ? (
            <Panel title="Atendimentos não finalizados" description="Rascunho não vale como registro: finalize ou descarte.">
              <ul className="divide-y divide-line">
                {drafts.map((d) => {
                  const days = Math.floor((now - d.startedAt.getTime()) / 86_400_000);
                  return (
                    <li key={d.id}>
                      <Link href={`/prontuario/atendimentos/${d.id}`} className="flex min-h-12 items-center gap-3 py-2 hover:bg-fog">
                        <FilePen className="size-5 shrink-0 text-erp" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{d.name}</span>
                          <span className="block truncate text-xs text-ink-soft">
                            {d.templateName ?? "Atendimento"}, {days === 0 ? "hoje" : days === 1 ? "ontem" : `há ${days} dias`}
                          </span>
                        </span>
                        <ChevronRight className="size-4 text-ink-soft" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
