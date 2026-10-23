/**
 * Tipos e padrões da LISTA DE ESPERA.
 */
import type { WaitlistPeriod } from "@ecosaude/core/crm";

export interface WaitEntry {
  id: string;
  /** Posição na fila (ordem de chegada) */
  position: number;
  contactId: string;
  contactName: string;
  professionalId: string | null;
  professionalName: string | null;
  period: WaitlistPeriod;
  notes: string | null;
  status: "aguardando" | "oferecido";
  waitingDays: number;
  since: string;
  /** Quantas ofertas já recusou */
  declined: number;
  /** Já tem consulta marcada? (talvez queira só antecipar, ou já não precise da lista) */
  nextAppointment: string | null;
  /** Oferta aberta para esta pessoa agora */
  openOffer: { label: string; expiresMs: number } | null;
  conversationId: string | null;
  optedOut: boolean;
  /** Unidade em que aceita ser atendido (null = qualquer) */
  unitId: string | null;
  unitName: string | null;
}

export interface Opportunity {
  professionalId: string;
  professionalName: string;
  professionalColor: string;
  startsAt: string;
  endsAt: string;
  label: string;
  /** Dia (AAAA-MM-DD), "amanhã"/"qui, 15/10" e "09:00": a tela agrupa por profissional e dia */
  date: string;
  dayLabel: string;
  time: string;
  matches: { id: string; name: string }[];
}

export interface OfferView {
  id: string;
  status: "aberta" | "preenchida" | "expirada" | "cancelada";
  label: string;
  professional: string;
  createdLabel: string;
  expiresMs: number;
  filledBy: string | null;
  candidates: { name: string; outcome: string }[];
}

export interface WaitlistData {
  entries: WaitEntry[];
  opportunities: Opportunity[];
  offers: OfferView[];
  professionals: { id: string; name: string; slotMinutes: number; color: string }[];
  /** Unidades ativas (só com mais de uma: escolha da unidade na lista) */
  units: { id: string; name: string }[];
  stats: { waiting: number; offered: number; avgDays: number; filled30: number; closed30: number; avgAcceptMin: number | null };
  serverNowMs: number;
  canEdit: boolean;
}

export interface WaitlistPrefs {
  view: "fila" | "profissional";
  density: "confortavel" | "compacta";
  offersTab: "abertas" | "historico";
}

export const DEFAULT_WAITLIST_PREFS: WaitlistPrefs = { view: "fila", density: "confortavel", offersTab: "abertas" };

/** A partir de quantos dias na fila o tempo de espera vira alerta */
export const LONG_WAIT_DAYS = 14;
