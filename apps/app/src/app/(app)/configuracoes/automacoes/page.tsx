import { AUTO_CONFIRM_LAST_HOUR, automationConfig, BUILTIN_AUTOMATIONS, CRM_FEATURES, formatWhen, isAiFeature, RULE_RECIPES } from "@ecosaude/core/crm";
import { asc, desc, eq, inSequence, schema, sql, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { AutomationsWorkspace, type BuiltinView, type RuleView, type RunView } from "./AutomationsWorkspace";

export const metadata: Metadata = { title: "Automações" };
export const dynamic = "force-dynamic";

/**
 * AUTOMAÇÕES (exige "config.automacoes")
 *
 *  Do sistema: cada automação pronta com liga/desliga, parâmetros, o que fez
 *              nos últimos 7 dias e as mensagens que ela envia.
 *  Regras:     "Quando → Se → Então" criadas pela clínica, com receitas prontas.
 *  Histórico:  cada execução de regra (feita, ignorada com o motivo, falhou).
 */
export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const ctx = await requireCrm("config.automacoes");
  const { aba } = await searchParams;
  const current = now();
  const [settings, recent, rules, runs, team, tags, pending] = await withTenant(ctx.user.clinicId, (tx) =>
    inSequence([
      () => tx.select().from(schema.crmSettings).limit(1),
      // O que as automações fizeram nos últimos 7 dias (pela trilha da clínica)
      () =>
        tx
          .select({
            type: schema.crmEvents.type,
            n: sql<number>`count(*)::int`,
          })
          .from(schema.crmEvents)
          .where(sql`${schema.crmEvents.createdAt} > now() - interval '7 days'`)
          .groupBy(schema.crmEvents.type),
      () => tx.select().from(schema.automationRules).orderBy(asc(schema.automationRules.createdAt)),
      () =>
        tx
          .select({
            id: schema.automationRuns.id,
            ruleId: schema.automationRuns.ruleId,
            ruleName: schema.automationRules.name,
            contactId: schema.automationRuns.contactId,
            contactName: schema.contacts.name,
            status: schema.automationRuns.status,
            result: schema.automationRuns.result,
            runAt: schema.automationRuns.runAt,
            doneAt: schema.automationRuns.doneAt,
          })
          .from(schema.automationRuns)
          .innerJoin(schema.automationRules, eq(schema.automationRules.id, schema.automationRuns.ruleId))
          .leftJoin(schema.contacts, eq(schema.contacts.id, schema.automationRuns.contactId))
          .orderBy(desc(schema.automationRuns.createdAt))
          .limit(150),
      () =>
        tx
          .select({
            id: schema.clinicUsers.id,
            name: schema.clinicUsers.name,
          })
          .from(schema.clinicUsers)
          .where(eq(schema.clinicUsers.active, true))
          .orderBy(asc(schema.clinicUsers.name)),
      () => tx.execute<{ tag: string }>(sql`select distinct unnest(tags) as tag from contacts order by 1 limit 80`),
      () =>
        tx
          .select({
            ruleId: schema.automationRuns.ruleId,
            n: sql<number>`count(*)::int`,
          })
          .from(schema.automationRuns)
          .where(eq(schema.automationRuns.status, "pendente"))
          .groupBy(schema.automationRuns.ruleId),
    ] as const),
  );
  const row = settings[0];
  const cfg = automationConfig(row?.automations);
  const count = (types: string[]) => recent.filter((r) => types.includes(r.type)).reduce((s, r) => s + r.n, 0);

  // As funcionalidades de IA ficam em Ajustes > Inteligência artificial (permissão própria)
  const builtins: BuiltinView[] = BUILTIN_AUTOMATIONS.filter((a) => !isAiFeature(a.key)).map((a) => ({
    key: a.key,
    group: a.group,
    title: a.title,
    what: a.what,
    locked: !!a.locked,
    inPlan: !a.feature || ctx.has(a.feature),
    config: cfg[a.key]!,
    params: a.params,
    templates: a.templates,
    href: a.href,
    where: a.where,
    week: count(a.events),
  }));

  const confirm = {
    inPlan: ctx.has(CRM_FEATURES.confirmations),
    autoConfirm: row?.autoConfirm ?? true,
    confirmHour: row?.confirmHour ?? 10,
    confirmDaysBefore: row?.confirmDaysBefore ?? 1,
    lastAutoConfirmOn: row?.lastAutoConfirmOn ?? null,
    week: count(["confirmation_requested"]),
    lastHour: AUTO_CONFIRM_LAST_HOUR,
  };

  const ruleViews: RuleView[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger,
    filter: r.filter,
    conditions: r.conditions,
    actions: r.actions,
    delayMinutes: r.delayMinutes,
    oncePerContact: r.oncePerContact,
    runs: r.runs,
    lastRun: r.lastRunAt ? formatWhen(r.lastRunAt, current) : null,
    pending: pending.find((p) => p.ruleId === r.id)?.n ?? 0,
  }));

  const runViews: RunView[] = runs.map((r) => ({
    id: r.id,
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    contactId: r.contactId,
    contactName: r.contactName,
    status: r.status as RunView["status"],
    result: r.result,
    when: formatWhen(r.doneAt ?? r.runAt, current),
  }));

  return (
    <>
      <PageHeader title="Automações" description="O que o CRM faz sozinho para a equipe não precisar lembrar. Ligue, desligue, ajuste e crie as suas próprias regras." />
      <AutomationsWorkspace
        initialTab={aba === "regras" || aba === "historico" ? aba : "sistema"}
        builtins={builtins}
        confirm={confirm}
        rules={ruleViews}
        runs={runViews}
        recipes={RULE_RECIPES.map((r) => ({
          id: r.id,
          title: r.title,
          why: r.why,
          exists: rules.some((x) => x.name === r.rule.name),
        }))}
        team={team}
        tags={tags.rows.map((t) => t.tag)}
        canMessages={ctx.can("config.mensagens")}
        ruleTextOn={cfg.ia_regra_texto?.enabled === true}
      />
    </>
  );
}
