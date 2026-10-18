/**
 * Tipos e padrões do quadro da JORNADA.
 */
import type { Channel, JourneyStage } from "@ecosaude/core/crm";

export interface JourneyCard {
  id: string;
  name: string;
  stage: JourneyStage;
  channel: Channel | null;
  daysInStage: number;
  /** Próxima consulta ("amanhã às 09:00") e quando (ms, para ordenar) */
  next: string | null;
  nextMs: number | null;
  tags: string[];
  source: string | null;
  ownerId: string | null;
  ownerName: string | null;
  lostReason: string | null;
  /** Conversa mais recente (para abrir direto) */
  conversationId: string | null;
  /** Esperando resposta da clínica agora */
  waiting: boolean;
  /** Dias desde o último contato (mensagem ou consulta) */
  lastTouchDays: number | null;
  /** Próximo passo (Ajustes > IA): decidido pelas regras; o rascunho vem sob demanda */
  nextStep: { kind: string; title: string; message: boolean } | null;
}

export interface FunnelStep {
  label: string;
  value: number;
  hint: string;
}

export interface JourneyData {
  cards: JourneyCard[];
  /** Funil dos contatos que chegaram nos últimos 90 dias */
  funnel: FunnelStep[];
  /** Motivos de perda mais comuns */
  lostReasons: { reason: string; n: number }[];
  /** Motivos de perda organizados (Ajustes > IA), últimos 90 dias. null = desligado */
  lossGroups: { total: number; groups: { category: string; label: string; n: number; quotes: string[] }[] } | null;
  team: { id: string; name: string }[];
  userId: string;
  canEdit: boolean;
  canSchedule: boolean;
  truncated: boolean;
}

export type JourneySort = "parados" | "recentes" | "nome" | "consulta";

export interface JourneyPrefs {
  view: "quadro" | "lista";
  density: "confortavel" | "compacta";
  sort: JourneySort;
  showTags: boolean;
  showSource: boolean;
  showOwner: boolean;
  /** Funil de 90 dias no topo */
  showFunnel: boolean;
  hiddenStages: JourneyStage[];
  collapsedStages: JourneyStage[];
}

export const DEFAULT_JOURNEY_PREFS: JourneyPrefs = {
  view: "quadro",
  density: "confortavel",
  sort: "parados",
  showTags: true,
  showSource: true,
  showOwner: true,
  showFunnel: true,
  hiddenStages: [],
  collapsedStages: [],
};

export const SORT_LABEL: Record<JourneySort, string> = {
  parados: "Mais tempo parado",
  recentes: "Mudou de etapa há menos tempo",
  nome: "Nome (A a Z)",
  consulta: "Próxima consulta",
};
