import "server-only";
import { addDaysIso, todayIso } from "@ecosaude/core/crm";
import { and, db, eq, gte, inArray, lte, schema, sql, withTenant } from "@ecosaude/db";

/**
 * CHUVA POR DIA (para o risco de falta)
 *
 * Fonte: Open-Meteo (gratuita, sem chave, sem dado de paciente: só a cidade da clínica).
 *  - Localização: descoberta uma vez pela cidade/UF da clínica e guardada em crm_settings.geo.
 *  - Previsão: próximos 8 dias, atualizada no máximo a cada 6 horas (rotina de 10 min).
 *  - Histórico: dias passados que o treino do modelo precisa (uma chamada por período).
 * PLANO B: sem internet, serviço fora do ar ou cidade não encontrada = o dia fica sem
 * informação de chuva e o modelo segue sem esse fator (nunca trava nada).
 *
 *   WEATHER_PROVIDER = open-meteo (padrão) | mock (testes, sem internet) | off
 */

const TIMEOUT_MS = 4000;
const provider = () => process.env.WEATHER_PROVIDER ?? "open-meteo";

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Chuva simulada e estável por data (testes sem internet): 1 a cada 4 dias chove forte */
const mockRain = (date: string) => (Number(date.slice(8, 10)) % 4 === 0 ? 12 : 0);

type Geo = { lat: number; lon: number; place: string };

async function ensureGeo(clinicId: string): Promise<Geo | null> {
  const geo = await withTenant(clinicId, async (tx) => (await tx.select({ geo: schema.crmSettings.geo }).from(schema.crmSettings).limit(1))[0]?.geo ?? null);
  // Clínicas ficam fora do isolamento por clínica (tabela da plataforma): consulta direta pelo id
  const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.id, clinicId), columns: { city: true, state: true } });
  const city = clinic?.city ?? null;
  const state = clinic?.state ?? null;
  if (geo) return geo;
  if (!city) return null;
  let found: Geo | null = null;
  if (provider() === "mock") found = { lat: -30.03, lon: -51.23, place: `${city} (simulado)` };
  else {
    const data = await getJson<{ results?: { latitude: number; longitude: number; name: string; admin1?: string }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=pt&country_code=BR`,
    );
    const pick = data?.results?.find((r) => !state || (r.admin1 ?? "").toLowerCase().includes(state.toLowerCase())) ?? data?.results?.[0];
    if (pick) found = { lat: pick.latitude, lon: pick.longitude, place: `${pick.name}${pick.admin1 ? `, ${pick.admin1}` : ""}` };
  }
  if (found) {
    await withTenant(clinicId, (tx) =>
      tx
        .insert(schema.crmSettings)
        .values({ geo: found })
        .onConflictDoUpdate({ target: schema.crmSettings.clinicId, set: { geo: found } }),
    );
  }
  return found;
}

async function save(clinicId: string, rows: { date: string; rainMm: number | null; rainProb: number | null; source: "previsao" | "historico" }[]) {
  if (!rows.length) return;
  await withTenant(clinicId, (tx) =>
    tx
      .insert(schema.weatherDays)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.weatherDays.clinicId, schema.weatherDays.date],
        set: { rainMm: sql`excluded.rain_mm`, rainProb: sql`excluded.rain_prob`, source: sql`excluded.source`, fetchedAt: new Date() },
      }),
  );
}

/** Previsão dos próximos 8 dias (no máximo a cada 6 horas). Devolve se atualizou. */
export async function refreshForecast(clinicId: string): Promise<boolean> {
  if (provider() === "off") return false;
  const today = todayIso();
  const fresh = await withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.weatherDays)
      .where(and(eq(schema.weatherDays.date, addDaysIso(today, 1)), eq(schema.weatherDays.source, "previsao"), sql`${schema.weatherDays.fetchedAt} > now() - interval '6 hours'`));
    return (r?.n ?? 0) > 0;
  });
  if (fresh) return false;
  const geo = await ensureGeo(clinicId);
  if (!geo) return false;
  let rows: { date: string; rainMm: number | null; rainProb: number | null; source: "previsao" }[] = [];
  if (provider() === "mock") rows = Array.from({ length: 8 }, (_, i) => addDaysIso(today, i)).map((date) => ({ date, rainMm: mockRain(date), rainProb: mockRain(date) ? 80 : 10, source: "previsao" }));
  else {
    const d = await getJson<{ daily?: { time: string[]; precipitation_sum: (number | null)[]; precipitation_probability_max: (number | null)[] } }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=precipitation_sum,precipitation_probability_max&timezone=America%2FSao_Paulo&forecast_days=8`,
    );
    rows = (d?.daily?.time ?? []).map((date, i) => ({ date, rainMm: d!.daily!.precipitation_sum[i] ?? null, rainProb: d!.daily!.precipitation_probability_max[i] ?? null, source: "previsao" }));
  }
  await save(clinicId, rows);
  return rows.length > 0;
}

/** Histórico de chuva para os dias que o treino precisa (só os que faltam). */
export async function backfillHistory(clinicId: string, dates: string[]): Promise<number> {
  if (provider() === "off" || !dates.length) return 0;
  const have = await withTenant(clinicId, (tx) =>
    tx
      .select({ date: schema.weatherDays.date })
      .from(schema.weatherDays)
      .where(and(inArray(schema.weatherDays.date, dates), eq(schema.weatherDays.source, "historico"))),
  );
  const missing = [...new Set(dates)].filter((d) => !have.some((h) => h.date === d)).sort();
  if (!missing.length) return 0;
  const geo = await ensureGeo(clinicId);
  if (!geo) return 0;
  let rows: { date: string; rainMm: number | null; rainProb: null; source: "historico" }[] = [];
  if (provider() === "mock") rows = missing.map((date) => ({ date, rainMm: mockRain(date), rainProb: null, source: "historico" }));
  else {
    // Uma chamada para o período inteiro (o arquivo histórico vai até uns 5 dias atrás)
    const d = await getJson<{ daily?: { time: string[]; precipitation_sum: (number | null)[] } }>(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.lat}&longitude=${geo.lon}&start_date=${missing[0]}&end_date=${missing[missing.length - 1]}&daily=precipitation_sum&timezone=America%2FSao_Paulo`,
    );
    const want = new Set(missing);
    rows = (d?.daily?.time ?? []).flatMap((date, i) => (want.has(date) ? [{ date, rainMm: d!.daily!.precipitation_sum[i] ?? null, rainProb: null, source: "historico" as const }] : []));
  }
  await save(clinicId, rows);
  return rows.length;
}

/** Chuva (mm) por data, do que já está guardado (previsão ou histórico). */
export async function rainByDate(clinicId: string, from: string, to: string): Promise<Map<string, number | null>> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({ date: schema.weatherDays.date, mm: schema.weatherDays.rainMm })
      .from(schema.weatherDays)
      .where(and(gte(schema.weatherDays.date, from), lte(schema.weatherDays.date, to))),
  );
  return new Map(rows.map((r) => [r.date, r.mm]));
}
