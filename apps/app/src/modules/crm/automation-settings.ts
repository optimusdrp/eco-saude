import "server-only";
import { automationConfig, type AutomationSettings, type MessageTemplateKey, type TemplateVariables } from "@ecosaude/core/crm";
import { eq, schema, type Tx } from "@ecosaude/db";
import { bestChannel, ensureConversation, queueOutbound } from "./messaging";
import { renderTemplate } from "./templates";

/**
 * Configuração das automações do sistema (liga/desliga e parâmetros), lida
 * UMA vez por transação: várias regras na mesma ação não repetem a consulta.
 */
const cache = new WeakMap<object, Promise<AutomationSettings>>();

export function automationSettings(tx: Tx): Promise<AutomationSettings> {
  let p = cache.get(tx);
  if (!p) {
    p = tx
      .select({ automations: schema.crmSettings.automations })
      .from(schema.crmSettings)
      .limit(1)
      .then((rows) => automationConfig(rows[0]?.automations));
    cache.set(tx, p);
  }
  return p;
}

/** A automação está ligada? (padrões do catálogo quando a clínica nunca mexeu) */
export async function automationOn(tx: Tx, key: string): Promise<boolean> {
  return (await automationSettings(tx))[key]?.enabled === true;
}

/**
 * Envia uma MENSAGEM AUTOMÁTICA a um contato pelo melhor canal.
 * Não envia (e devolve false) quando: a mensagem está desligada, o contato
 * pediu SAIR (se respectOptOut), ou não há como alcançá-lo.
 * Sempre como modelo (templateKey): pode sair fora da janela de 24h.
 */
export async function sendAutomated(tx: Tx, input: { contactId: string; key: MessageTemplateKey; vars: TemplateVariables; meta?: Record<string, unknown>; respectOptOut?: boolean }): Promise<boolean> {
  const [c] = await tx.select({ optedOutAt: schema.contacts.optedOutAt, anonymizedAt: schema.contacts.anonymizedAt }).from(schema.contacts).where(eq(schema.contacts.id, input.contactId));
  // Dados apagados a pedido do titular (LGPD): nunca mais recebe nada, nem aviso de consulta
  if (!c || c.anonymizedAt) return false;
  if (input.respectOptOut !== false && c.optedOutAt) return false;
  const body = await renderTemplate(tx, input.key, input.vars);
  if (!body) return false;
  const channel = await bestChannel(tx, input.contactId);
  if (!channel) return false;
  const conv = await ensureConversation(tx, input.contactId, channel);
  const sent = await queueOutbound(tx, { conversation: conv, body, authorId: null, templateKey: input.key, meta: { kind: "automation", automation: input.key, ...input.meta } });
  return sent !== null;
}
