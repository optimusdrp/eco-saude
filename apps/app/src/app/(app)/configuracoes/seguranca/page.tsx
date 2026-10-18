import { CLINIC_ROLE_LABEL, formatWhen } from "@ecosaude/core/crm";
import { asc, desc, eq, inSequence, schema, sql, withTenant } from "@ecosaude/db";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { categoryOf, describeActivity } from "@/modules/crm/activity";
import { ago } from "@/modules/crm/format";
import { ActivityLog, type ActivityItem } from "./ActivityLog";

export const metadata: Metadata = { title: "Segurança e atividade" };
export const dynamic = "force-dynamic";

/**
 * SEGURANÇA E ATIVIDADE (gestão)
 *  - Pendências: quem está sem verificação em 2 etapas, com senha temporária,
 *    bloqueado por tentativas, ou sem entrar há mais de 30 dias (acesso esquecido)
 *  - Números de 30 dias: logins com senha errada e exportações de dados (LGPD)
 *  - Atividade: as últimas 200 ações da equipe e das automações, com filtros
 */
export default async function SecurityPage() {
  const ctx = await requireCrm("config.seguranca");
  const current = now();
  const [users, events, stats] = await withTenant(ctx.user.clinicId, (tx) =>
    inSequence([
      () =>
        tx
          .select({
            id: schema.clinicUsers.id,
            name: schema.clinicUsers.name,
            role: schema.clinicUsers.role,
            totp: schema.clinicUsers.totpEnabled,
            temp: schema.clinicUsers.mustChangePassword,
            lockedUntil: schema.clinicUsers.lockedUntil,
            lastLoginAt: schema.clinicUsers.lastLoginAt,
          })
          .from(schema.clinicUsers)
          .where(eq(schema.clinicUsers.active, true))
          .orderBy(asc(schema.clinicUsers.name)),
      () =>
        tx
          .select({
            id: schema.crmEvents.id,
            type: schema.crmEvents.type,
            data: schema.crmEvents.data,
            createdAt: schema.crmEvents.createdAt,
            actorId: schema.crmEvents.actorId,
            actorName: schema.clinicUsers.name,
            contactId: schema.crmEvents.contactId,
            contactName: schema.contacts.name,
          })
          .from(schema.crmEvents)
          .leftJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.crmEvents.actorId))
          .leftJoin(schema.contacts, eq(schema.contacts.id, schema.crmEvents.contactId))
          .orderBy(desc(schema.crmEvents.createdAt))
          .limit(200),
      () =>
        tx
          .select({
            failed: sql<number>`count(*) filter (where ${schema.crmEvents.type} = 'auth.login_failed')::int`,
            exports: sql<number>`count(*) filter (where ${schema.crmEvents.type} in ('contacts_export', 'data_export'))::int`,
            logins: sql<number>`count(*) filter (where ${schema.crmEvents.type} = 'auth.login')::int`,
          })
          .from(schema.crmEvents)
          .where(sql`${schema.crmEvents.createdAt} > now() - interval '30 days'`),
    ]),
  );

  const month = 30 * 86_400_000;
  const issues: { user: string; text: string; tone: "alert" | "warning" }[] = [];
  for (const u of users) {
    if (u.lockedUntil && u.lockedUntil > current) issues.push({ user: u.name, text: "bloqueado por tentativas de senha errada", tone: "alert" });
    if (!u.totp) issues.push({ user: u.name, text: u.role === "gestor" ? "gestão sem verificação em 2 etapas" : "sem verificação em 2 etapas", tone: u.role === "gestor" ? "alert" : "warning" });
    if (u.temp) issues.push({ user: u.name, text: "ainda com senha temporária", tone: "warning" });
    if (!u.lastLoginAt) issues.push({ user: u.name, text: "nunca entrou: o acesso ainda é necessário?", tone: "warning" });
    else if (current.getTime() - u.lastLoginAt.getTime() > month) issues.push({ user: u.name, text: `não entra ${ago(u.lastLoginAt, current.getTime())}: o acesso ainda é necessário?`, tone: "warning" });
  }
  const s = stats[0] ?? { failed: 0, exports: 0, logins: 0 };

  const items: ActivityItem[] = events.map((e) => ({
    id: e.id,
    text: describeActivity(e.type, e.data, current),
    when: formatWhen(e.createdAt, current),
    actorId: e.actorId,
    actor: e.actorName ?? (e.actorId ? "alguém removido da equipe" : "Automático"),
    contactId: e.contactId,
    contactName: e.contactName,
    category: categoryOf(e.type, e.actorId),
  }));

  return (
    <>
      <PageHeader title="Segurança e atividade" description="Quem fez o quê, e o que precisa de atenção para proteger os dados dos pacientes (LGPD)." />

      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Pendências de segurança" description={issues.length ? "Resolva em Equipe e permissões (cada pessoa liga as 2 etapas em Minha conta)." : undefined}>
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-pep-ink">
              <CheckCircle2 className="size-5" aria-hidden /> Nada pendente. Toda a equipe está protegida.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {issues.map((i) => (
                <li key={`${i.user}-${i.text}`} className="flex items-center gap-2.5 py-2 text-sm">
                  <AlertTriangle className={i.tone === "alert" ? "size-4 shrink-0 text-alert" : "size-4 shrink-0 text-erp-ink"} aria-hidden />
                  <span>
                    <strong>{i.user}</strong>: {i.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {issues.length ? (
            <Link href="/configuracoes/equipe" className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-crm hover:underline">
              Abrir Equipe e permissões
            </Link>
          ) : null}
        </Panel>
        <Panel title="Últimos 30 dias">
          <dl className="grid grid-cols-3 gap-2 text-center xl:grid-cols-1 xl:text-left">
            <Stat label="Entradas no sistema" value={s.logins} />
            <Stat label="Senhas erradas" value={s.failed} alert={s.failed >= 5} />
            <Stat label="Exportações de dados" value={s.exports} />
          </dl>
          <p className="mt-3 text-xs text-ink-soft">Perfis da equipe: {Object.entries(CLINIC_ROLE_LABEL).map(([k, v]) => `${users.filter((u) => u.role === k).length} ${v.toLowerCase()}`).join(", ")}.</p>
        </Panel>
      </div>

      <ActivityLog items={items} team={users.map((u) => ({ id: u.id, name: u.name }))} />
    </>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-xl bg-fog px-3 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={alert ? "font-display text-2xl font-bold text-alert tabular" : "font-display text-2xl font-bold tabular"}>{value}</dd>
    </div>
  );
}
