import "server-only";
import { fillTemplate, LEGACY_QUICK_REPLY_SHORTCUT, templateDef, type MessageTemplateKey, type TemplateVariables } from "@ecosaude/core/crm";
import { and, eq, schema, type Tx } from "@ecosaude/db";

/**
 * MENSAGENS AUTOMÁTICAS no servidor.
 *
 * Ordem de escolha do texto:
 *   1. o texto da clínica (Ajustes > Mensagens automáticas)
 *   2. compatibilidade: resposta rápida aprovada com o atalho antigo (/confirmar, /pesquisa...)
 *   3. o texto padrão do catálogo
 *
 * Mensagem desligada pela clínica devolve null: quem chamou NÃO envia nada.
 */
export async function templateText(tx: Tx, key: MessageTemplateKey): Promise<string | null> {
  const def = templateDef(key);
  if (!def) throw new Error(`Modelo desconhecido: ${key}`);
  const [own] = await tx.select({ body: schema.messageTemplates.body, enabled: schema.messageTemplates.enabled }).from(schema.messageTemplates).where(eq(schema.messageTemplates.key, key));
  if (own) return own.enabled || !def.optional ? own.body : null;
  const legacy = LEGACY_QUICK_REPLY_SHORTCUT[key];
  if (legacy) {
    const [qr] = await tx
      .select({ body: schema.quickReplies.body })
      .from(schema.quickReplies)
      .where(and(eq(schema.quickReplies.shortcut, legacy), eq(schema.quickReplies.approvedTemplate, true)));
    if (qr) return qr.body;
  }
  return def.body;
}

/** Texto final, já com as variáveis preenchidas (null = mensagem desligada). */
export async function renderTemplate(tx: Tx, key: MessageTemplateKey, vars: TemplateVariables): Promise<string | null> {
  const body = await templateText(tx, key);
  return body === null ? null : fillTemplate(body, vars);
}
