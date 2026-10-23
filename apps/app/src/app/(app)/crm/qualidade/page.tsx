import { addDaysIso, formatScore, isoWeek, todayIso, weekLabel } from "@ecosaude/core/crm";
import { and, desc, eq, inArray, schema, sql, withTenant } from "@ecosaude/db";
import { Bot, Lightbulb, Quote, Sparkles, ThumbsUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { automationSettings } from "@/modules/crm/automation-settings";
import { RunAudit } from "./RunAudit";

export const metadata: Metadata = { title: "Qualidade do atendimento" };
export const dynamic = "force-dynamic";

/**
 * QUALIDADE DO ATENDIMENTO (auditoria por amostragem)
 *
 * Para TREINAR a equipe. O paciente não aparece em lugar nenhum desta tela:
 * nem nome, nem telefone, nem link para a conversa. Só as notas, a dica e um
 * trecho do que a ATENDENTE escreveu (com o nome do paciente trocado por [paciente]).
 *
 *  - Gestão (permissão "Qualidade do atendimento"): vê toda a equipe e pode "Auditar agora".
 *  - Demais pessoas: veem só as próprias avaliações, se a clínica permitir (Ajustes > IA).
 */
export default async function QualityPage({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const ctx = await requireCrm();
  const canAll = ctx.can("qualidade.ver");
  const { semana } = await searchParams;

  const today = todayIso();
  const weeks = [...Array(8)].map((_, i) => isoWeek(addDaysIso(today, -7 * i)));
  const week = semana && weeks.includes(semana) ? semana : weeks[0]!;

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const cfg = (await automationSettings(tx)).ia_auditoria;
    if (!cfg?.enabled) return null;
    const own = cfg.mostrarParaAtendente !== false && ctx.can("conversas.responder");
    if (!canAll && !own) return "sem-permissao" as const;
    const mine = canAll ? undefined : eq(schema.serviceAudits.agentId, ctx.user.id);
    const audits = await tx
      .select({
        id: schema.serviceAudits.id,
        agentId: schema.serviceAudits.agentId,
        agent: schema.clinicUsers.name,
        tempo: schema.serviceAudits.tempo,
        cordialidade: schema.serviceAudits.cordialidade,
        clareza: schema.serviceAudits.clareza,
        horario: schema.serviceAudits.horario,
        total: schema.serviceAudits.total,
        firstResponseMin: schema.serviceAudits.firstResponseMin,
        wantedSchedule: schema.serviceAudits.wantedSchedule,
        strength: schema.serviceAudits.strength,
        tip: schema.serviceAudits.tip,
        quote: schema.serviceAudits.quote,
        source: schema.serviceAudits.source,
        fallbackReason: schema.serviceAudits.fallbackReason,
      })
      .from(schema.serviceAudits)
      .leftJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.serviceAudits.agentId))
      .where(and(eq(schema.serviceAudits.week, week), mine))
      .orderBy(desc(schema.serviceAudits.createdAt));
    // Evolução: média por semana (8 semanas)
    const trend = await tx
      .select({ week: schema.serviceAudits.week, avg: sql<number>`round(avg(${schema.serviceAudits.total})::numeric, 1)::float`, n: sql<number>`count(*)::int` })
      .from(schema.serviceAudits)
      .where(and(inArray(schema.serviceAudits.week, weeks), mine))
      .groupBy(schema.serviceAudits.week);
    return { audits, trend, target: typeof cfg.amostraSemanal === "number" ? cfg.amostraSemanal : 10 };
  });
  if (data === "sem-permissao") redirect("/sem-permissao");

  const header = (
    <PageHeader
      title="Qualidade do atendimento"
      description="Notas de uma amostra de conversas por semana, para treinar a equipe. O paciente não é identificado."
      actions={data && canAll ? <RunAudit /> : null}
    />
  );
  if (!data) {
    return (
      <>
        {header}
        <EmptyState title="Auditoria desligada">
          Ligue em Ajustes &gt; Inteligência artificial &gt; Auditoria de atendimento por amostragem.
          {ctx.can("config.ia") ? (
            <>
              {" "}
              <Link href="/configuracoes/ia" className="font-semibold text-crm hover:underline">
                Abrir os ajustes
              </Link>
            </>
          ) : null}
        </EmptyState>
      </>
    );
  }

  const { audits, trend, target } = data;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
  };
  const scheduleAsked = audits.filter((a) => a.wantedSchedule);
  const firstMins = audits.map((a) => a.firstResponseMin).filter((x): x is number => x !== null);
  const people = [...new Set(audits.map((a) => a.agentId ?? "-"))].map((id) => {
    const of = audits.filter((a) => (a.agentId ?? "-") === id);
    return {
      id,
      name: of[0]!.agent ?? "Pessoa removida",
      n: of.length,
      total: avg(of.map((a) => a.total)),
      tempo: avg(of.map((a) => a.tempo)),
      cordialidade: avg(of.map((a) => a.cordialidade)),
      clareza: avg(of.map((a) => a.clareza)),
      horario: avg(of.map((a) => a.horario)),
    };
  });

  return (
    <>
      {header}

      {/* Semanas */}
      <nav aria-label="Semana" className="thin-scroll -mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {weeks.map((w, i) => {
          const t = trend.find((x) => x.week === w);
          return (
            <Link
              key={w}
              href={i === 0 ? "/crm/qualidade" : `/crm/qualidade?semana=${w}`}
              aria-current={w === week ? "page" : undefined}
              className={cn("flex shrink-0 flex-col rounded-xl px-3 py-1.5 text-xs ring-1", w === week ? "bg-night text-white ring-night" : "bg-paper text-ink-soft ring-line hover:text-ink")}
            >
              <span className="font-semibold">{i === 0 ? "Esta semana" : weekLabel(w)}</span>
              <span className="tabular opacity-80">{t ? `nota ${formatScore(t.avg)} · ${t.n}` : "sem avaliações"}</span>
            </Link>
          );
        })}
      </nav>

      {audits.length === 0 ? (
        <EmptyState title="Nenhuma conversa avaliada nesta semana">
          {canAll
            ? `A amostra (${target} conversas) é feita sozinha a partir de segunda, aos poucos. Para adiantar, use “Auditar agora”.`
            : "Quando houver avaliações das suas conversas, elas aparecem aqui."}
        </EmptyState>
      ) : (
        <>
          {/* Resumo */}
          <dl className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Nota geral" value={formatScore(avg(audits.map((a) => a.total)))} hint="de 0 a 10" />
            <Stat label="Conversas avaliadas" value={String(audits.length)} hint={canAll ? `meta da semana: ${target}` : "suas, nesta semana"} />
            <Stat label="1ª resposta (mediana)" value={firstMins.length ? `${median(firstMins)} min` : "—"} hint="só no horário de atendimento" />
            <Stat
              label="Ofereceu horário"
              value={scheduleAsked.length ? `${Math.round((scheduleAsked.filter((a) => a.horario === 10).length / scheduleAsked.length) * 100)}%` : "—"}
              hint={scheduleAsked.length ? `de ${scheduleAsked.length} que quiseram marcar` : "ninguém pediu para marcar"}
            />
          </dl>

          {/* Por pessoa (só a gestão) */}
          {canAll && people.length > 1 ? (
            <section aria-labelledby="pessoas-t" className="mb-6">
              <h2 id="pessoas-t" className="mb-2 text-lg font-bold">
                Por pessoa
              </h2>
              <div className="thin-scroll overflow-x-auto rounded-2xl bg-paper ring-1 ring-line">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-xs text-ink-soft">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Pessoa
                      </th>
                      {["Conversas", "Geral", "Tempo", "Cordialidade", "Clareza", "Horário"].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 text-right font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.id} className="border-b border-line last:border-0">
                        <th scope="row" className="px-3 py-2 text-left font-semibold">
                          {p.name}
                        </th>
                        <td className="px-3 py-2 text-right tabular">{p.n}</td>
                        <td className="px-3 py-2 text-right">
                          <ScorePill v={p.total} />
                        </td>
                        {[p.tempo, p.cordialidade, p.clareza, p.horario].map((v, i) => (
                          <td key={i} className="px-3 py-2 text-right tabular text-ink-soft">
                            {v === null ? "—" : formatScore(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Avaliações */}
          <section aria-labelledby="avaliacoes-t">
            <h2 id="avaliacoes-t" className="mb-2 text-lg font-bold">
              Avaliações
            </h2>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
              {audits.map((a) => (
                <li key={a.id} className="rounded-2xl bg-paper p-4 ring-1 ring-line">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{a.agent ?? "Pessoa removida"}</p>
                      <p className="text-xs text-ink-soft">
                        {a.firstResponseMin !== null ? `1ª resposta em ${a.firstResponseMin} min no horário de atendimento` : "sem medição de tempo"}
                        {" · "}
                        <span className={cn("inline-flex items-center gap-0.5", a.source === "ia" ? "text-crm" : "")} title={a.fallbackReason ? `Sem IA: ${a.fallbackReason}` : undefined}>
                          {a.source === "ia" ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
                          {a.source === "ia" ? "avaliada pela IA" : "avaliada pelas regras"}
                        </span>
                      </p>
                    </div>
                    <ScorePill v={a.total} big />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <Bar label="Tempo" v={a.tempo} />
                    <Bar label="Cordialidade" v={a.cordialidade} />
                    <Bar label="Clareza" v={a.clareza} />
                    <Bar label="Ofereceu horário" v={a.horario} />
                  </dl>
                  {a.strength ? (
                    <p className="mt-3 flex gap-2 text-sm">
                      <ThumbsUp className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                      <span>
                        <span className="sr-only">Ponto forte: </span>
                        {a.strength}
                      </span>
                    </p>
                  ) : null}
                  {a.tip ? (
                    <p className="mt-1.5 flex gap-2 text-sm">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-erp" aria-hidden />
                      <span>
                        <span className="sr-only">Dica: </span>
                        {a.tip}
                      </span>
                    </p>
                  ) : null}
                  {a.quote ? (
                    <blockquote className="mt-2 flex gap-2 rounded-xl bg-fog px-3 py-2 text-sm text-ink-soft">
                      <Quote className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>
                        <span className="sr-only">Trecho da atendente: </span>“{a.quote}”
                      </span>
                    </blockquote>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p className="mt-6 max-w-3xl text-xs text-ink-soft">
        Como funciona: o tempo de resposta é medido pelo sistema, contando só o horário de atendimento. Cordialidade, clareza e “ofereceu horário” vêm da leitura das falas (IA) ou, sem ela, de sinais
        objetivos. Nenhuma nota é usada sozinha para decidir nada: use como conversa de treino. Avise a equipe de que a amostragem existe.
      </p>
    </>
  );
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

const tone = (v: number) => (v >= 8 ? "bg-ok-tint text-ok-ink" : v >= 6 ? "bg-erp-tint text-erp-ink" : "bg-alert-tint text-alert");

function ScorePill({ v, big }: { v: number | null; big?: boolean }) {
  if (v === null) return <span className="text-ink-soft">—</span>;
  return (
    <span
      className={cn("inline-flex items-baseline justify-center rounded-xl font-bold tabular", tone(v), big ? "min-w-14 px-2.5 py-1 text-2xl" : "px-2 py-0.5 text-sm")}
      aria-label={`Nota ${formatScore(v)} de 10`}
    >
      {formatScore(v)}
    </span>
  );
}

function Bar({ label, v }: { label: string; v: number | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-2">
        {v === null ? (
          <span className="text-xs text-ink-soft">não se aplica</span>
        ) : (
          <>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fog" aria-hidden>
              <span className={cn("block h-full rounded-full", v >= 8 ? "bg-ok" : v >= 6 ? "bg-erp" : "bg-alert")} style={{ width: `${v * 10}%` }} />
            </span>
            <span className="w-7 text-right text-xs font-semibold tabular">{formatScore(v)}</span>
          </>
        )}
      </dd>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-paper p-3 ring-1 ring-line">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-display text-2xl font-bold tabular">{value}</dd>
      <dd className="text-xs text-ink-soft">{hint}</dd>
    </div>
  );
}
