/**
 * DURAÇÃO REAL DA CONSULTA (estatística pura, sem IA e sem rede)
 *
 * Compara o horário MARCADO com a CHEGADA (botão "Chegou") e a SAÍDA (botão
 * "Finalizar atendimento") para sugerir a duração ideal por profissional e
 * procedimento.
 *
 *  - Duração real = saída − (o mais tarde entre o horário marcado e a chegada).
 *    Assim a espera de quem chegou cedo não conta como consulta, e o atraso de
 *    quem chegou tarde não "encurta" a consulta.
 *  - Sugestão = percentil escolhido pela clínica (padrão 75%: 3 de cada 4
 *    consultas cabem no tempo), arredondado para cima de 5 em 5 minutos.
 *  - Sem pelo menos 5 consultas medidas, não sugere nada (amostra pequena engana).
 *  - Medições absurdas (menos de 3 min ou mais de 8 h: botão esquecido) são descartadas.
 */
import { normalizeText } from "./messages";

export interface DurationSample {
  professionalId: string;
  service: string | null;
  /** Duração marcada (min) */
  scheduledMin: number;
  startsAt: number;
  arrivedAt: number;
  finishedAt: number;
}

export interface DurationRow {
  professionalId: string;
  /** Chave sem acento e minúscula ("clareamento"); "" = sem procedimento */
  serviceKey: string;
  /** Como a equipe mais escreve ("Clareamento") */
  serviceLabel: string;
  n: number;
  scheduledMedian: number;
  realMedian: number;
  realPercentile: number;
  /** Atraso típico de chegada (min; negativo = chega antes) */
  lateMedian: number;
  /** Duração sugerida (min) ou null (poucas medições) */
  suggestion: number | null;
}

export const DURATION_MIN_SAMPLES = 5;
export const serviceKey = (s: string | null | undefined) => normalizeText(s ?? "").replace(/[^a-z0-9 ]/g, "").trim();

function percentile(values: number[], p: number): number {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const idx = (p / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo]! + (v[hi]! - v[lo]!) * (idx - lo);
}

/** Minutos reais de consulta (ou null se a medição não faz sentido) */
export function realMinutes(s: Pick<DurationSample, "startsAt" | "arrivedAt" | "finishedAt">): number | null {
  const start = Math.max(s.startsAt, s.arrivedAt);
  const min = (s.finishedAt - start) / 60_000;
  return min >= 3 && min <= 480 ? min : null;
}

export function summarizeDurations(samples: DurationSample[], opts: { percentile?: number; minSamples?: number } = {}): DurationRow[] {
  const p = opts.percentile ?? 75;
  const minN = opts.minSamples ?? DURATION_MIN_SAMPLES;
  const groups = new Map<string, { s: DurationSample; real: number }[]>();
  for (const s of samples) {
    const real = realMinutes(s);
    if (real === null) continue;
    const key = `${s.professionalId}|${serviceKey(s.service)}`;
    groups.set(key, [...(groups.get(key) ?? []), { s, real }]);
  }
  const rows: DurationRow[] = [];
  for (const [key, list] of groups) {
    const [professionalId, sk] = key.split("|") as [string, string];
    // Rótulo mais usado pela equipe
    const labels = new Map<string, number>();
    for (const { s } of list) if (s.service?.trim()) labels.set(s.service.trim(), (labels.get(s.service.trim()) ?? 0) + 1);
    const label = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const real = list.map((x) => x.real);
    const realP = percentile(real, p);
    rows.push({
      professionalId,
      serviceKey: sk,
      serviceLabel: label,
      n: list.length,
      scheduledMedian: Math.round(percentile(list.map((x) => x.s.scheduledMin), 50)),
      realMedian: Math.round(percentile(real, 50)),
      realPercentile: Math.round(realP),
      lateMedian: Math.round(percentile(list.map((x) => (x.s.arrivedAt - x.s.startsAt) / 60_000), 50)),
      suggestion: list.length >= minN ? Math.min(240, Math.max(10, Math.ceil(realP / 5) * 5)) : null,
    });
  }
  return rows.sort((a, b) => b.n - a.n);
}
