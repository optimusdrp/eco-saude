import "server-only";
import type { Channel } from "@ecosaude/channels";
import { SUBSCRIPTION_ENABLED_STATUSES } from "@ecosaude/core";
import { and, db, eq, getClinicEntitlements, inArray, schema } from "@ecosaude/db";
import type { CrmScope } from "./scope";

/**
 * Contexto para ações SEM usuário logado (webhooks e rotinas agendadas).
 *
 * Estas são as ÚNICAS leituras feitas fora do isolamento por clínica, e só
 * servem para descobrir DE QUAL clínica é o evento. Todo o resto roda
 * depois com withTenant (RLS).
 */

/** Monta o escopo de automação de uma clínica (só se o Tropi estiver contratado). */
export async function systemScope(clinicId: string): Promise<CrmScope | null> {
  const [clinic] = await db.select({ id: schema.clinics.id, name: schema.clinics.tradeName }).from(schema.clinics).where(eq(schema.clinics.id, clinicId));
  if (!clinic) return null;
  const ent = await getClinicEntitlements(clinicId);
  if (!ent.modules.includes("crm")) return null;
  return { clinicId, clinicName: clinic.name, actorId: null, has: (f) => ent.features.includes(f) };
}

/** Qual clínica é dona desta conta do provedor (número, página, bot)? */
export async function clinicForAccount(channel: Channel, accountId: string | null): Promise<{ clinicId: string; mode: "simulacao" | "real"; active: boolean } | null> {
  if (!accountId) return null;
  const [row] = await db
    .select({ clinicId: schema.channelConnections.clinicId, mode: schema.channelConnections.mode, active: schema.channelConnections.active })
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.channel, channel), eq(schema.channelConnections.externalAccountId, accountId)));
  return row ?? null;
}

/**
 * Atualiza o estado da conexão a partir do PROVEDOR (ex.: o celular desconectou o WhatsApp).
 * Conectou: o canal passa a real. Caiu: volta a "desconectado" (a fila espera; nada é perdido)
 * e fica registrado na atividade da clínica.
 */
export async function updateConnectionFromProvider(
  channel: Channel,
  accountId: string,
  patch: { state: "conectado" | "conectando" | "desconectado"; displayName?: string; error?: string | null },
): Promise<{ clinicId: string; changed: boolean } | null> {
  const [row] = await db
    .select({ id: schema.channelConnections.id, clinicId: schema.channelConnections.clinicId, state: schema.channelConnections.connectionState })
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.channel, channel), eq(schema.channelConnections.externalAccountId, accountId)));
  if (!row) return null;
  const changed = row.state !== patch.state;
  await db
    .update(schema.channelConnections)
    .set({
      connectionState: patch.state,
      ...(changed ? { stateAt: new Date() } : {}),
      ...(patch.state === "conectado" ? { mode: "real" as const, lastError: null } : {}),
      ...(patch.displayName ? { displayName: patch.displayName } : {}),
      ...(patch.error !== undefined ? { lastError: patch.error } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.channelConnections.id, row.id));
  if (changed && (patch.state === "conectado" || row.state === "conectado")) {
    await db.insert(schema.crmEvents).values({ clinicId: row.clinicId, actorId: null, type: patch.state === "conectado" ? "channel_connected" : "channel_disconnected", data: { canal: channel, ...(patch.error ? { motivo: patch.error } : {}) } });
  }
  return { clinicId: row.clinicId, changed };
}

/** Qual clínica enviou a mensagem com este ID do provedor (para status de entrega)? */
export async function clinicForMessage(channel: Channel, externalMessageId: string): Promise<string | null> {
  const [row] = await db
    .select({ clinicId: schema.messages.clinicId })
    .from(schema.messages)
    .where(and(eq(schema.messages.channel, channel), eq(schema.messages.externalId, externalMessageId)))
    .limit(1);
  return row?.clinicId ?? null;
}

/** Clínicas com o Tropi contratado (teste ou ativa), para as rotinas agendadas. */
export async function crmClinicIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ clinicId: schema.subscriptions.clinicId })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.moduleId, "crm"), inArray(schema.subscriptions.status, [...SUBSCRIPTION_ENABLED_STATUSES])));
  return rows.map((r) => r.clinicId);
}
