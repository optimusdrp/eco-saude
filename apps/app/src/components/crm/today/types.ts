/**
 * Tipos e padrões do painel HOJE.
 * O servidor (app/(app)/hoje/page.tsx) monta um TodayData já "mastigado"
 * (minutos do dia, rótulos prontos) e o painel no navegador só desenha e reage.
 */
import type { AppointmentStatus, Channel, NoShowRisk } from "@ecosaude/core/crm";
import type { AppointmentView } from "../agenda/AppointmentDialog";

export interface TodayProfessional {
  id: string;
  name: string;
  color: string;
  /** Expediente de hoje em minutos do dia (null = não atende hoje) */
  start: number | null;
  end: number | null;
  /** Períodos de atendimento de hoje (cada dia pode ter os seus) */
  periods: { start: number; end: number }[];
  /** Intervalos entre os períodos */
  gaps: { start: number; end: number }[];
  /** Duração da consulta hoje */
  slot: number;
  /** Ausente hoje (férias, folga): o motivo */
  absentReason?: string;
}

/** Consulta de hoje (ou amanhã) pronta para a tela */
export interface TodayAppointment extends AppointmentView {
  startMin: number;
  endMin: number;
  time: string;
  endTime: string;
  professionalColor: string;
  firstVisit: boolean;
}

export interface WaitingConversation {
  id: string;
  contactId: string;
  contactName: string;
  channel: Channel;
  preview: string | null;
  intent: string | null;
  intentLabel: string | null;
  urgent: boolean;
  urgentGuidance: string | null;
  sinceMs: number;
}

export interface TodayTask {
  id: string;
  title: string;
  kind: string;
  dueDate: string;
  overdue: boolean;
  contactId: string | null;
  contactName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface Birthday {
  contactId: string;
  name: string;
  age: number | null;
}

export interface PulseDay {
  date: string;
  label: string;
  attended: number;
  missed: number;
  cancelled: number;
  newContacts: number;
}

export interface TodayData {
  userId: string;
  firstName: string;
  today: string;
  dateLabel: string;
  /** Início do dia de hoje (UTC, ms): com ele o navegador calcula o "agora" em minutos */
  dayStartMs: number;
  serverNowMs: number;
  canEdit: boolean;
  features: { inbox: boolean; confirmations: boolean; waitlist: boolean; noShowRisk: boolean; campaigns: boolean };
  /** Permissões do perfil para as ações da consulta */
  perms: { cancel: boolean; confirm: boolean; waitlist: boolean };
  professionals: TodayProfessional[];
  appointments: TodayAppointment[];
  tomorrow: { label: string; appointments: TodayAppointment[] };
  /** Quando hoje não tem consultas: o próximo dia que tem */
  nextDay: { date: string; label: string; count: number } | null;
  waiting: WaitingConversation[];
  tasks: TodayTask[];
  waitlist: { professionalId: string | null; period: string }[];
  returnsCount: number;
  birthdays: Birthday[];
  pulse: { days: PulseDay[]; nps: { avg: number | null; count: number } };
  createdToday: { contacts: number; appointments: number };
  /** Resumo da manhã (null = desligado em Ajustes > Inteligência artificial) */
  brief?: { text: string; source: "ia" | "regras"; pending: boolean } | null;
}

/* ------------------------------ Personalização ----------------------------- */

/** Quadros do painel (cada pessoa escolhe quais ver e em que ordem) */
export type WidgetId = "regua" | "recepcao" | "acoes" | "amanha" | "vagas" | "aniversarios" | "pulso";

export const WIDGETS: Record<WidgetId, { title: string; hint: string }> = {
  regua: { title: "Régua do dia", hint: "Todos os profissionais numa linha do tempo, com o agora e os buracos da agenda" },
  recepcao: { title: "Recepção ao vivo", hint: "Atrasados, em consulta e próximos a chegar, com Chegou/Faltou em um toque" },
  acoes: { title: "Fila de ações", hint: "Urgências, quem espera resposta, risco de falta, confirmações, tarefas e retornos" },
  amanha: { title: "Amanhã", hint: "Quantas consultas de amanhã já confirmaram e pedido em lote" },
  vagas: { title: "Horários livres hoje", hint: "Buracos que ainda dá para preencher, com a lista de espera" },
  aniversarios: { title: "Aniversariantes", hint: "Pacientes que fazem aniversário hoje" },
  pulso: { title: "Pulso da semana", hint: "Comparecimento, faltas e novos contatos dos últimos 7 dias" },
};

export interface TodayPrefs {
  /** Coluna principal (larga) e lateral, na ordem escolhida */
  main: WidgetId[];
  side: WidgetId[];
  hidden: WidgetId[];
  /** Quadros recolhidos (só o título aparece) */
  collapsed: WidgetId[];
  compact: boolean;
  /** Fila de ações: só tarefas atribuídas a mim */
  onlyMine: boolean;
  preset: PresetId | "personalizado";
}

export type PresetId = "recepcao" | "gestao";

export const PRESETS: Record<PresetId, { label: string; hint: string; prefs: Pick<TodayPrefs, "main" | "side" | "hidden"> }> = {
  recepcao: {
    label: "Recepção",
    hint: "Quem chega, quem espera resposta e o que fazer agora",
    prefs: { main: ["regua", "recepcao", "acoes"], side: ["amanha", "vagas", "aniversarios", "pulso"], hidden: ["pulso"] },
  },
  gestao: {
    label: "Gestão",
    hint: "Números da semana, ocupação e pendências da equipe",
    prefs: { main: ["pulso", "regua", "acoes"], side: ["amanha", "vagas", "recepcao", "aniversarios"], hidden: ["recepcao"] },
  },
};

export const DEFAULT_TODAY_PREFS: TodayPrefs = {
  ...PRESETS.recepcao.prefs,
  collapsed: [],
  compact: false,
  onlyMine: false,
  preset: "recepcao",
};

/** Garante que todo quadro aparece em alguma coluna (útil quando surgir um quadro novo) */
export function normalizeLayout(p: TodayPrefs): TodayPrefs {
  const all = Object.keys(WIDGETS) as WidgetId[];
  const seen = new Set<WidgetId>();
  const main = p.main.filter((w) => all.includes(w) && !seen.has(w) && seen.add(w));
  const side = p.side.filter((w) => all.includes(w) && !seen.has(w) && seen.add(w));
  for (const w of all) if (!seen.has(w)) side.push(w);
  return { ...p, main, side };
}

export const STATUS_LABEL_SHORT: Record<AppointmentStatus, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  compareceu: "Chegou",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

export type { NoShowRisk };

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
