/**
 * APRENDIZADO DE MÁQUINA SIMPLES E AUDITÁVEL (sem dependências, sem rede)
 *
 * Regressão logística com regularização L2, treinada por gradiente.
 * Por que este modelo (e não uma IA generativa nem uma "caixa-preta"):
 *  - dá PROBABILIDADE calibrada (0 a 1), não um texto;
 *  - cada fator tem um PESO legível: dá para explicar "por que" em português;
 *  - treina em milissegundos com o histórico da própria clínica, no servidor
 *    (nenhum dado de paciente sai do sistema: LGPD);
 *  - é reproduzível: mesmos dados, mesmo resultado.
 */

export interface LogisticModel {
  names: string[];
  weights: number[];
  bias: number;
  /** Padronização (média e desvio de cada fator no treino) */
  means: number[];
  stds: number[];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** Treina. X = linhas de fatores (mesma ordem de `names`); y = 1 (aconteceu) ou 0. */
export function trainLogistic(names: string[], X: number[][], y: number[], opts: { l2?: number; epochs?: number; lr?: number } = {}): LogisticModel {
  const { l2 = 0.05, epochs = 400, lr = 0.3 } = opts;
  const n = X.length;
  const k = names.length;
  const means = Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[j]!, 0) / Math.max(1, n));
  const stds = Array.from({ length: k }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j]! - means[j]!) ** 2, 0) / Math.max(1, n)) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - means[j]!) / stds[j]!));
  const w = new Array<number>(k).fill(0);
  // Começa na taxa base (o modelo "sem fatores" já acerta a média)
  const rate = Math.min(0.99, Math.max(0.01, y.reduce((s, v) => s + v, 0) / Math.max(1, n)));
  let b = Math.log(rate / (1 - rate));
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(k).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const zi = Z[i]!;
      let z = b;
      for (let j = 0; j < k; j++) z += w[j]! * zi[j]!;
      const err = sigmoid(z) - y[i]!;
      gb += err;
      for (let j = 0; j < k; j++) gw[j]! += err * zi[j]!;
    }
    for (let j = 0; j < k; j++) w[j]! -= lr * (gw[j]! / n + l2 * w[j]!);
    b -= lr * (gb / n);
  }
  return { names, weights: w, bias: b, means, stds };
}

/** Probabilidade (0 a 1) e a contribuição de cada fator (em "log-chances", positiva = aumenta). */
export function predictLogistic(m: LogisticModel, x: number[]): { p: number; contributions: number[] } {
  const contributions = x.map((v, j) => m.weights[j]! * ((v - m.means[j]!) / m.stds[j]!));
  return { p: sigmoid(m.bias + contributions.reduce((s, c) => s + c, 0)), contributions };
}

/**
 * AUC (área sob a curva ROC): chance de o modelo dar nota maior a um caso
 * positivo do que a um negativo. 0,5 = sorteio; 1 = perfeito.
 */
export function auc(scores: number[], labels: number[]): number {
  const pairs = scores.map((s, i) => ({ s, y: labels[i]! })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let pos = 0;
  // Ranks médios em empates
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j]!.s === pairs[i]!.s) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let t = i; t < j; t++) if (pairs[t]!.y === 1) {
      rankSum += avgRank;
      pos++;
    }
    i = j;
  }
  const neg = pairs.length - pos;
  if (!pos || !neg) return 0.5;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}
