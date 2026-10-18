"use server";

import { BUILTIN_AUTOMATIONS, isAiFeature, isTemplateKey, RULE_RECIPES, sanitizeBuiltin, templateDef } from "@ecosaude/core/crm";
import { automationRuleSchema, messageTemplateSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { eq, schema, sql } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { draftRuleText, planRuleText, type RuleTextResult } from "../ai/rule-text";
import { logEvent } from "../journey";
import { runCrm } from "../run";

/**
 * AUTOMAÇÕES E MENSAGENS AUTOMÁTICAS (Ajustes)
 *  - saveBuiltinAction: liga/desliga e parâmetros de uma automação do sistema
 *  - saveRuleAction / toggleRuleAction / deleteRuleAction / ruleFromRecipeAction
 *  - ruleFromTextAction: frase em português -> rascunho no construtor (IA ou regras)
 *  - saveTemplateAction / resetTemplateAction: textos das mensagens automáticas
 */

const refreshAutomations = () => {
  revalidatePath("/configuracoes/automacoes");
  revalidatePath("/configuracoes/ia");
};

/* --------------------------- Automações do sistema -------------------------- */

export async function saveBuiltinAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const key = field(form, "key");
  // Funcionalidades de IA têm permissão própria (Ajustes > Inteligência artificial)
  const ctx = await authorizeCrm(isAiFeature(key) ? "config.ia" : "config.automacoes");
  if (!ctx) return NOT_ALLOWED;
  const def = BUILTIN_AUTOMATIONS.find((a) => a.key === key);
  if (!def) return { ok: false, message: "Automação desconhecida." };
  if (def.locked) return { ok: false, message: "Esta automação não pode ser alterada (segurança do paciente e LGPD)." };
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(field(form, "config")) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "Dados inválidos." };
  }
  const clean = sanitizeBuiltin(key, input);
  if (!clean) return { ok: false, message: "Automação desconhecida." };
  await runCrm(ctx, async (tx, scope) => {
    // jsonb || jsonb: troca só a chave desta automação, preservando as outras
    const patch = JSON.stringify({ [key]: clean });
    await tx
      .insert(schema.crmSettings)
      .values({ automations: { [key]: clean } })
      .onConflictDoUpdate({ target: schema.crmSettings.clinicId, set: { automations: sql`${schema.crmSettings.automations} || ${patch}::jsonb`, updatedAt: new Date() } });
    await logEvent(tx, { actorId: scope.actorId, type: "automation_updated", data: { automacao: def.title, ligada: clean.enabled } });
  });
  refreshAutomations();
  return { ok: true, message: clean.enabled ? `“${def.title}” ligada e salva.` : `“${def.title}” desligada.` };
}

/* ------------------------------ Regras da clínica ---------------------------- */

export async function saveRuleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.automacoes");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  let raw: unknown;
  try {
    raw = JSON.parse(field(form, "rule"));
  } catch {
    return { ok: false, message: "Dados inválidos." };
  }
  const parsed = automationRuleSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = flattenErrors(parsed.error);
    return { ok: false, errors, message: Object.values(errors)[0] ?? "Revise a regra." };
  }
  const d = parsed.data;
  const values = {
    name: d.name,
    trigger: d.trigger,
    filter: d.filter,
    conditions: d.conditions as never,
    actions: d.actions as never,
    delayMinutes: d.delayMinutes,
    oncePerContact: d.oncePerContact,
  };
  try {
    const savedId = await runCrm(ctx, async (tx, scope) => {
      if (id) {
        const rows = await tx.update(schema.automationRules).set(values).where(eq(schema.automationRules.id, id)).returning({ id: schema.automationRules.id });
        if (!rows.length) throw new UserError("Regra não encontrada.");
        await logEvent(tx, { actorId: scope.actorId, type: "rule_updated", data: { regra: d.name } });
        return id;
      }
      const [created] = await tx
        .insert(schema.automationRules)
        .values({ ...values, createdBy: scope.actorId })
        .returning({ id: schema.automationRules.id });
      // Veio de uma frase? Marca que o rascunho virou regra (mede o acerto)
      const draftId = z.uuid().safeParse(field(form, "draftId"));
      if (draftId.success) await tx.update(schema.aiRuleDrafts).set({ ruleId: created!.id }).where(eq(schema.aiRuleDrafts.id, draftId.data));
      await logEvent(tx, { actorId: scope.actorId, type: "rule_created", data: { regra: d.name, ...(draftId.success ? { pelaFrase: true } : {}) } });
      return created!.id;
    });
    refreshAutomations();
    return { ok: true, message: id ? "Regra salva." : "Regra criada e ligada.", data: { id: savedId } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function toggleRuleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.automacoes");
  if (!ctx) return NOT_ALLOWED;
  const p = z.object({ id: z.uuid(), enabled: z.enum(["true", "false"]) }).safeParse({ id: field(form, "id"), enabled: field(form, "enabled") });
  if (!p.success) return { ok: false, message: "Inválido." };
  const enabled = p.data.enabled === "true";
  await runCrm(ctx, async (tx, scope) => {
    const [r] = await tx.update(schema.automationRules).set({ enabled }).where(eq(schema.automationRules.id, p.data.id)).returning({ name: schema.automationRules.name });
    // Desligou: o que estava esperando na fila não roda mais
    if (!enabled) {
      await tx
        .update(schema.automationRuns)
        .set({ status: "ignorada", result: "Regra desligada.", doneAt: new Date() })
        .where(sql`${schema.automationRuns.ruleId} = ${p.data.id} and ${schema.automationRuns.status} = 'pendente'`);
    }
    if (r) await logEvent(tx, { actorId: scope.actorId, type: "rule_updated", data: { regra: r.name, ligada: enabled } });
  });
  refreshAutomations();
  return { ok: true, message: enabled ? "Regra ligada." : "Regra desligada." };
}

export async function deleteRuleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.automacoes");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  await runCrm(ctx, async (tx, scope) => {
    const [r] = await tx.delete(schema.automationRules).where(eq(schema.automationRules.id, id.data)).returning({ name: schema.automationRules.name });
    if (r) await logEvent(tx, { actorId: scope.actorId, type: "rule_deleted", data: { regra: r.name } });
  });
  refreshAutomations();
  return { ok: true, message: "Regra excluída." };
}

