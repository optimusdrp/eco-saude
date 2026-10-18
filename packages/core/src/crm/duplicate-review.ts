/**
 * DUPLICADOS DIFÍCEIS (regras puras)
 *
 * A semelhança de nome não resolve tudo:
 *  - "Bia" e "Beatriz Souza" com o mesmo e-mail: MESMA pessoa (apelido);
 *  - "Maria Silva" e "João Silva" com o mesmo celular: provavelmente FAMÍLIA
 *    (a mãe marca para o filho), e unificar seria um erro grave (mistura históricos).
 *
 *  - ruleDuplicateVerdict (PLANO B): dicionário de apelidos comuns + sinais
 *    (mesmo e-mail/celular, nascimentos diferentes).
 *  - A IA recebe SÓ os nomes e sinais (sim/não), nunca o e-mail ou o telefone.
 *  - O veredito é uma OPINIÃO na tela de duplicados: quem unifica é a equipe.
 */
import { nameSimilarity, normalizeName } from "./duplicates";

/** Apelido -> nomes possíveis (minúsculo, sem acento) */
export const NICKNAMES: Record<string, string[]> = {
  bia: ["beatriz"],
  ze: ["jose"],
  zezinho: ["jose"],
  chico: ["francisco"],
  paco: ["francisco"],
  gabi: ["gabriela", "gabriel"],
  rafa: ["rafael", "rafaela"],
  dani: ["daniel", "daniela", "danielle"],
  fer: ["fernanda", "fernando"],
  nanda: ["fernanda"],
  carol: ["carolina", "caroline"],
  malu: ["maria luiza", "maria luisa"],
  ju: ["juliana", "julia"],
  juju: ["juliana", "julia"],
  mari: ["mariana", "maria"],
  guto: ["augusto", "gustavo"],
  beto: ["roberto", "alberto", "humberto"],
  duda: ["eduarda", "eduardo"],
  dudu: ["eduardo"],
  manu: ["manuela", "emanuel", "emanuele"],
  tati: ["tatiana"],
  paty: ["patricia"],
  pati: ["patricia"],
  cris: ["cristina", "cristiane", "cristiano"],
  leo: ["leonardo", "leandro", "leonel"],
  gui: ["guilherme"],
  lu: ["luciana", "lucia", "luiza", "luisa", "lucas"],
  ro: ["rosana", "rosangela", "rodrigo"],
  tonho: ["antonio"],
  toninho: ["antonio"],
  tiao: ["sebastiao"],
  pedrinho: ["pedro"],
  joca: ["joao"],
  nina: ["marina", "carolina"],
  vivi: ["viviane", "vivian"],
  van: ["vanessa"],
  re: ["renata", "regina"],
  sandrinha: ["sandra"],
  lari: ["larissa"],
  isa: ["isabela", "isabel", "isadora"],
  bel: ["isabela", "isabel"],
  mila: ["camila"],
  ana: ["ana"],
};

/** Os primeiros nomes podem ser a mesma pessoa por apelido? ("Bia" x "Beatriz") */
export function nicknameMatch(a: string, b: string): boolean {
  const fa = normalizeName(a).split(" ")[0] ?? "";
  const fb = normalizeName(b).split(" ")[0] ?? "";
  if (!fa || !fb || fa === fb) return false;
  const full = (n: string) => normalizeName(n);
  return (NICKNAMES[fa]?.some((x) => full(b).startsWith(x)) ?? false) || (NICKNAMES[fb]?.some((x) => full(a).startsWith(x)) ?? false);
}

export type DuplicateVerdict = "mesma_pessoa" | "familia" | "pessoas_diferentes" | "incerto";

export const DUPLICATE_VERDICT_LABEL: Record<DuplicateVerdict, string> = {
  mesma_pessoa: "Provavelmente a mesma pessoa",
  familia: "Provavelmente família (contato compartilhado)",
  pessoas_diferentes: "Provavelmente pessoas diferentes",
  incerto: "Não dá para afirmar",
};

export interface DuplicateSignals {
  nameA: string;
  nameB: string;
  sameEmail: boolean;
  samePhone: boolean;
  /** true = mesmo nascimento; false = os dois informados e diferentes; null = falta algum */
  sameBirth: boolean | null;
}

export interface DuplicateOpinion {
  verdict: DuplicateVerdict;
  reason: string;
}

