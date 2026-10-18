import type { AttachmentView } from "@/modules/crm/files/attachments";
/**
 * Tipos da MESA DE MENSAGENS (dados que o servidor entrega já prontos para a tela).
 * Datas viram números (ms) para atravessar do servidor para o navegador.
 */
import type { Channel, JourneyStage } from "@ecosaude/core/crm";
import type { SuggestionView } from "@/modules/crm/ai/insights";
import type { PromiseView } from "@/modules/crm/ai/promises";
import type { SummaryView } from "@/modules/crm/ai/summary";

export interface InboxItem {
  id: string;
  contactId: string;
  contactName: string;
  channel: Channel;
  status: string;
  preview: string | null;
  lastMessageMs: number | null;
  /** Desde quando espera resposta (null = ninguém esperando) */
  waitingSinceMs: number | null;
  snoozedUntilMs: number | null;
  unread: number;
  urgent: boolean;
  intentLabel: string | null;
  /** A IA decidiu a intenção (mostra o ícone) */
  intentByAi: boolean;
  /** Sentimento (só quando pede atenção: impaciente, irônico, irritado, insatisfeito, ameaça) */
  sentimentLabel: string | null;
  /** 0 = tranquilo ... 4 = ameaça */
  sentimentLevel: number;
  sentimentByAi: boolean;
  /** Subiu na fila por causa do sentimento */
  sentimentHot: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface InboxCounts {
  esperando: number;
  abertas: number;
  minhas: number;
  sem_dono: number;
  adiadas: number;
  /** Esperando há mais que a meta de 1ª resposta */
  atrasadas: number;
  maisAntigaMs: number | null;
  naoLidas: number;
}

export interface ThreadMessage {
  id: string;
  direction: "in" | "out" | "note" | "system";
  body: string;
  status: string;
  createdMs: number;
  /** "seg, 12/10" e "14:30", calculados no fuso da clínica */
  dayLabel: string;
  time: string;
  authorName: string | null;
  auto: boolean;
  handledBy: string | null;
  error: string | null;
  /** Foto, áudio, vídeo ou documento (o arquivo abre pela rota autenticada /api/anexos/<id>) */
  attachments: AttachmentView[];
}

export interface ThreadData {
  id: string;
  channel: Channel;
  status: string;
  urgent: boolean;
  urgentGuidance: string | null;
  unread: number;
  assigneeId: string | null;
  intent: string | null;
  intentLabel: string | null;
  /** regras (palavras-chave) | ia | equipe */
  intentSource: string | null;
  intentConfidence: number | null;
  intentReason: string | null;
  /** A IA ainda vai revisar a última mensagem */
  intentPending: boolean;
  /** Sentimento do paciente (null = funcionalidade desligada ou conversa sem análise) */
  sentiment: string | null;
  sentimentLabel: string | null;
  sentimentLevel: number;
  /** regras | ia | equipe */
  sentimentSource: string | null;
  sentimentConfidence: number | null;
  sentimentReason: string | null;
  sentimentPending: boolean;
  sentimentHot: boolean;
  /** Prometido a este paciente (tarefas automáticas em aberto) */
  promises: (PromiseView & { dueLabel: string })[];
  /** Alguma mensagem desta conversa ainda na fila da IA de promessas */
  promisePending: boolean;
  /** Último resumo da conversa (botão "Resumir"), se alguém já resumiu */
  summary: SummaryView | null;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    stage: JourneyStage;
    tags: string[];
    source: string | null;
    optedOut: boolean;
    consentMarketing: boolean;
    lastVisit: string | null;
    since: string;
    insurance: string | null;
    referredBy: string | null;
  };
  /** Sugestões para a ficha e etiquetas (Ajustes > IA) e se há análise em andamento */
  profileSuggestions: SuggestionView[];
  profileSuggestionsPending: boolean;
  /** Melhor horário para escrever a este paciente (Ajustes > IA), se ligado */
  bestTime: string | null;
  messages: ThreadMessage[];
  otherChannels: { id: string; channel: Channel }[];
  next: { label: string; professional: string; status: string } | null;
  slots: string[];
  suggestionPro: string | null;
  suggestions: string[];
  window: { open: boolean; closesAtMs: number | null; closesLabel: string | null; unlimited: boolean };
  stats: { compareceu: number; faltou: number; cancelado: number };
  events: { id: string; text: string; when: string }[];
}

/* ------------------------------ Personalização ------------------------------ */

export interface InboxPrefs {
  density: "compacta" | "confortavel";
  /** Mostrar o trecho da última mensagem na lista */
  showPreview: boolean;
  /** Painel do assistente/paciente à direita (telas largas) */
  showPanel: boolean;
  panelTab: "assistente" | "paciente" | "historico";
  /** Depois de resolver, abrir a próxima da lista */
  autoAdvance: boolean;
  /** Enter envia (senão, Ctrl+Enter) */
  enterToSend: boolean;
}

export const DEFAULT_INBOX_PREFS: InboxPrefs = {
  density: "confortavel",
  showPreview: true,
  showPanel: true,
  panelTab: "assistente",
  autoAdvance: true,
  enterToSend: true,
};

export const PREFS_KEY = "eco:conversas:prefs:v1";
