/**
 * MELHOR HORÁRIO PARA ENVIAR (estatística pura, sem IA e sem rede)
 *
 * Quando cada paciente costuma responder? Olha as horas em que ele ESCREVEU para a
 * clínica (mais peso para as recentes) e escolhe a melhor hora dentro da janela de
 * envio da clínica. Com poucas mensagens, usa o padrão da própria clínica (plano B);
 * sem nada, o início da janela.
 */
import { clinicTimeZone } from "./timezones";
import { addDaysIso, utcToZoned, zonedToUtc } from "./time";

export interface SendWindow {
  /** Hora inicial e final permitidas para envio (0 a 23), ex.: 8 e 20 */
  start: number;
  end: number;
  /** Enviar aos sábados? (domingo nunca) */
  saturday: boolean;
}

export interface BestTime {
  /** Hora local (0 a 23) */
  hour: number;
  /** "de manhã (9h às 11h)" */
  label: string;
  /** Quantas mensagens do paciente embasam (0 = padrão da clínica) */
  basis: number;
  source: "paciente" | "clinica" | "padrao";
}

export const MIN_MESSAGES = 4;
const HALF_LIFE_DAYS = 60;

/** Histograma por hora (peso maior para mensagens recentes) */
export function hourHistogram(inbound: Date[], now = new Date(), tz = clinicTimeZone()): number[] {
  const h = new Array<number>(24).fill(0);
  for (const at of inbound) {
    const age = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
    h[Math.floor(utcToZoned(at, tz).minutes / 60)]! += Math.pow(0.5, age / HALF_LIFE_DAYS);
  }
  return h;
}

const period = (h: number) => (h < 12 ? "de manhã" : h < 18 ? "à tarde" : "à noite");

/** A melhor hora para este paciente (janela de 2 horas com mais respostas). */
export function bestSendHour(inbound: Date[], w: SendWindow, clinicPrior?: number[], now = new Date()): BestTime {
  const hist = hourHistogram(inbound, now);
  const own = inbound.length >= MIN_MESSAGES;
  const prior = clinicPrior && clinicPrior.some((v) => v > 0) ? clinicPrior : null;
  // Janela de 2 horas: a hora e metade da seguinte (quem responde às 9h também responde às 10h)
  const windowShare = (h: number[], hr: number) => {
    const total = h.reduce((s, v) => s + v, 0);
    return total ? (h[hr]! + 0.5 * (h[hr + 1] ?? 0)) / total : 0;
  };
  // Com mensagens suficientes vale o paciente; com poucas, pesa mais o padrão da clínica
  const wOwn = own ? 1 : 0.3;
  const wPrior = prior ? (own ? 0.15 : 1) : 0;
  const score = (hr: number) => wOwn * windowShare(hist, hr) + wPrior * (prior ? windowShare(prior, hr) : 0);
  let best = w.start;
  let bestScore = -1;
  for (let hr = w.start; hr < w.end; hr++) {
    const s = score(hr);
    if (s > bestScore) {
      best = hr;
      bestScore = s;
    }
  }
  const source: BestTime["source"] = own ? "paciente" : prior ? "clinica" : "padrao";
  return { hour: best, label: `${period(best)} (${best}h às ${Math.min(w.end, best + 2)}h)`, basis: own ? inbound.length : 0, source };
}

/** Próximo momento de envio nessa hora (hoje, se ainda dá; senão o próximo dia permitido). */
export function nextSendAt(hour: number, w: SendWindow, now = new Date(), tz = clinicTimeZone()): Date {
  const z = utcToZoned(now, tz);
  for (let i = 0; i < 8; i++) {
    const date = addDaysIso(z.date, i);
    const wd = utcToZoned(zonedToUtc(date, "12:00", tz), tz).weekday;
    if (wd === 0 || (wd === 6 && !w.saturday)) continue;
    const at = zonedToUtc(date, `${String(hour).padStart(2, "0")}:00`, tz);
    if (at.getTime() > now.getTime() + 2 * 60_000) return at;
    // Hoje, dentro da janela mas a hora ideal já passou: envia agora se ainda está na janela
    if (i === 0 && z.minutes / 60 >= hour && z.minutes / 60 < Math.min(w.end, hour + 2)) return new Date(now.getTime() + 2 * 60_000);
  }
  return new Date(now.getTime() + 2 * 60_000);
}
