import "server-only";
import { daysBetween, noShowRisk, predictRisk, utcToZoned, type NoShowRisk, type StoredRiskModel } from "@ecosaude/core/crm";
import { and, inArray, lt, schema, type Tx } from "@ecosaude/db";
import { automationSettings } from "./automation-settings";
import { activeModel, forecastFor } from "./ml/models";

/**
 * RISCO DE FALTA de várias consultas de uma vez (Hoje, Agenda, ficha, trilho).
 *
 *  - Com "Risco de falta aprendido" ligado em Ajustes > Inteligência artificial E um
 *    modelo aprovado no teste justo: usa o modelo da clínica (dia, horário,
 *    antecedência, chuva prevista, histórico e confirmação).
 *  - Senão (desligado, poucos dados, modelo reprovado): PLANO B = a fórmula de sempre.
 * O formato é o mesmo nos dois casos (nota, nível, motivos em português, sugestão);
 * `source` diz de onde veio.
 * Tudo em poucas consultas ao banco (histórico de todos os pacientes de uma vez).
 */
export async function riskFor(
  tx: Tx,
  appts: { id: string; contactId: string; startsAt: Date; createdAt: Date; status: string }[],
  now = new Date(),
): Promise<Map<string, NoShowRisk & { source?: "modelo" | "regras" }>> {
  const result = new Map<string, NoShowRisk & { source?: "modelo" | "regras" }>();
  const active = appts.filter((a) => (a.status === "agendado" || a.status === "confirmado") && a.startsAt > now);
  if (active.length === 0) return result;

  const cfg = (await automationSettings(tx)).ia_risco;
  const model = cfg?.enabled ? await activeModel<StoredRiskModel>(tx, "risco") : null;

  const contactIds = [...new Set(active.map((a) => a.contactId))];
  // Histórico de cada paciente, na ordem (para "faltou 2 das últimas 3")
  const past = await tx
    .select({ contactId: schema.appointments.contactId, status: schema.appointments.status })
    .from(schema.appointments)
    .where(and(inArray(schema.appointments.contactId, contactIds), lt(schema.appointments.startsAt, now), inArray(schema.appointments.status, ["compareceu", "faltou"])))
    .orderBy(schema.appointments.contactId, schema.appointments.startsAt);
  const history = new Map<string, boolean[]>();
  for (const p of past) history.set(p.contactId, [...(history.get(p.contactId) ?? []), p.status === "faltou"]);

  // O modelo usa também: pedido de confirmação sem resposta e chuva prevista
  const extra = model
    ? await tx
        .select({ id: schema.appointments.id, requested: schema.appointments.confirmationRequestedAt, confirmedAt: schema.appointments.confirmedAt })
        .from(schema.appointments)
        .where(
          inArray(
            schema.appointments.id,
            active.map((a) => a.id),
          ),
        )
    : [];
  const rain = model?.useRain && cfg?.usarChuva !== false ? await forecastFor(tx, [...new Set(active.map((a) => utcToZoned(a.startsAt).date))]) : new Map<string, number | null>();

  for (const a of active) {
    const outcomes = history.get(a.contactId) ?? [];
    const pastNoShows = outcomes.filter(Boolean).length;
    const pastAttended = outcomes.length - pastNoShows;
    const leadDays = Math.max(0, daysBetween(a.createdAt, a.startsAt));
    const confirmed = a.status === "confirmado";
    if (model) {
      const z = utcToZoned(a.startsAt);
      const recent = outcomes.slice(-3);
      const e = extra.find((x) => x.id === a.id);
      result.set(
        a.id,
        predictRisk(model, {
          weekday: z.weekday,
          minutes: z.minutes,
          leadDays,
          pastNoShows,
          pastAttended,
          recentMisses: recent.filter(Boolean).length,
          recentCount: recent.length,
          confirmed,
          askedNoReply: !!e?.requested && !e.confirmedAt && !confirmed,
          rainMm: model.useRain && cfg?.usarChuva !== false ? (rain.get(z.date) ?? null) : null,
        }),
      );
    } else {
      result.set(a.id, { ...noShowRisk({ pastNoShows, pastAttended, confirmed, hoursUntil: (a.startsAt.getTime() - now.getTime()) / 3_600_000, leadTimeDays: leadDays }), source: "regras" });
    }
  }
  return result;
}
