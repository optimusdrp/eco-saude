import "server-only";
import { buildRuleTextPrompt, checkRuleText, ruleFromTextRules, RULE_TEXT_SCHEMA, type RuleTextContext, type RuleTextDraft } from "@ecosaude/core/crm";
import { and, asc, eq, gt, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { automationSettings } from "../automation-settings";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * REGRA DE AUTOMAÇÃO A PARTIR DE UMA FRASE (servidor)
 *
 *  1. planRuleText (na transação): confere se está ligado em Ajustes > IA, o limite
 *     por pessoa e carrega o catálogo da clínica (equipe ativa e etiquetas).
 *  2. draftRuleText (FORA da transação): IA -> conferência; se falhar, plano B
 *     (regras). Devolve um RASCUNHO para o construtor: nada é salvo aqui.
 */

const RATE_LIMIT = 20;
const RATE_WINDOW_MIN = 10;

export interface RuleTextResult {
  draft: RuleTextDraft;
  source: "ia" | "regras";
  /** Por que não foi a IA (mostrado discretamente no construtor) */
  reason: string | null;
  model: string | null;
  latencyMs: number | null;
}

export async function planRuleText(tx: Tx, actorId: string | null): Promise<{ ctx: RuleTextContext; aiOn: boolean; blocked: string | null }> {
  const cfg = (await automationSettings(tx)).ia_regra_texto;
  if (!cfg?.enabled) throw new UserError("“Criar regra escrevendo em português” está desligada em Ajustes > Inteligência artificial.");
  const team = await tx.select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name }).from(schema.clinicUsers).where(eq(schema.clinicUsers.active, true)).orderBy(asc(schema.clinicUsers.name));
  const tags = await tx.execute<{ tag: string }>(sql`select distinct unnest(tags) as tag from contacts order by 1 limit 60`);
  // Limite por pessoa (custo e abuso): depois disso, só as regras do Tropi
  const [recent] = actorId
    ? await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.aiRuleDrafts)
        .where(and(eq(schema.aiRuleDrafts.actorId, actorId), eq(schema.aiRuleDrafts.source, "ia"), gt(schema.aiRuleDrafts.createdAt, new Date(Date.now() - RATE_WINDOW_MIN * 60_000))))
    : [{ n: 0 }];
  const blocked = (recent?.n ?? 0) >= RATE_LIMIT ? `limite de ${RATE_LIMIT} pedidos à IA a cada ${RATE_WINDOW_MIN} minutos` : null;
  return { ctx: { team, tags: tags.rows.map((t) => t.tag) }, aiOn: true, blocked };
}

/** IA fora da transação; plano B = regras. Null = nem a IA nem as regras entenderam. */
export async function draftRuleText(text: string, plan: Awaited<ReturnType<typeof planRuleText>>): Promise<RuleTextResult | null> {
  const rules = (reason: string | null, model: string | null = null): RuleTextResult | null => {
    const d = ruleFromTextRules(text, plan.ctx);
    return d ? { draft: d, source: "regras", reason, model, latencyMs: null } : null;
  };
  if (!aiConfigured()) return rules("IA não configurada no servidor");
  if (plan.blocked) return rules(plan.blocked);
  const started = Date.now();
  try {
    const { system, user } = buildRuleTextPrompt(text, plan.ctx);
    const out = await generate({ system, user, schema: RULE_TEXT_SCHEMA, temperature: 0 }, { task: "classify" });
    const checked = checkRuleText(out.text, plan.ctx);
    if (!checked.ok) return rules(checked.reason, out.model);
    return { draft: checked.draft, source: "ia", reason: null, model: out.model, latencyMs: Date.now() - started };
  } catch (error) {
    return rules(error instanceof AiError ? error.reason : "falha inesperada na IA");
  }
}
