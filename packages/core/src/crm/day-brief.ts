/**
 * RESUMO DA MANHÃ NO PAINEL HOJE
 *
 * "Hoje, 18 consultas: 3 com alto risco de falta. 2 encaixes possíveis na tarde
 * da Dra. Helena. 4 conversas esperando há mais de 1 hora."
 *
 *  - Os NÚMEROS são sempre calculados pelo sistema (DayFacts). A IA só REDIGE.
 *  - checkBrief confere a frase da IA: todo número citado precisa existir nos
 *    fatos, todo nome precisa ser de profissional da lista, sem orientação de
 *    saúde, curto. Qualquer desvio = PLANO B (ruleBrief, a frase montada pelas regras).
 *  - Para a IA não vai nenhum dado de paciente: só contagens e nomes de profissionais.
 */
import { hasClinicalAdvice } from "./ai";

export interface DayFacts {
  /** "quinta, 15/10" */
  dateLabel: string;
  total: number;
  highRisk: number;
  unconfirmed: number;
  /** Horários livres que ainda dá para preencher hoje, por profissional e período (os 2 maiores) */
  fits: { professional: string; period: "manhã" | "tarde"; count: number }[];
  waitlist: number;
  waitingOver1h: number;
  tasksDue: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fitText = (f: DayFacts["fits"][number]) => `${plural(f.count, "encaixe possível", "encaixes possíveis")} na ${f.period === "manhã" ? "manhã" : "tarde"} ${/^dra\b/i.test(f.professional) ? "da" : /^dr\b/i.test(f.professional) ? "do" : "de"} ${f.professional}`;

/** Frase SEM IA (plano B e referência). */
export function ruleBrief(f: DayFacts): string {
  const parts: string[] = [];
  if (f.total === 0) parts.push("Hoje não há consultas marcadas");
  else {
    const extras = [f.highRisk ? `${f.highRisk} com alto risco de falta` : null, f.unconfirmed ? `${f.unconfirmed} sem confirmar` : null].filter(Boolean);
    parts.push(`Hoje, ${plural(f.total, "consulta", "consultas")}${extras.length ? `: ${extras.join(" e ")}` : ""}`);
  }
  if (f.fits.length) parts.push(`${f.fits.map(fitText).join(" e ")}${f.waitlist ? ` (${plural(f.waitlist, "pessoa", "pessoas")} na lista de espera)` : ""}`);
  if (f.waitingOver1h) parts.push(`${plural(f.waitingOver1h, "conversa esperando", "conversas esperando")} há mais de 1 hora`);
  if (f.tasksDue) parts.push(`${plural(f.tasksDue, "tarefa", "tarefas")} para hoje`);
  return `${parts.join(". ")}.`;
}

export function buildBriefPrompt(f: DayFacts): { system: string; user: string } {
  const system = [
    "Você escreve o resumo da manhã para a recepção de uma clínica de saúde no Brasil, em português.",
    "Regras: use SOMENTE os números e nomes dos FATOS, sem arredondar e sem inventar. No máximo 3 frases curtas (até 300 caracteres).",
    "Comece pelo que exige ação (alto risco de falta, conversas esperando, encaixes). Tom direto e prático, sem saudação, sem emoji, sem markdown.",
    "Não cite pacientes. Não dê orientação de saúde. Se um número for zero, não o mencione.",
    "Responda apenas com o JSON pedido.",
  ].join("\n");
  const user = [
    `DIA: ${f.dateLabel}`,
    `consultas hoje: ${f.total}`,
    `com alto risco de falta: ${f.highRisk}`,
    `ainda sem confirmar: ${f.unconfirmed}`,
    `encaixes possíveis: ${f.fits.length ? f.fits.map((x) => `${x.count} na ${x.period} de ${x.professional}`).join("; ") : "nenhum"}`,
    `pessoas na lista de espera: ${f.waitlist}`,
    `conversas esperando há mais de 1 hora: ${f.waitingOver1h}`,
    `tarefas para hoje: ${f.tasksDue}`,
  ].join("\n");
  return { system, user };
}

export const BRIEF_RESPONSE_SCHEMA = { type: "OBJECT", properties: { texto: { type: "STRING" } }, required: ["texto"] } as const;

export type BriefCheck = { ok: true; text: string } | { ok: false; reason: string };

/** Confere a frase da IA contra os fatos. */
export function checkBrief(raw: string, f: DayFacts): BriefCheck {
  let d: { texto?: unknown };
  try {
    d = JSON.parse(raw) as typeof d;
  } catch {
    return { ok: false, reason: "resposta da IA em formato inválido" };
  }
  const text = typeof d.texto === "string" ? d.texto.replace(/\*\*|#/g, "").replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, reason: "a IA não devolveu texto" };
  if (text.length > 360) return { ok: false, reason: "texto longo demais" };
  if (hasClinicalAdvice(text)) return { ok: false, reason: "a IA incluiu orientação de saúde (bloqueado)" };
  // Todo número da frase precisa estar nos fatos (inclui a data e o "1 hora")
  const allowed = new Set(
    [f.total, f.highRisk, f.unconfirmed, f.waitlist, f.waitingOver1h, f.tasksDue, 1, ...f.fits.map((x) => x.count), ...(f.dateLabel.match(/\d+/g) ?? []).map(Number)].map(String),
  );
  const numbers = text.match(/\d+/g) ?? [];
  const bad = numbers.filter((n) => !allowed.has(String(Number(n))));
  if (bad.length) return { ok: false, reason: `a IA citou número que não está nos dados (${bad.join(", ")})` };
  // "Dr./Dra. Fulano" citado precisa ser profissional da lista
  const cited = [...text.matchAll(/\bDra?\.?\s+([A-ZÀ-Ú][a-zà-ú]+)/g)].map((m) => m[1]!);
  const known = f.fits.map((x) => x.professional).join(" ");
  const unknown = cited.filter((name) => !known.includes(name));
  if (unknown.length) return { ok: false, reason: `a IA citou profissional fora dos dados (${unknown.join(", ")})` };
  return { ok: true, text };
}
