import "server-only";
import { daysBetween, trainAcceptModel, trainRiskModel, utcToZoned, type CandidateFacts, type LogisticModel, type RiskFacts, type RiskSample, type StoredRiskModel } from "@ecosaude/core/crm";
import { and, desc, eq, inArray, isNotNull, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";
import { backfillHistory, rainByDate } from "./weather";

/**
 * MODELOS APRENDIDOS: treino (rotina diária) e leitura (telas)
 *
 *  - trainClinicModels: monta o histórico, busca a chuva dos dias (fora da
 *    transação), treina e grava o relatório em learned_models. O modelo só fica
 *    "active" se foi aprovado no teste justo; senão vale o plano B (fórmula/pesos fixos)
 *    e o motivo fica visível em Ajustes.
 *  - activeModel: o último aprovado (lido uma vez por transação).
 * O treino é rápido (milissegundos a poucos segundos) e roda no servidor:
 * nenhum dado de paciente sai do sistema.
 */

const HISTORY_MONTHS = 18;
/** Um treino por dia basta: os padrões mudam devagar */
const RETRAIN_HOURS = 20;

/* ------------------------------ Risco de falta ----------------------------- */

interface ApptRow {
  contactId: string;
  startsAt: Date;
  createdAt: Date;
  status: string;
  confirmedAt: Date | null;
  confirmationRequestedAt: Date | null;
}

/** Fatos de cada consulta "como eram na época": histórico só do que veio ANTES dela. */
export function samplesFrom(rows: ApptRow[], rain: Map<string, number | null>): RiskSample[] {
  const byContact = new Map<string, ApptRow[]>();
  for (const r of rows) byContact.set(r.contactId, [...(byContact.get(r.contactId) ?? []), r]);
  const out: RiskSample[] = [];
  for (const list of byContact.values()) {
    list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const outcomes: boolean[] = []; // true = faltou
    for (const a of list) {
      const z = utcToZoned(a.startsAt);
      const recent = outcomes.slice(-3);
      const facts: RiskFacts = {
        weekday: z.weekday,
        minutes: z.minutes,
        leadDays: Math.max(0, daysBetween(a.createdAt, a.startsAt)),
        pastNoShows: outcomes.filter(Boolean).length,
        pastAttended: outcomes.filter((o) => !o).length,
        recentMisses: recent.filter(Boolean).length,
        recentCount: recent.length,
        confirmed: !!a.confirmedAt,
        askedNoReply: !!a.confirmationRequestedAt && !a.confirmedAt,
        rainMm: rain.has(z.date) ? (rain.get(z.date) ?? null) : null,
      };
      const noShow = a.status === "faltou";
      out.push({ facts, noShow, at: a.startsAt.getTime() });
      outcomes.push(noShow);
    }
  }
  return out;
}

/** Treina risco e encaixe se o último treino tiver mais de 20h (ou se force). */
export async function trainClinicModels(clinicId: string, opts: { force?: boolean } = {}): Promise<{ risco: string; encaixe: string } | null> {
  const prep = await withTenant(clinicId, async (tx) => {
    const cfg = await automationSettings(tx);
    if (!opts.force) {
      const [last] = await tx
        .select({ at: schema.learnedModels.trainedAt })
        .from(schema.learnedModels)
        .where(eq(schema.learnedModels.kind, "risco"))
        .orderBy(desc(schema.learnedModels.trainedAt))
        .limit(1);
      if (last && Date.now() - last.at.getTime() < RETRAIN_HOURS * 3_600_000) return null;
    }
    const since = new Date(Date.now() - HISTORY_MONTHS * 30 * 86_400_000);
    const appts = await tx
      .select({
        contactId: schema.appointments.contactId,
        startsAt: schema.appointments.startsAt,
        createdAt: schema.appointments.createdAt,
        status: schema.appointments.status,
        confirmedAt: schema.appointments.confirmedAt,
        confirmationRequestedAt: schema.appointments.confirmationRequestedAt,
      })
      .from(schema.appointments)
      .where(and(inArray(schema.appointments.status, ["compareceu", "faltou"]), sql`${schema.appointments.startsAt} >= ${since}`, sql`${schema.appointments.startsAt} < now()`));
    // Ofertas de encaixe já encerradas, com os fatores guardados no envio
    const offers = await tx
      .select({ features: schema.slotOfferCandidates.features, outcome: schema.slotOfferCandidates.outcome, at: schema.slotOffers.createdAt })
      .from(schema.slotOfferCandidates)
      .innerJoin(schema.slotOffers, eq(schema.slotOffers.id, schema.slotOfferCandidates.offerId))
      .where(and(isNotNull(schema.slotOfferCandidates.features), sql`${schema.slotOffers.status} <> 'aberta'`));
    return { appts, offers, useRain: cfg.ia_risco?.usarChuva !== false };
  });
  if (!prep) return null;

  // Chuva dos dias das consultas (fora da transação; sem internet = sem chuva, segue o treino)
  const dates = [...new Set(prep.appts.map((a) => utcToZoned(a.startsAt).date))];
  if (prep.useRain && dates.length) await backfillHistory(clinicId, dates).catch(() => 0);
  const sorted = [...dates].sort();
  const rain = prep.useRain && sorted.length ? await rainByDate(clinicId, sorted[0]!, sorted[sorted.length - 1]!) : new Map<string, number | null>();

  const risk = trainRiskModel(samplesFrom(prep.appts, rain));
  const accept = trainAcceptModel(prep.offers.map((o) => ({ facts: o.features as unknown as CandidateFacts, accepted: o.outcome === "aceitou" || o.outcome === "atrasado", at: o.at.getTime() })));

  await withTenant(clinicId, async (tx) => {
    if (risk.model) await tx.update(schema.learnedModels).set({ active: false }).where(eq(schema.learnedModels.kind, "risco"));
    await tx.insert(schema.learnedModels).values({ kind: "risco", active: !!risk.model, model: risk.model as unknown as Record<string, unknown> | null, report: { ...risk.report } });
    if (accept.model) await tx.update(schema.learnedModels).set({ active: false }).where(eq(schema.learnedModels.kind, "encaixe"));
    await tx.insert(schema.learnedModels).values({
      kind: "encaixe",
      active: !!accept.model,
      model: accept.model as unknown as Record<string, unknown> | null,
      report: { accepted: !!accept.model, n: prep.offers.length, auc: accept.auc, reason: accept.reason },
    });
  });
  return { risco: risk.model ? "aprovado" : (risk.report.reason ?? "não aprovado"), encaixe: accept.model ? "aprovado" : (accept.reason ?? "não aprovado") };
}

/* ---------------------------------- Leitura -------------------------------- */

const cache = new WeakMap<Tx, Map<string, unknown>>();

/** Último modelo aprovado deste tipo (ou null = plano B). Lido uma vez por transação. */
export async function activeModel<T = StoredRiskModel | LogisticModel>(tx: Tx, kind: "risco" | "encaixe"): Promise<T | null> {
  const c = cache.get(tx) ?? new Map<string, unknown>();
  cache.set(tx, c);
  if (c.has(kind)) return c.get(kind) as T | null;
  const [row] = await tx
    .select({ model: schema.learnedModels.model })
    .from(schema.learnedModels)
    .where(and(eq(schema.learnedModels.kind, kind), eq(schema.learnedModels.active, true)))
    .orderBy(desc(schema.learnedModels.trainedAt))
    .limit(1);
  const model = (row?.model ?? null) as T | null;
  c.set(kind, model);
  return model;
}

/** Último relatório de treino (para Ajustes): aprovado ou o motivo do plano B. */
export async function lastReports(tx: Tx) {
  const rows = await tx
    .select({ kind: schema.learnedModels.kind, active: schema.learnedModels.active, report: schema.learnedModels.report, at: schema.learnedModels.trainedAt })
    .from(schema.learnedModels)
    .orderBy(desc(schema.learnedModels.trainedAt))
    .limit(10);
  return { risco: rows.find((r) => r.kind === "risco") ?? null, encaixe: rows.find((r) => r.kind === "encaixe") ?? null };
}

/** Chuva prevista (mm) para as datas pedidas, do cache (sem chamar a internet aqui). */
export async function forecastFor(tx: Tx, dates: string[]): Promise<Map<string, number | null>> {
  if (!dates.length) return new Map();
  const rows = await tx.select({ date: schema.weatherDays.date, mm: schema.weatherDays.rainMm }).from(schema.weatherDays).where(inArray(schema.weatherDays.date, dates));
  return new Map(rows.map((r) => [r.date, r.mm]));
}
