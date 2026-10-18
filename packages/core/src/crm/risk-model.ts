/**
 * RISCO DE FALTA APRENDIDO COM OS DADOS DA CLÍNICA
 *
 * Substitui a fórmula fixa (noShowRisk) por uma regressão logística treinada com
 * o histórico da própria clínica: dia da semana, horário, antecedência da marcação,
 * chuva prevista, histórico do paciente e confirmação.
 *
 * Regras de segurança (o modelo só assume se MERECER):
 *  - mínimo de consultas com desfecho (compareceu/faltou) e de faltas para aprender;
 *  - teste justo: treina com as consultas mais ANTIGAS e mede nas mais RECENTES
 *    (que ele não viu). Só é usado se acertar MAIS que a fórmula atual nesse teste;
 *  - senão, PLANO B: a fórmula de sempre (com o motivo registrado).
 *
 * A explicação continua em português e vem do PESO REAL de cada fator naquela
 * consulta ("Faltou 2 das últimas 3", "Sexta costuma ter mais faltas nesta clínica").
 * Nada é inventado e nada sai do servidor.
 */
import { auc, predictLogistic, trainLogistic, type LogisticModel } from "./ml";
import { noShowRisk, type NoShowRisk, type RiskLevel } from "./scheduling";

/** O que se sabe de uma consulta (no momento do cálculo ou, no treino, da época dela). */
export interface RiskFacts {
  /** 0 = domingo */
  weekday: number;
  /** Minutos desde 0h (horário local) */
  minutes: number;
  /** Dias entre a marcação e a consulta */
  leadDays: number;
  pastNoShows: number;
  pastAttended: number;
  /** Faltas entre as últimas (até 3) consultas com desfecho */
  recentMisses: number;
  /** Quantas consultas entraram no "últimas" (0 a 3) */
  recentCount: number;
  confirmed: boolean;
  /** Pedimos confirmação e não houve resposta */
  askedNoReply: boolean;
  /** Chuva prevista/ocorrida no dia (mm). null = sem informação */
  rainMm: number | null;
}

const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const HEAVY_RAIN_MM = 5;

const BASE_FEATURES = [
  "taxa_faltas",
  "faltas_recentes",
  "primeira",
  "historico",
  "confirmou",
  "sem_resposta",
  "antecedencia",
  "dia_1",
  "dia_2",
  "dia_3",
  "dia_4",
  "dia_5",
  "dia_6",
  "hora_cedo",
  "hora_almoco",
  "hora_fim",
] as const;

export function riskFeatureNames(useRain: boolean): string[] {
  return useRain ? [...BASE_FEATURES, "chuva"] : [...BASE_FEATURES];
}

export function riskVector(f: RiskFacts, useRain: boolean): number[] {
  const total = f.pastNoShows + f.pastAttended;
  const v = [
    total ? f.pastNoShows / total : 0,
    f.recentMisses,
    total === 0 ? 1 : 0,
    Math.log1p(total),
    f.confirmed ? 1 : 0,
    f.askedNoReply ? 1 : 0,
    Math.log1p(Math.max(0, f.leadDays)),
    ...[1, 2, 3, 4, 5, 6].map((d) => (f.weekday === d ? 1 : 0)),
    f.minutes < 9 * 60 ? 1 : 0,
    f.minutes >= 12 * 60 && f.minutes < 14 * 60 ? 1 : 0,
    f.minutes >= 17 * 60 ? 1 : 0,
  ];
  if (useRain) v.push(f.rainMm !== null && f.rainMm >= HEAVY_RAIN_MM ? 1 : 0);
  return v;
}

export interface StoredRiskModel extends LogisticModel {
  useRain: boolean;
  /** Taxa de faltas no treino (0 a 1) */
  baseRate: number;
  n: number;
  noShows: number;
  /** Acerto no teste (consultas recentes que o modelo não viu) */
  auc: number;
  /** Acerto da fórmula antiga no MESMO teste */
  aucFormula: number;
}

