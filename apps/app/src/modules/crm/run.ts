import "server-only";
import { withTenant, type Tx } from "@ecosaude/db";
import type { CrmContext } from "@/lib/auth/dal";
import { hasDueAutomations, runDueAutomations } from "./automations";
import { dispatchQueued } from "./messaging";
import { scopeFrom, type CrmScope } from "./scope";

/**
 * Executa uma regra do Tropi numa transação isolada na clínica e, ao final,
 * despacha as mensagens que ela colocou na fila.
 *
 * O despacho acontece DEPOIS do commit: se algo falhar no meio da regra,
 * nenhuma mensagem sai (tudo ou nada). Também depois do commit rodam as
 * regras da clínica que esta ação disparou para "na hora" (Ajustes > Automações).
 */
export async function runCrm<T>(ctx: CrmContext, fn: (tx: Tx, scope: CrmScope) => Promise<T>, opts: { dispatch?: boolean } = {}): Promise<T> {
  const scope = scopeFrom(ctx);
  const result = await withTenant(scope.clinicId, async (tx) => ({ value: await fn(tx, scope), due: await hasDueAutomations(tx) }));
  // Regras da clínica "na hora" que esta ação disparou (ex.: consulta marcada -> etiqueta)
  const ran = result.due ? await runDueAutomations(scope).catch((e) => (console.error("[automações]", e), 0)) : 0;
  if (opts.dispatch || ran) await dispatchQueued(scope.clinicId);
  return result.value;
}
