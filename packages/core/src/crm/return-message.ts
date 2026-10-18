/**
 * MENSAGEM DE RETORNO PERSONALIZADA (regras puras)
 *
 * Em vez do mesmo texto para todos, a IA adapta o lembrete de retorno pelo último
 * procedimento e pelo histórico, DENTRO DOS LIMITES que a clínica aprova em Ajustes:
 *  - tamanho máximo, tom, se pode citar o procedimento;
 *  - nunca: preço, desconto, promessa, orientação de saúde, link que não estava no
 *    texto da clínica, número que não estava no texto ou no histórico.
 * PLANO B: o texto da clínica (o protocolo), que já vai na fila; a versão da IA só
 * troca o texto se passar em todas as conferências e chegar antes do envio.
 */
import { hasClinicalAdvice, leaksMasked } from "./ai";
import { normalizeText } from "./messages";

export interface ReturnLimits {
  maxChars: number;
  tone: "acolhedor" | "objetivo" | "formal";
  mentionProcedure: boolean;
}

export interface ReturnContext {
  clinicName: string;
  firstName: string;
  /** O texto aprovado da clínica, já preenchido (é o plano B) */
  baseText: string;
  lastProcedure: string | null;
  monthsSinceVisit: number;
  visits: number;
  professional: string | null;
}

const TONE: Record<ReturnLimits["tone"], string> = {
  acolhedor: "acolhedor e próximo, sem exagero",
  objetivo: "objetivo, frases curtas",
  formal: "formal e cordial (senhor/senhora quando fizer sentido)",
};

export function buildReturnPrompt(c: ReturnContext, l: ReturnLimits): { system: string; user: string } {
  const system = [
    `Você reescreve o lembrete de retorno da clínica "${c.clinicName}" para UM paciente, mantendo o objetivo do texto da clínica (convidar a marcar o retorno).`,
    `Limites aprovados pela clínica: até ${l.maxChars} caracteres; tom ${TONE[l.tone]}; ${l.mentionProcedure ? "pode citar o último procedimento" : "NÃO cite o procedimento"}.`,
    "Proibido: preços, descontos, promoções, brindes, prazos ou promessas; orientação de saúde, sintomas ou riscos; links ou números que não estejam no texto da clínica.",
    "Chame pelo primeiro nome. Sem markdown, sem emoji, sem assinatura. Responda apenas com o JSON pedido.",
  ].join("\n");
  const user = [
    `TEXTO DA CLÍNICA: ${c.baseText}`,
    `Paciente: ${c.firstName}`,
    l.mentionProcedure && c.lastProcedure ? `Último procedimento: ${c.lastProcedure}` : "",
    c.professional ? `Profissional: ${c.professional}` : "",
    `Meses desde a última visita: ${c.monthsSinceVisit}`,
    `Consultas anteriores: ${c.visits}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export const RETURN_SCHEMA = { type: "OBJECT", properties: { mensagem: { type: "STRING" } }, required: ["mensagem"] } as const;

/** Confere a versão da IA contra os limites. Qualquer desvio = vale o texto da clínica. */
export function checkReturnMessage(raw: string, c: ReturnContext, l: ReturnLimits): { ok: true; text: string } | { ok: false; reason: string } {
  let d: { mensagem?: unknown };
  try {
    d = JSON.parse(raw) as typeof d;
  } catch {
    return { ok: false, reason: "resposta da IA em formato inválido" };
  }
  const text = typeof d.mensagem === "string" ? d.mensagem.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, reason: "a IA não devolveu texto" };
  if (text.length > l.maxChars) return { ok: false, reason: `passou de ${l.maxChars} caracteres` };
  if (!normalizeText(text).includes(normalizeText(c.firstName))) return { ok: false, reason: "não chamou o paciente pelo nome" };
  if (hasClinicalAdvice(text)) return { ok: false, reason: "orientação de saúde (bloqueado)" };
  if (leaksMasked(text)) return { ok: false, reason: "repetiu um dado ocultado (bloqueado)" };
  if (/\b(desconto|promoc|gratis|gratuit|brinde|oferta|so hoje|ultimas vagas|garant)/.test(normalizeText(text)) && !/\b(desconto|promoc|gratis|brinde|oferta)/.test(normalizeText(c.baseText)))
    return { ok: false, reason: "prometeu desconto ou vantagem (proibido)" };
  if (/R\$/.test(text)) return { ok: false, reason: "citou preço (proibido)" };
  const urls = text.match(/https?:\/\/\S+|www\.\S+/g) ?? [];
  if (urls.some((u) => !c.baseText.includes(u.replace(/[.,]$/, "")))) return { ok: false, reason: "incluiu link que não está no texto da clínica" };
  const allowedNums = new Set([...(c.baseText.match(/\d+/g) ?? []), String(c.monthsSinceVisit), String(c.visits)]);
  const nums = (text.match(/\d+/g) ?? []).filter((n) => !allowedNums.has(n));
  if (nums.length) return { ok: false, reason: `citou número que não estava no texto (${nums.join(", ")})` };
  if (!l.mentionProcedure && c.lastProcedure && normalizeText(text).includes(normalizeText(c.lastProcedure))) return { ok: false, reason: "citou o procedimento (a clínica não permitiu)" };
  return { ok: true, text };
}
