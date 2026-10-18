import "server-only";
import { bestSendHour, hourHistogram, nextSendAt, type BestTime, type SendWindow } from "@ecosaude/core/crm";
import { and, eq, gt, inArray, schema, sql, type Tx } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";

/**
 * MELHOR HORÁRIO DE ENVIO (dados do servidor; estatística, sem IA)
 *  - bestTimeFor: a melhor hora de cada paciente (pelas mensagens dele dos últimos
 *    6 meses), com o padrão da clínica como apoio para quem escreveu pouco.
 *  - null = funcionalidade desligada em Ajustes (envia na hora, como sempre).
 */

const MONTHS = 6;
const priorCache = new WeakMap<Tx, number[]>();

export async function sendWindow(tx: Tx): Promise<(SendWindow & { useInReturns: boolean }) | null> {
  const cfg = (await automationSettings(tx)).ia_melhor_horario;
  if (!cfg?.enabled) return null;
  const start = typeof cfg.inicio === "number" ? cfg.inicio : 8;
  const end = typeof cfg.fim === "number" ? cfg.fim : 20;
  return { start: Math.min(start, end - 1), end, saturday: cfg.sabado === true, useInReturns: cfg.usarNosRetornos !== false };
}

/** Padrão da clínica: a que horas os pacientes em geral escrevem (uma vez por transação). */
async function clinicPrior(tx: Tx): Promise<number[]> {
  const hit = priorCache.get(tx);
  if (hit) return hit;
  const rows = await tx
    .select({ at: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.direction, "in"), sql`${schema.messages.createdAt} > now() - make_interval(months => ${MONTHS})`))
    .orderBy(sql`${schema.messages.createdAt} desc`)
    .limit(3000);
  const prior = hourHistogram(rows.map((r) => r.at));
  priorCache.set(tx, prior);
  return prior;
}

/** Melhor hora de vários pacientes de uma vez. */
export async function bestTimesFor(tx: Tx, contactIds: string[]): Promise<Map<string, BestTime & { at: Date }>> {
  const w = await sendWindow(tx);
  const out = new Map<string, BestTime & { at: Date }>();
  if (!w || !contactIds.length) return out;
  const prior = await clinicPrior(tx);
  const rows = await tx
    .select({ contactId: schema.conversations.contactId, at: schema.messages.createdAt })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(inArray(schema.conversations.contactId, contactIds), eq(schema.messages.direction, "in"), gt(schema.messages.createdAt, new Date(Date.now() - MONTHS * 30 * 86_400_000))));
  for (const id of contactIds) {
    const best = bestSendHour(
      rows.filter((r) => r.contactId === id).map((r) => r.at),
      w,
      prior,
    );
    out.set(id, { ...best, at: nextSendAt(best.hour, w) });
  }
  return out;
}
