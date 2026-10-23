/**
 * PEDIDOS DO TITULAR (LGPD, art. 18) — regras puras
 *
 * O paciente pode pedir:
 *  - ACESSO / PORTABILIDADE: uma cópia de tudo (já existia: "Exportar dados").
 *  - EXCLUSÃO: apagar os dados tratados com base no consentimento.
 *
 * Como o Tropi faz a exclusão: ANONIMIZAÇÃO no Tropi.
 *  - Tudo que identifica a pessoa (nome, telefone, e-mail, nascimento, convênio,
 *    textos das conversas, anotações, etiquetas, identificadores dos canais,
 *    leituras da IA) é apagado.
 *  - Ficam só números sem identificação (consultas: data, profissional, serviço,
 *    status), para os relatórios e os modelos de risco não mudarem de repente.
 *  - É IRREVERSÍVEL: não existe "desfazer".
 *
 * O que NÃO é apagado (e por quê):
 *  - Prontuário (módulo PEP, quando existir): a Lei 13.787/2018 obriga a guardar
 *    por 20 anos. A LGPD (art. 16, I) permite manter dado para cumprir obrigação legal.
 *  - O registro do próprio pedido (protocolo, datas, quem executou), sem nome nem
 *    telefone: é a prova de que a clínica atendeu (art. 6º, X, prestação de contas).
 *
 * Prazo: usamos 15 dias corridos a partir do pedido (art. 19, II, referência da
 * resposta completa). Melhor responder antes.
 */
import { normalizeText } from "./messages";

export const PRIVACY_REQUEST_KINDS = ["exclusao", "acesso"] as const;
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];

export const PRIVACY_REQUEST_KIND_LABEL: Record<PrivacyRequestKind, string> = {
  exclusao: "Exclusão dos dados",
  acesso: "Cópia dos dados",
};

export const PRIVACY_REQUEST_STATUSES = ["aberta", "concluida", "recusada"] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export const PRIVACY_REQUEST_STATUS_LABEL: Record<PrivacyRequestStatus, string> = {
  aberta: "Aberto",
  concluida: "Atendido",
  recusada: "Recusado",
};

/** Por onde o pedido chegou (fica no registro; ajuda a responder pelo mesmo canal) */
export const PRIVACY_REQUEST_CHANNELS = ["presencial", "whatsapp", "email", "telefone", "outro"] as const;
export type PrivacyRequestChannel = (typeof PRIVACY_REQUEST_CHANNELS)[number];

export const PRIVACY_REQUEST_CHANNEL_LABEL: Record<PrivacyRequestChannel, string> = {
  presencial: "Na recepção",
  whatsapp: "WhatsApp ou outro canal de conversa",
  email: "E-mail",
  telefone: "Telefone",
  outro: "Outro",
};

/**
 * Motivos para recusar uma exclusão. Lista FECHADA de propósito: o registro
 * não pode ter texto livre (alguém escreveria o nome do paciente ali).
 */
export const PRIVACY_REFUSAL_REASONS = ["identidade", "obrigacao_legal", "nao_titular", "duplicado"] as const;
export type PrivacyRefusalReason = (typeof PRIVACY_REFUSAL_REASONS)[number];

export const PRIVACY_REFUSAL_LABEL: Record<PrivacyRefusalReason, string> = {
  identidade: "Não foi possível confirmar a identidade de quem pediu",
  obrigacao_legal: "Os dados precisam ser guardados por obrigação legal",
  nao_titular: "Quem pediu não é o titular nem representante legal",
  duplicado: "Pedido repetido (já atendido em outro protocolo)",
};

/** Prazo de resposta, em dias corridos */
export const PRIVACY_DEADLINE_DAYS = 15;

/** O que fica no lugar do nome e do texto das mensagens */
export const ANONYMIZED_NAME = "Paciente anonimizado";
export const ANONYMIZED_MESSAGE = "[apagada a pedido do titular]";
export const ANONYMIZED_TASK = "Tarefa de paciente anonimizado";

/** Data limite para responder (15 dias corridos a partir do pedido). */
export function privacyDueDate(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + PRIVACY_DEADLINE_DAYS * 86_400_000);
}

/** Situação do prazo para a tela: no prazo, vence logo ou atrasado. */
export function privacyDeadlineState(dueAt: Date, now = new Date()): { tone: "ok" | "warning" | "alert"; label: string; daysLeft: number } {
  const daysLeft = Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft < 0) return { tone: "alert", label: `atrasado há ${-daysLeft} ${daysLeft === -1 ? "dia" : "dias"}`, daysLeft };
  if (daysLeft === 0) return { tone: "alert", label: "vence hoje", daysLeft };
  if (daysLeft <= 3) return { tone: "warning", label: `vence em ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}`, daysLeft };
  return { tone: "ok", label: `${daysLeft} dias para responder`, daysLeft };
}

/** Protocolo legível: "LGPD-2026-00042" (sequência por clínica e ano). */
export function privacyProtocol(year: number, seq: number): string {
  return `LGPD-${year}-${String(seq).padStart(5, "0")}`;
}

/**
 * Confirmação da ação irreversível: a pessoa digita o nome do paciente.
 * Aceita sem acento e sem diferença de maiúsculas, mas exige o nome inteiro.
 */
export function confirmsName(typed: string, name: string): boolean {
  const a = normalizeText(typed).replace(/\s+/g, " ").trim();
  const b = normalizeText(name).replace(/\s+/g, " ").trim();
  return a.length > 0 && a === b;
}

/** Identificador do titular normalizado (para o hash do registro): só dígitos do telefone ou e-mail minúsculo. */
export function normalizeSubjectId(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.includes("@")) return v.toLowerCase();
  const digits = v.replace(/\D/g, "");
  // Últimos 11 dígitos: "55 51 9xxxx" e "51 9xxxx" viram o mesmo identificador
  return digits.length >= 8 ? digits.slice(-11) : null;
}
