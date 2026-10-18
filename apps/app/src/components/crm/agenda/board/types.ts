/**
 * Tipos da AGENDA (compartilhados entre a página no servidor e o quadro no navegador).
 * Horários em minutos desde a meia-noite, no fuso da clínica.
 */
import type { DayMinutes } from "@ecosaude/core/crm";
import type { AppointmentView } from "../AppointmentDialog";

export type AgendaView = "dia" | "semana" | "lista";

export interface BoardProfessional {
  id: string;
  name: string;
  specialty: string | null;
  /** Token de cor (crm, erp, pep, bi) */
  color: string;
  /** Duração padrão da consulta */
  slot: number;
  /** Horários de cada dia da semana (0 = domingo ... 6 = sábado); null = não atende */
  days: Record<number, DayMinutes | null>;
  /** Datas (AAAA-MM-DD) de ausência no período exibido, com o motivo */
  absent: Record<string, string>;
}

/** Horário do profissional numa data (null = não atende ou está ausente). */
export function proDay(p: BoardProfessional, weekday: number, date: string): DayMinutes | null {
  if (p.absent[date] !== undefined) return null;
  return p.days[weekday] ?? null;
}

export interface BoardAppointment extends AppointmentView {
  /** AAAA-MM-DD (fuso da clínica) */
  date: string;
  startMin: number;
  endMin: number;
  time: string;
  endTime: string;
  /** Ainda não veio a nenhuma consulta antes desta */
  firstVisit: boolean;
}

export interface BoardDay {
  date: string;
  weekday: number;
  /** "seg, 12/10" */
  label: string;
  isToday: boolean;
  isPast: boolean;
}

/** Quem espera vaga (para avisar "2 na espera" nos horários livres) */
export interface WaitlistHint {
  professionalId: string | null;
  period: "manha" | "tarde" | "qualquer";
}

export interface AgendaData {
  view: AgendaView;
  date: string;
  today: string;
  days: BoardDay[];
  professionals: BoardProfessional[];
  appointments: BoardAppointment[];
  /** Consultas por dia no mês do dia escolhido (mini calendário) */
  monthCounts: Record<string, number>;
  waitlist: WaitlistHint[];
  /** Minuto atual (fuso da clínica) e instante do servidor, para a linha do "agora" */
  nowMin: number;
  serverNowMs: number;
  canEdit: boolean;
  features: { confirmations: boolean; waitlist: boolean; cancel: boolean };
  /** Consulta para abrir ao carregar (link da ficha do paciente) */
  openId?: string;
}

/** Preferências de exibição (salvas no navegador de cada pessoa) */
export interface AgendaPrefs {
  density: "compacta" | "confortavel" | "ampla";
  colorBy: "status" | "profissional";
  showCancelled: boolean;
  showFree: boolean;
  /** Mostrar só o expediente (esconde o começo e o fim do dia sem atendimento) */
  workHoursOnly: boolean;
  hiddenProfessionals: string[];
  statusFilter: string[];
}

export const DEFAULT_PREFS: AgendaPrefs = {
  density: "confortavel",
  colorBy: "status",
  showCancelled: false,
  showFree: true,
  workHoursOnly: true,
  hiddenProfessionals: [],
  statusFilter: [],
};

/** Pixels por minuto em cada densidade */
export const PX_PER_MIN: Record<AgendaPrefs["density"], number> = { compacta: 1.1, confortavel: 1.6, ampla: 2.4 };

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
