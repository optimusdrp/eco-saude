/**
 * ENCAIXE INTELIGENTE: quem da lista de espera tem mais chance de ACEITAR a vaga
 *
 * Antes: ordem de chegada. Agora: uma nota de 0 a 100 ("chance de aceitar") com os
 * motivos em português, e a ordem de chegada como desempate.
 *
 *  - scoreCandidate (PLANO B e ponto de partida): pesos fixos e transparentes,
 *    baseados no que faz alguém aceitar um encaixe: pediu exatamente este período
 *    e profissional, já aceitou ofertas antes, está com a conversa ativa (vê a
 *    mensagem a tempo), costuma comparecer, espera há muito tempo.
 *  - Quando a clínica acumula ofertas respondidas suficientes, o MESMO conjunto de
 *    fatores é aprendido com os dados dela (regressão logística, ml.ts) e só
 *    substitui os pesos fixos se acertar mais num teste justo.
 * Os fatores de cada oferta ficam guardados no momento do envio: é isso que permite
 * aprender depois sem "adivinhar" como era a situação na época.
 */
import { auc, predictLogistic, trainLogistic, type LogisticModel } from "./ml";

export interface CandidateFacts {
  /** Pediu este período exato (manhã/tarde), e não "qualquer" */
  periodExact: boolean;
  /** Pediu este profissional (e não "qualquer") */
  professionalExact: boolean;
  /** Dias na lista de espera */
  waitingDays: number;
  offersAccepted: number;
  offersDeclined: number;
  /** Ofertas sem resposta */
  offersIgnored: number;
  /** Comparecimento histórico (0 a 1); null = nunca veio */
  attendanceRate: number | null;
  /** Escreveu para a clínica nas últimas 24h (vê a oferta na hora e a mensagem é livre no WhatsApp) */
  activeLast24h: boolean;
  /** Horas até a vaga (vaga muito em cima favorece quem está ativo) */
  hoursUntilSlot: number;
}

export const CANDIDATE_FEATURES = ["periodo", "profissional", "espera", "aceitou", "recusou", "ignorou", "comparece", "ativo", "ativo_urgente"] as const;

export function candidateVector(f: CandidateFacts): number[] {
  const soon = f.hoursUntilSlot <= 6;
  return [
    f.periodExact ? 1 : 0,
    f.professionalExact ? 1 : 0,
    Math.log1p(Math.max(0, f.waitingDays)),
    Math.min(3, f.offersAccepted),
    Math.min(3, f.offersDeclined),
    Math.min(3, f.offersIgnored),
    f.attendanceRate ?? 0.75,
    f.activeLast24h ? 1 : 0,
    f.activeLast24h && soon ? 1 : 0,
  ];
}

/** Pesos fixos do plano B (em "log-chances"), escolhidos para serem fáceis de explicar */
const FIXED: Record<(typeof CANDIDATE_FEATURES)[number], number> = {
  periodo: 0.5,
  profissional: 0.4,
  espera: 0.15,
  aceitou: 0.7,
  recusou: -0.45,
  ignorou: -0.6,
  comparece: 1.2,
  ativo: 0.6,
  ativo_urgente: 0.6,
};
const FIXED_BIAS = -1.6;

export interface CandidateScore {
  /** 0 a 100: chance estimada de aceitar */
  score: number;
  reasons: string[];
  source: "aprendido" | "regras";
}

function reasonsFor(f: CandidateFacts): { up: string[]; down: string[] } {
  const up: string[] = [];
  const down: string[] = [];
  if (f.offersAccepted) up.push(`Aceitou ${f.offersAccepted} ${f.offersAccepted === 1 ? "oferta" : "ofertas"} antes`);
  if (f.activeLast24h) up.push(f.hoursUntilSlot <= 6 ? "Conversou nas últimas 24h (vê a oferta a tempo)" : "Conversou nas últimas 24h");
  if (f.periodExact) up.push("Pediu exatamente este período");
  if (f.professionalExact) up.push("Pediu este profissional");
  if (f.attendanceRate !== null && f.attendanceRate >= 0.9) up.push("Costuma comparecer");
  if (f.waitingDays >= 14) up.push(`Espera há ${Math.round(f.waitingDays)} dias`);
  if (f.offersIgnored) down.push(`Não respondeu ${f.offersIgnored} ${f.offersIgnored === 1 ? "oferta" : "ofertas"}`);
  if (f.offersDeclined) down.push(`Recusou ${f.offersDeclined} ${f.offersDeclined === 1 ? "oferta" : "ofertas"}`);
  if (f.attendanceRate !== null && f.attendanceRate < 0.7) down.push("Já faltou algumas vezes");
  return { up, down };
}

/** Nota pelo modelo aprendido (se houver) ou pelos pesos fixos (plano B). */
export function scoreCandidate(f: CandidateFacts, learned?: LogisticModel | null): CandidateScore {
  const x = candidateVector(f);
  let p: number;
  if (learned) p = predictLogistic(learned, x).p;
  else {
    const z = FIXED_BIAS + CANDIDATE_FEATURES.reduce((s, name, i) => s + FIXED[name] * x[i]!, 0);
    p = 1 / (1 + Math.exp(-z));
  }
  const { up, down } = reasonsFor(f);
  const score = Math.max(1, Math.min(99, Math.round(p * 100)));
  // Os motivos acompanham a nota: chance baixa começa pelo que pesa contra
  const reasons = score < 40 ? [...down.slice(0, 2), ...up.slice(0, 1)] : [...up.slice(0, 3), ...down.slice(0, 1)];
  return { score, reasons, source: learned ? "aprendido" : "regras" };
}

export const ACCEPT_MIN_SAMPLES = 60;
export const ACCEPT_MIN_ACCEPTS = 10;

/** Aprende com as ofertas respondidas; só aprova se acertar mais que os pesos fixos. */
export function trainAcceptModel(samples: { facts: CandidateFacts; accepted: boolean; at: number }[]): { model: LogisticModel | null; reason: string | null; auc: number | null } {
  const accepts = samples.filter((s) => s.accepted).length;
  if (samples.length < ACCEPT_MIN_SAMPLES) return { model: null, reason: `poucas ofertas respondidas (${samples.length} de ${ACCEPT_MIN_SAMPLES})`, auc: null };
  if (accepts < ACCEPT_MIN_ACCEPTS) return { model: null, reason: `poucos aceites para aprender (${accepts} de ${ACCEPT_MIN_ACCEPTS})`, auc: null };
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const cut = Math.floor(sorted.length * 0.8);
  const names = [...CANDIDATE_FEATURES];
  const trial = trainLogistic(
    names,
    sorted.slice(0, cut).map((s) => candidateVector(s.facts)),
    sorted.slice(0, cut).map((s) => (s.accepted ? 1 : 0)),
  );
  const test = sorted.slice(cut);
  const y = test.map((s) => (s.accepted ? 1 : 0));
  const aModel = auc(
    test.map((s) => predictLogistic(trial, candidateVector(s.facts)).p),
    y,
  );
  const aFixed = auc(
    test.map((s) => scoreCandidate(s.facts).score),
    y,
  );
  if (aModel < Math.max(0.6, aFixed)) return { model: null, reason: `os pesos fixos acertaram igual ou mais no teste`, auc: Math.round(aModel * 1000) / 1000 };
  return {
    model: trainLogistic(
      names,
      sorted.map((s) => candidateVector(s.facts)),
      sorted.map((s) => (s.accepted ? 1 : 0)),
    ),
    reason: null,
    auc: Math.round(aModel * 1000) / 1000,
  };
}
