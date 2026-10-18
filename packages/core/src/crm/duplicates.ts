/**
 * DUPLICIDADE DE CADASTROS (regras puras, sem banco)
 *
 * A mesma pessoa costuma chegar por caminhos diferentes: liga para a recepção,
 * depois escreve no Instagram, depois no WhatsApp de outro número... Estas
 * funções comparam dois cadastros e dizem SE e POR QUE parecem a mesma pessoa.
 *
 * Força da suspeita:
 *   "forte" -> mesmo celular, mesmo e-mail, ou mesmo nome + mesma data de nascimento
 *   "media" -> nome muito parecido (ex.: "Ana Lucia Reis" x "Ana Lúcia dos Reis")
 */

export type DuplicateStrength = "forte" | "media";

export interface DuplicateCandidateInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null;
}

export interface DuplicateMatch {
  strength: DuplicateStrength;
  reasons: string[];
  /** 0 a 1: semelhança do nome */
  nameScore: number;
}

/** Palavras que não ajudam a distinguir pessoas */
const STOP = new Set(["de", "da", "do", "das", "dos", "e", "dr", "dra", "sr", "sra"]);

/** "Dra. Ána Lúcia  dos Reis" -> "ana lucia reis" */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

/**
 * Telefone comparável: só números, sem DDI 55 e sem o 9º dígito do celular.
 * Assim "5551999990000", "51999990000" e "5199990000" (sem o 9) batem.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3);
  return d.length >= 10 ? d : null;
}

export function emailKey(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/**
 * Chave "sonora" de uma palavra, para grafias diferentes do mesmo nome:
 * Luiza/Luisa, Thiago/Tiago, Raphael/Rafael, Ketlyn/Ketlin, Hellen/Helen.
 */
export function soundKey(word: string): string {
  return word
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/^h/, "")
    .replace(/y/g, "i")
    .replace(/w/g, "v")
    .replace(/k/g, "c")
    .replace(/z/g, "s")
    .replace(/(.)\1/g, "$1");
}

/** Bigramas de caracteres (para comparar nomes com pequenas diferenças de grafia) */
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/**
 * Semelhança de nomes de 0 a 1.
 * Combina: palavras em comum (ordem não importa, "Reis Ana" = "Ana Reis") e
 * grafia (coeficiente de Dice nos bigramas, tolera "Luiza" x "Luisa").
 * Primeiro nome diferente derruba a nota: "Ana Reis" x "Paula Reis" não é a mesma pessoa.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = na.split(" ").map(soundKey);
  const wb = nb.split(" ").map(soundKey);
  if (wa.join(" ") === wb.join(" ")) return 0.97;
  // Primeiros nomes precisam ser parecidos
  const firstA = wa[0]!;
  const firstB = wb[0]!;
  const firstOk = firstA === firstB || dice(firstA, firstB) >= 0.75;
  if (!firstOk) return 0;
  // Palavras: quantas do nome mais curto aparecem no outro
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const longSet = new Set(long);
  // Inicial abreviada ("Ana L. Reis") conta como a palavra que começa com ela
  const common = short.filter((w) => longSet.has(w) || (w.length === 1 ? long.some((l) => l.startsWith(w)) : long.some((l) => dice(w, l) >= 0.8))).length;
  const words = common / short.length;
  // Nome de uma palavra só ("Ana") é pouco para afirmar algo
  const penalty = short.length === 1 ? 0.75 : 1;
  return Math.min(1, (0.6 * words + 0.4 * dice(wa.join(" "), wb.join(" "))) * penalty);
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** Limite de semelhança de nome para avisar ("media") */
export const NAME_SIMILARITY_THRESHOLD = 0.82;

/** Compara dois cadastros. null = não parecem a mesma pessoa. */
export function compareContacts(a: DuplicateCandidateInput, b: DuplicateCandidateInput): DuplicateMatch | null {
  const reasons: string[] = [];
  let strong = false;
  const nameScore = nameSimilarity(a.name, b.name);

  const pa = phoneKey(a.phone);
  if (pa && pa === phoneKey(b.phone)) {
    reasons.push("mesmo celular");
    strong = true;
  }
  const ea = emailKey(a.email);
  if (ea && ea === emailKey(b.email)) {
    reasons.push("mesmo e-mail");
    strong = true;
  }
  if (a.birthDate && a.birthDate === b.birthDate && nameScore >= 0.7) {
    reasons.push("mesmo nome e nascimento");
    strong = true;
  }
  if (nameScore >= NAME_SIMILARITY_THRESHOLD && !reasons.includes("mesmo nome e nascimento")) {
    reasons.push(nameScore === 1 ? "mesmo nome" : "nome muito parecido");
  }
  if (reasons.length === 0) return null;
  return { strength: strong ? "forte" : "media", reasons, nameScore };
}

/**
 * Ao UNIFICAR, qual etapa da jornada fica? A mais avançada na relação
 * (quem já é paciente não volta a ser "novo contato" por causa do cadastro duplicado).
 */
export const STAGE_PRIORITY = ["paciente", "agendado", "em_conversa", "reativar", "novo", "perdido"] as const;
