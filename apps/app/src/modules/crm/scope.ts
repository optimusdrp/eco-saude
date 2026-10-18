import "server-only";
import type { CrmFeature } from "@ecosaude/core/crm";
import { withTenant, type Tx } from "@ecosaude/db";
import type { CrmContext } from "@/lib/auth/dal";

/**
 * Contexto das regras do CRM: de qual clínica, quem está agindo e quais
 * funcionalidades o plano libera. As regras recebem isto em vez de ler a sessão,
 * então funcionam igual para uma tela, um webhook ou uma rotina agendada.
 */
export interface CrmScope {
  clinicId: string;
  clinicName: string;
  /** null = ação automática (webhook, rotina, automação) */
  actorId: string | null;
  has: (feature: CrmFeature) => boolean;
}

export function scopeFrom(ctx: CrmContext): CrmScope {
  return { clinicId: ctx.user.clinicId, clinicName: ctx.user.clinicName, actorId: ctx.user.id, has: ctx.has };
}

/** Atalho: transação isolada na clínica do contexto. */
export function inTenant<T>(scope: Pick<CrmScope, "clinicId">, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(scope.clinicId, fn);
}