export interface RiskSample {
  facts: RiskFacts;
  noShow: boolean;
  /** Momento da consulta (ms): separa treino (antigas) e teste (recentes) */
  at: number;
}

export interface RiskTrainReport {
  accepted: boolean;
  n: number;
  noShows: number;
  auc: number | null;
  aucFormula: number | null;
  /** Por que não foi usado (plano B), em português */
  reason: string | null;
}

export const RISK_MIN_SAMPLES = 150;
export const RISK_MIN_NOSHOWS = 12;
/** Melhor que sorteio com folga */
export const RISK_MIN_AUC = 0.6;

/** Nota da fórmula antiga (para comparar no mesmo teste) */
const formulaScore = (f: RiskFacts) => noShowRisk({ pastNoShows: f.pastNoShows, pastAttended: f.pastAttended, confirmed: f.confirmed, hoursUntil: 24, leadTimeDays: f.leadDays }).score;

/**
 * Treina e decide se o modelo pode substituir a fórmula.
 * Usa a chuva como fator só se houver informação de chuva em pelo menos 60% das consultas.
 */
export function trainRiskModel(samples: RiskSample[]): { model: StoredRiskModel | null; report: RiskTrainReport } {
  const n = samples.length;
  const noShows = samples.filter((s) => s.noShow).length;
  const fail = (reason: string, a: number | null = null, af: number | null = null) => ({ model: null, report: { accepted: false, n, noShows, auc: a, aucFormula: af, reason } });
  if (n < RISK_MIN_SAMPLES) return fail(`poucas consultas com desfecho (${n} de ${RISK_MIN_SAMPLES} necessárias)`);
  if (noShows < RISK_MIN_NOSHOWS) return fail(`poucas faltas para aprender (${noShows} de ${RISK_MIN_NOSHOWS} necessárias)`);

  const useRain = samples.filter((s) => s.facts.rainMm !== null).length / n >= 0.6;
  const names = riskFeatureNames(useRain);
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const cut = Math.floor(n * 0.8);
  const train = sorted.slice(0, cut);
  const test = sorted.slice(cut);
  const toX = (rows: RiskSample[]) => rows.map((s) => riskVector(s.facts, useRain));
  const toY = (rows: RiskSample[]) => rows.map((s) => (s.noShow ? 1 : 0));

  const trial = trainLogistic(names, toX(train), toY(train));
  const yTest = toY(test);
  const aucModel = auc(
    test.map((s) => predictLogistic(trial, riskVector(s.facts, useRain)).p),
    yTest,
  );
  const aucFormula = auc(
    test.map((s) => formulaScore(s.facts)),
    yTest,
  );
  const round = (v: number) => Math.round(v * 1000) / 1000;
  if (yTest.every((v) => v === 0) || yTest.every((v) => v === 1)) return fail("o período de teste não tem faltas e comparecimentos suficientes");
  if (aucModel < RISK_MIN_AUC) return fail(`o modelo não acertou o suficiente no teste (${pct(aucModel)})`, round(aucModel), round(aucFormula));
  if (aucModel < aucFormula) return fail(`a fórmula atual acertou mais no teste (${pct(aucFormula)} contra ${pct(aucModel)})`, round(aucModel), round(aucFormula));

  // Aprovado: treina de novo com TODOS os dados para usar no dia a dia
  const final = trainLogistic(names, toX(sorted), toY(sorted));
  return {
    model: { ...final, useRain, baseRate: noShows / n, n, noShows, auc: round(aucModel), aucFormula: round(aucFormula) },
    report: { accepted: true, n, noShows, auc: round(aucModel), aucFormula: round(aucFormula), reason: null },
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/* ------------------------------ Previsão ---------------------------------- */

export const RISK_LEVEL_FROM_P = (p: number): RiskLevel => (p >= 0.35 ? "alto" : p >= 0.18 ? "medio" : "baixo");

/**
 * Frase em português para o fator, usando os valores reais da consulta.
 * `up` = o fator AUMENTA o risco nesta consulta (o texto acompanha o sinal do peso:
 * "quarta costuma ter MENOS faltas" quando a quarta puxa para baixo).
 */
function phrase(name: string, f: RiskFacts, up: boolean): string | null {
  const more = up ? "mais" : "menos";
  const total = f.pastNoShows + f.pastAttended;
  switch (name) {
    case "taxa_faltas":
    case "faltas_recentes":
      if (f.recentMisses > 0) return `Faltou ${f.recentMisses} das últimas ${f.recentCount}`;
      return f.pastNoShows > 0 ? `Faltou ${f.pastNoShows} de ${total} ${total === 1 ? "consulta" : "consultas"}` : null;
    case "primeira":
      return total === 0 ? "Primeira consulta na clínica" : null;
    case "historico":
      return f.pastNoShows === 0 && total >= 2 ? `Compareceu às últimas ${total} consultas` : null;
    case "confirmou":
      return f.confirmed ? "Já confirmou" : null;
    case "sem_resposta":
      return f.askedNoReply ? "Pedimos confirmação e ainda não respondeu" : null;
    case "antecedencia":
      return up && f.leadDays >= 7 ? `Marcada há ${f.leadDays} dias` : !up && f.leadDays <= 3 ? "Marcada há poucos dias" : null;
    case "hora_cedo":
      return f.minutes < 9 * 60 ? `Começo da manhã costuma ter ${more} faltas nesta clínica` : null;
    case "hora_almoco":
      return f.minutes >= 12 * 60 && f.minutes < 14 * 60 ? `Horário de almoço costuma ter ${more} faltas nesta clínica` : null;
    case "hora_fim":
      return f.minutes >= 17 * 60 ? `Fim do dia costuma ter ${more} faltas nesta clínica` : null;
    case "chuva":
      return f.rainMm !== null && f.rainMm >= HEAVY_RAIN_MM ? `Previsão de chuva no dia (${Math.round(f.rainMm)} mm)` : null;
    default:
      if (name.startsWith("dia_") && f.weekday === Number(name.slice(4))) return `${WEEKDAY[f.weekday]} costuma ter ${more} faltas nesta clínica`;
      return null;
  }
}

/**
 * Risco pelo modelo, com até 3 motivos que AUMENTAM o risco e 1 que DIMINUI,
 * na ordem do peso real. Mantém o mesmo formato de antes (NoShowRisk).
 */
export function predictRisk(m: StoredRiskModel, f: RiskFacts): NoShowRisk & { source: "modelo" } {
  const { p, contributions } = predictLogistic(m, riskVector(f, m.useRain));
  const items = m.names.map((name, i) => ({ name, c: contributions[i]!, text: phrase(name, f, contributions[i]! > 0) })).filter((x) => x.text);
  const ups = items.filter((x) => x.c > 0.12).sort((a, b) => b.c - a.c);
  const downs = items.filter((x) => x.c < -0.1).sort((a, b) => a.c - b.c);
  const score = Math.max(1, Math.min(99, Math.round(p * 100)));
  const level = RISK_LEVEL_FROM_P(p);
  // A explicação acompanha a conclusão: risco baixo mostra o que PUXA PARA BAIXO
  // (não faz sentido explicar 6% com "quarta costuma ter mais faltas")
  const chosen = level === "baixo" ? [...downs.slice(0, 2), ...ups.slice(0, 1)] : [...ups.slice(0, 3), ...downs.slice(0, 1)];
  // "taxa" e "recentes" contam a mesma história: uma frase só
  const reasons = [...new Set(chosen.map((x) => x.text!))];
  if (!reasons.length) reasons.push(`Parecida com a média da clínica (${Math.round(m.baseRate * 100)}% de faltas)`);
  const suggestion =
    level === "alto"
      ? f.confirmed
        ? "Envie um lembrete no dia, pelo canal preferido."
        : "Peça confirmação agora e deixe um paciente da lista de espera avisado."
      : level === "medio" && !f.confirmed
        ? "Peça confirmação."
        : null;
  return { score, level, reasons, suggestion, source: "modelo" };
}