/** Cria uma regra a partir de uma receita pronta (já ligada; dá para ajustar depois). */
export async function ruleFromRecipeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.automacoes");
  if (!ctx) return NOT_ALLOWED;
  const recipe = RULE_RECIPES.find((r) => r.id === field(form, "recipe"));
  if (!recipe) return { ok: false, message: "Receita não encontrada." };
  const id = await runCrm(ctx, async (tx, scope) => {
    const [created] = await tx
      .insert(schema.automationRules)
      .values({ ...recipe.rule, conditions: recipe.rule.conditions as never, actions: recipe.rule.actions as never, createdBy: scope.actorId })
      .returning({ id: schema.automationRules.id });
    await logEvent(tx, { actorId: scope.actorId, type: "rule_created", data: { regra: recipe.rule.name, receita: recipe.id } });
    return created!.id;
  });
  refreshAutomations();
  return { ok: true, message: `Regra “${recipe.rule.name}” criada e ligada.`, data: { id } };
}

/**
 * "Quando alguém pedir orçamento e não marcar em 2 dias, crie tarefa para a Paula"
 * -> rascunho da regra para o construtor. NADA é salvo como regra aqui: a pessoa
 * revisa e clica em "Criar regra". Fica registrado o pedido (frase do gestor) e quem leu.
 */
export async function ruleFromTextAction(text: string): Promise<({ ok: true; draftId: string } & RuleTextResult) | { ok: false; message: string }> {
  const ctx = await authorizeCrm("config.automacoes");
  if (!ctx) return { ok: false, message: "Você não tem permissão para criar regras." };
  const p = z.string().trim().min(10, "Descreva a regra com um pouco mais de detalhe.").max(600, "Use até 600 caracteres.").safeParse(text);
  if (!p.success) return { ok: false, message: p.error.issues[0]!.message };
  try {
    const plan = await runCrm(ctx, (tx, scope) => planRuleText(tx, scope.actorId));
    // IA fora da transação (rede lenta não prende o banco)
    const result = await draftRuleText(p.data, plan);
    if (!result) return { ok: false, message: "Não entendi a regra. Tente no formato: quando [algo acontecer], se [situação], [o que fazer]. Ou monte em “Nova regra”." };
    const draftId = await runCrm(ctx, async (tx, scope) => {
      const [row] = await tx
        .insert(schema.aiRuleDrafts)
        .values({ actorId: scope.actorId, text: p.data, source: result.source, model: result.model, fallbackReason: result.reason, latencyMs: result.latencyMs })
        .returning({ id: schema.aiRuleDrafts.id });
      return row!.id;
    });
    return { ok: true, draftId, ...result };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    console.error("[regra pela frase]", error);
    return { ok: false, message: "Não foi possível montar a regra agora." };
  }
}

/* ---------------------------- Mensagens automáticas -------------------------- */

export async function saveTemplateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.mensagens");
  if (!ctx) return NOT_ALLOWED;
  const parsed = messageTemplateSchema.safeParse({ key: field(form, "key"), body: field(form, "body"), enabled: field(form, "enabled") !== "false" });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), message: "Revise o texto." };
  const d = parsed.data;
  if (!isTemplateKey(d.key)) return { ok: false, message: "Mensagem desconhecida." };
  const def = templateDef(d.key)!;
  const enabled = def.optional ? d.enabled : true;
  await runCrm(ctx, async (tx, scope) => {
    await tx
      .insert(schema.messageTemplates)
      .values({ key: d.key, body: d.body, enabled, updatedBy: scope.actorId })
      .onConflictDoUpdate({ target: [schema.messageTemplates.clinicId, schema.messageTemplates.key], set: { body: d.body, enabled, updatedBy: scope.actorId, updatedAt: new Date() } });
    await logEvent(tx, { actorId: scope.actorId, type: "template_updated", data: { mensagem: def.label, ligada: enabled } });
  });
  revalidatePath("/configuracoes/mensagens");
  return { ok: true, message: enabled ? "Mensagem salva. Vale a partir do próximo envio." : "Mensagem desligada: não será enviada." };
}

export async function resetTemplateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.mensagens");
  if (!ctx) return NOT_ALLOWED;
  const key = field(form, "key");
  if (!isTemplateKey(key)) return { ok: false, message: "Mensagem desconhecida." };
  await runCrm(ctx, async (tx, scope) => {
    await tx.delete(schema.messageTemplates).where(eq(schema.messageTemplates.key, key));
    await logEvent(tx, { actorId: scope.actorId, type: "template_updated", data: { mensagem: templateDef(key)!.label, padrao: true } });
  });
  revalidatePath("/configuracoes/mensagens");
  return { ok: true, message: "Texto padrão restaurado." };
}