/** Opinião SEM IA (plano B). */
export function ruleDuplicateVerdict(s: DuplicateSignals): DuplicateOpinion {
  const score = nameSimilarity(s.nameA, s.nameB);
  const nick = nicknameMatch(s.nameA, s.nameB);
  const firstA = normalizeName(s.nameA).split(" ")[0];
  const firstB = normalizeName(s.nameB).split(" ")[0];
  const lastA = normalizeName(s.nameA).split(" ").slice(1);
  const lastB = normalizeName(s.nameB).split(" ").slice(1);
  if (s.sameBirth === false) return { verdict: "pessoas_diferentes", reason: "datas de nascimento diferentes" };
  if (nick)
    return { verdict: "mesma_pessoa", reason: `“${firstA}” costuma ser apelido de “${firstB}” (ou o contrário)${s.sameEmail ? " e o e-mail é o mesmo" : s.samePhone ? " e o celular é o mesmo" : ""}` };
  if (score >= 0.82) return { verdict: "mesma_pessoa", reason: "nomes praticamente iguais" };
  if ((s.sameEmail || s.samePhone) && firstA !== firstB && lastA.some((w) => lastB.includes(w)))
    return { verdict: "familia", reason: `mesmo ${s.samePhone ? "celular" : "e-mail"} e mesmo sobrenome, com primeiros nomes diferentes: costuma ser família` };
  if ((s.sameEmail || s.samePhone) && firstA !== firstB) return { verdict: "incerto", reason: `mesmo ${s.samePhone ? "celular" : "e-mail"}, mas primeiros nomes diferentes` };
  return { verdict: "incerto", reason: "sinais insuficientes" };
}

export function buildDuplicatePrompt(s: DuplicateSignals): { system: string; user: string } {
  const system = [
    "Você ajuda uma clínica de saúde no Brasil a decidir se dois cadastros são a MESMA PESSOA.",
    "Considere apelidos brasileiros (Bia = Beatriz, Zé = José, Chico = Francisco), nomes abreviados e grafias diferentes.",
    "Mesmo celular ou e-mail com primeiros nomes DIFERENTES e sobrenome igual costuma ser FAMÍLIA (mãe que marca para o filho): não é a mesma pessoa.",
    "veredito: mesma_pessoa, familia, pessoas_diferentes ou incerto. motivo: até 20 palavras em português. confianca: 0 a 100.",
    "Responda apenas com o JSON pedido.",
  ].join("\n");
  const yn = (v: boolean | null) => (v === null ? "não informado" : v ? "sim" : "não");
  const user = [`Cadastro A: ${s.nameA}`, `Cadastro B: ${s.nameB}`, `Mesmo e-mail: ${yn(s.sameEmail)}`, `Mesmo celular: ${yn(s.samePhone)}`, `Mesma data de nascimento: ${yn(s.sameBirth)}`].join("\n");
  return { system, user };
}

export const DUPLICATE_SCHEMA = {
  type: "OBJECT",
  properties: { veredito: { type: "STRING", enum: ["mesma_pessoa", "familia", "pessoas_diferentes", "incerto"] }, motivo: { type: "STRING" }, confianca: { type: "INTEGER" } },
  required: ["veredito", "confianca"],
} as const;

export function checkDuplicate(raw: string, s: DuplicateSignals): { ok: true; opinion: DuplicateOpinion; confidence: number } | { ok: false; reason: string } {
  let d: { veredito?: unknown; motivo?: unknown; confianca?: unknown };
  try {
    d = JSON.parse(raw) as typeof d;
  } catch {
    return { ok: false, reason: "resposta da IA em formato inválido" };
  }
  const v = d.veredito;
  if (v !== "mesma_pessoa" && v !== "familia" && v !== "pessoas_diferentes" && v !== "incerto") return { ok: false, reason: "a IA devolveu um veredito desconhecido" };
  const confidence = Math.round(Number(d.confianca));
  if (!Number.isFinite(confidence)) return { ok: false, reason: "a IA devolveu confiança inválida" };
  // Segurança: nascimento diferente nunca vira "mesma pessoa" (unificar errado mistura prontuários)
  if (v === "mesma_pessoa" && s.sameBirth === false) return { ok: false, reason: "a IA disse mesma pessoa com nascimentos diferentes" };
  // O motivo é o que a equipe lê para decidir: precisa explicar alguma coisa
  const motivo = typeof d.motivo === "string" ? d.motivo.trim() : "";
  if (motivo.split(/\s+/).filter(Boolean).length < 4) return { ok: false, reason: "a IA não explicou o motivo" };
  return { ok: true, confidence, opinion: { verdict: v, reason: motivo.slice(0, 160) } };
}
