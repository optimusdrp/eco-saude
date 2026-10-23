import { MODULE_FULL_NAME, MODULE_IDS, MODULE_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@ecosaude/core";
import { clinicTimeZone, CRM_FEATURE_LABEL, CRM_FEATURES } from "@ecosaude/core/crm";
import { db, desc, eq, schema } from "@ecosaude/db";
import { CheckCircle2, CircleSlash } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader, Panel } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { now as clockNow } from "@/lib/clock";

export const metadata: Metadata = { title: "Plano e módulos" };
export const dynamic = "force-dynamic";

const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: clinicTimeZone() });

/**
 * PLANO E MÓDULOS (gestão, somente leitura)
 * O que a clínica contratou: módulos (CRM, ERP, Prontuário, BI), plano,
 * situação (teste, ativa...) e quais funcionalidades estão liberadas.
 * Mudanças de plano são feitas pela equipe Tropi.
 */
export default async function PlanPage() {
  const ctx = await requireCrm("config.plano");
  // Contratações são da plataforma (fora do isolamento por clínica): filtro pelo id da sessão
  const subs = await db.query.subscriptions.findMany({
    where: eq(schema.subscriptions.clinicId, ctx.user.clinicId),
    with: { plan: { columns: { name: true, maxUsers: true } } },
    orderBy: desc(schema.subscriptions.startedAt),
  });
  const now = clockNow().getTime();

  return (
    <>
      <PageHeader title="Plano e módulos" description="O que a clínica tem hoje. Para contratar um módulo ou mudar de plano, fale com a equipe Tropi." />

      <ul className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MODULE_IDS.map((m) => {
          const sub = subs.find((s) => s.moduleId === m && s.status !== "cancelada");
          const enabled = ctx.entitlements.modules.includes(m);
          const trialDays = sub?.status === "teste" && sub.trialEndsAt ? Math.ceil((sub.trialEndsAt.getTime() - now) / 86_400_000) : null;
          return (
            <li key={m} className={cn("rounded-2xl p-4 ring-1", enabled ? "bg-paper ring-line" : "bg-fog ring-transparent")}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-display text-xl font-bold">{MODULE_LABEL[m]}</p>
                {sub ? <Badge tone={sub.status === "ativa" ? "success" : sub.status === "teste" ? "warning" : "alert"}>{SUBSCRIPTION_STATUS_LABEL[sub.status]}</Badge> : <Badge>não contratado</Badge>}
              </div>
              {sub ? (
                <>
                  <p className="mt-1 text-sm">Plano {sub.plan.name}</p>
                  <p className="text-xs text-ink-soft">
                    Desde {fmtDate(sub.startedAt)}
                    {sub.plan.maxUsers ? `, até ${sub.plan.maxUsers} usuários` : ", usuários ilimitados"}
                  </p>
                  {trialDays !== null ? (
                    <p className={cn("mt-2 text-sm font-semibold", trialDays <= 3 ? "text-alert" : "text-erp-ink")}>
                      {trialDays > 0 ? `Teste termina em ${trialDays} ${trialDays === 1 ? "dia" : "dias"} (${fmtDate(sub.trialEndsAt!)})` : "Teste encerrado"}
                    </p>
                  ) : null}
                </>
              ) : (
                <Link href={`/modulos/${m}`} className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-crm hover:underline">
                  Conhecer o {MODULE_FULL_NAME[m]}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <Panel title="Funcionalidades do Atendimento" description="Liberadas pelo plano (ou por exceção combinada com a equipe Tropi).">
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.values(CRM_FEATURES).map((f) => {
            const on = ctx.has(f);
            return (
              <li key={f} className="flex items-center gap-2.5 rounded-xl bg-fog px-3 py-2.5">
                {on ? <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden /> : <CircleSlash className="size-5 shrink-0 text-ink-soft" aria-hidden />}
                <span className={cn("flex-1 text-sm font-semibold", !on && "text-ink-soft")}>{CRM_FEATURE_LABEL[f]}</span>
                <span className="text-xs text-ink-soft">{on ? "liberada" : "fora do plano"}</span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
