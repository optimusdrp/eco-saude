import {
  can,
  formatCents,
  MODULE_LABEL,
  SUBSCRIPTION_OPEN_STATUSES,
  SUBSCRIPTION_STATUS_LABEL,
  type SubscriptionStatus,
} from "@ecosaude/core";
import { and, asc, db, desc, eq, getClinicEntitlements, schema } from "@ecosaude/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, ModuleBadge, PageHeader, Panel, type Tone } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";
import { daysUntil, formatCnpj, formatDate, formatDateTime } from "@/lib/format";
import { ClinicForm, ClinicManagerForm, ClinicUserSupport, FeatureOverrides, NewSubscriptionForm, SubscriptionStatusForm, type FeatureRow } from "../forms";

export const metadata: Metadata = { title: "Clínica" };
export const dynamic = "force-dynamic";

const statusTone: Record<SubscriptionStatus, Tone> = {
  teste: "warning",
  ativa: "success",
  suspensa: "alert",
  cancelada: "neutral",
};

export default async function ClinicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criada?: string }>;
}) {
  const user = await requirePermission("clinics.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const justCreated = (await searchParams).criada === "1";

  const clinic = await db.query.clinics.findFirst({
    where: eq(schema.clinics.id, id),
    with: {
      leads: { columns: { id: true, name: true } },
      subscriptions: {
        orderBy: desc(schema.subscriptions.startedAt),
        with: { plan: { with: { submodules: true } }, overrides: true },
      },
    },
  });
  if (!clinic) notFound();

  const [allSubmodules, plans, entitlements, history, clinicUsers] = await Promise.all([
    db.query.submodules.findMany({ orderBy: asc(schema.submodules.sortOrder) }),
    db.query.plans.findMany({ where: eq(schema.plans.active, true), orderBy: [asc(schema.plans.moduleId), asc(schema.plans.priceMonthlyCents)] }),
    getClinicEntitlements(id),
    db.query.auditLog.findMany({
      where: and(eq(schema.auditLog.entity, "clinic"), eq(schema.auditLog.entityId, id)),
      orderBy: desc(schema.auditLog.createdAt),
      limit: 30,
    }),
    // Acessos ao ambiente da clínica (o backoffice usa o papel dono do banco, sem RLS)
    db.query.clinicUsers.findMany({
      where: eq(schema.clinicUsers.clinicId, id),
      columns: { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true, lastLoginAt: true, totpEnabled: true },
      orderBy: asc(schema.clinicUsers.name),
    }),
  ]);

  const canEditClinic = can(user.role, "clinics.edit");
  const canEditSubs = can(user.role, "subscriptions.edit");
  const open = clinic.subscriptions.filter((s) => SUBSCRIPTION_OPEN_STATUSES.includes(s.status));
  const closed = clinic.subscriptions.filter((s) => !SUBSCRIPTION_OPEN_STATUSES.includes(s.status));
  const mrr = open.filter((s) => s.status === "ativa").reduce((a, s) => a + s.priceMonthlyCents, 0);
  const submoduleName = new Map(allSubmodules.map((s) => [s.key, s.name]));

  return (
    <>
      <PageHeader
        back={
          <Link href="/clinicas" className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Clínicas
          </Link>
        }
        title={clinic.tradeName}
        description={
          <>
            {clinic.legalName ?? "Razão social não informada"}, CNPJ {formatCnpj(clinic.cnpj)}
            {clinic.leads[0] ? (
              <>
                . Veio do lead{" "}
                <Link href={`/leads/${clinic.leads[0].id}`} className="font-semibold text-crm hover:underline">
                  {clinic.leads[0].name}
                </Link>
              </>
            ) : null}
          </>
        }
      />

      {justCreated ? (
        <p role="status" className="mb-5 rounded-xl bg-ok-tint px-4 py-3 font-semibold text-ok-ink">
          Clínica cadastrada. Agora adicione as contratações abaixo.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          {/* Contratações em aberto */}
          <Panel title="Contratações" description={`Valor mensal ativo: ${formatCents(mrr)}`}>
            {open.length === 0 ? (
              <EmptyState title="Nenhuma contratação em aberto">Adicione um módulo abaixo para liberar o acesso da clínica.</EmptyState>
            ) : (
              <ul className="space-y-4">
                {open.map((sub) => {
                  const planKeys = new Set(sub.plan.submodules.map((ps) => ps.submoduleId));
                  const overrides = new Map(sub.overrides.map((o) => [o.submoduleId, o.enabled]));
                  const rows: FeatureRow[] = allSubmodules
                    .filter((s) => s.moduleId === sub.moduleId)
                    .map((s) => ({ submoduleId: s.id, name: s.name, inPlan: planKeys.has(s.id), override: overrides.get(s.id) ?? null }));
                  const days = sub.trialEndsAt ? daysUntil(sub.trialEndsAt) : null;

                  return (
                    <li key={sub.id} className="rounded-xl ring-1 ring-line">
                      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
                        <ModuleBadge id={sub.moduleId} />
                        <span className="font-display text-lg font-bold">{sub.plan.name}</span>
                        <Badge tone={statusTone[sub.status]}>{SUBSCRIPTION_STATUS_LABEL[sub.status]}</Badge>
                        <span className="ml-auto text-sm font-semibold tabular">
                          {formatCents(sub.priceMonthlyCents)}/mês{sub.billingCycle === "anual" ? ", cobrança anual" : ""}
                        </span>
                      </div>
                      <div className="space-y-4 p-3 sm:p-4">
                        <p className="text-sm text-ink-soft">
                          Desde {formatDate(sub.startedAt)}
                          {days !== null
                            ? days < 0
                              ? `. O teste venceu em ${formatDate(sub.trialEndsAt)}: o acesso já está bloqueado. Ative ou cancele.`
                              : `. Teste termina em ${formatDate(sub.trialEndsAt)} (${days} ${days === 1 ? "dia" : "dias"}).`
                            : "."}
                          {sub.priceMonthlyCents !== sub.plan.priceMonthlyCents
                            ? ` Preço congelado; o plano hoje custa ${formatCents(sub.plan.priceMonthlyCents)}.`
                            : ""}
                        </p>

                        <details className="group rounded-lg bg-fog/60 px-3">
                          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                            Funcionalidades ({rows.filter((r) => r.override ?? r.inPlan).length} de {rows.length} liberadas)
                          </summary>
                          <div className="pb-2">
                            <FeatureOverrides subscriptionId={sub.id} rows={rows} disabled={!canEditSubs} />
                          </div>
                        </details>

                        {canEditSubs ? <SubscriptionStatusForm id={sub.id} status={sub.status} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {canEditSubs ? (
            <Panel title="Adicionar contratação" description="Uma contratação por módulo. Para trocar de plano, cancele a atual e crie outra.">
              <NewSubscriptionForm
                clinicId={clinic.id}
                plans={plans.map((p) => ({ id: p.id, moduleId: p.moduleId, name: p.name, priceMonthlyCents: p.priceMonthlyCents }))}
                busyModules={open.map((s) => s.moduleId)}
              />
            </Panel>
          ) : null}

          {closed.length > 0 ? (
            <Panel title="Contratações encerradas">
              <ul className="divide-y divide-line text-sm">
                {closed.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                    <ModuleBadge id={s.moduleId} />
                    <span className="font-semibold">{s.plan.name}</span>
                    <span className="text-ink-soft">
                      {formatDate(s.startedAt)} a {formatDate(s.canceledAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          {/* O que a clínica pode usar agora (calculado no banco) */}
          <Panel title="Acesso liberado agora" description="Resultado de planos, exceções e prazos de teste.">
            {entitlements.modules.length === 0 ? (
              <p className="text-ink-soft">Nenhum módulo liberado no momento.</p>
            ) : (
              <ul className="space-y-3">
                {entitlements.modules.map((m) => (
                  <li key={m}>
                    <ModuleBadge id={m} />
                    <ul className="mt-1.5 flex flex-wrap gap-1">
                      {entitlements.features
                        .filter((f) => f.startsWith(`${m}.`))
                        .map((f) => (
                          <li key={f} className="rounded-full bg-fog px-2 py-0.5 text-xs ring-1 ring-line">
                            {submoduleName.get(f) ?? f}
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Acessos da clínica" description="O gestor entra no ambiente da clínica e cadastra a própria equipe em Ajustes > Equipe.">
            {clinicUsers.length ? (
              <ul className="mb-4 divide-y divide-line text-sm">
                {clinicUsers.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-semibold">{u.name}</span>
                    <span className="text-ink-soft">{u.email}</span>
                    <Badge tone={u.role === "gestor" ? "crm" : "neutral"}>{u.role}</Badge>
                    {!u.active ? <Badge tone="alert">desativado</Badge> : null}
                    {u.mustChangePassword ? <Badge tone="warning">senha temporária</Badge> : null}
                    {u.totpEnabled ? <Badge tone="success">2 etapas</Badge> : null}
                    {canEditClinic ? <ClinicUserSupport userId={u.id} email={u.email} totpEnabled={u.totpEnabled} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-ink-soft">Nenhum acesso ainda. Crie o do gestor para a clínica começar a usar.</p>
            )}
            {canEditClinic ? <ClinicManagerForm clinicId={clinic.id} /> : null}
          </Panel>

          <Panel title="Dados da clínica">
            <ClinicForm
              clinic={{
                id: clinic.id,
                tradeName: clinic.tradeName,
                legalName: clinic.legalName,
                cnpj: clinic.cnpj,
                email: clinic.email,
                phone: clinic.phone,
                city: clinic.city,
                state: clinic.state,
              }}
              disabled={!canEditClinic}
            />
          </Panel>

          <Panel title="Histórico">
            {history.length === 0 ? (
              <p className="text-ink-soft">Nada registrado.</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <p>{describeEvent(h.action, h.data)}</p>
                    <p className="text-xs text-ink-soft">
                      {h.actorEmail ?? "Sistema"}, {formatDateTime(h.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

/** Frase legível para cada tipo de registro de auditoria da clínica. */
function describeEvent(action: string, data: Record<string, unknown> | null): string {
  const d = data ?? {};
  const mod = typeof d.module === "string" ? MODULE_LABEL[d.module as keyof typeof MODULE_LABEL] : "";
  switch (action) {
    case "clinic.created":
      return "Clínica cadastrada.";
    case "clinic.updated":
      return "Dados da clínica alterados.";
    case "clinic.user_password_reset":
      return `Nova senha temporária gerada para ${String(d.email ?? "")}.`;
    case "clinic.user_2fa_reset":
      return `Verificação em duas etapas desligada para ${String(d.email ?? "")}.`;
    case "clinic.manager_created":
      return `Acesso de gestão criado: ${String(d.email ?? "")}.`;
    case "subscription.created":
      return `Contratação criada: ${mod} ${String(d.plan ?? "")} (${SUBSCRIPTION_STATUS_LABEL[d.status as SubscriptionStatus] ?? ""}).`;
    case "subscription.status_changed":
      return `${mod}: ${SUBSCRIPTION_STATUS_LABEL[d.de as SubscriptionStatus]} para ${SUBSCRIPTION_STATUS_LABEL[d.para as SubscriptionStatus]}${d.motivo ? `. Motivo: ${String(d.motivo)}` : ""}.`;
    case "subscription.feature_override": {
      const mode = d.mode === "on" ? "liberada" : d.mode === "off" ? "bloqueada" : "voltou a seguir o plano";
      return `Funcionalidade ${String(d.feature)} ${mode}.`;
    }
    default:
      return action;
  }
}
