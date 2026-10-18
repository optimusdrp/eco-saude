/**
 * Tipos e padrões do RADAR DE RETORNOS.
 */
export interface RadarRow {
  key: string;
  contactId: string;
  protocolId: string;
  name: string;
  protocol: string;
  lastVisit: string;
  due: string;
  /** > 0 atrasado; 0 vence hoje; < 0 vence em N dias */
  overdueDays: number;
  channel: string | null;
  /** Motivo de não poder receber lembrete (LGPD/SAIR); null = pode */
  blocked: string | null;
  conversationId: string | null;
}

export interface FollowUp {
  key: string;
  contactId: string;
  name: string;
  protocol: string;
  remindedLabel: string;
  remindedDays: number;
  /** Respondeu depois do lembrete? */
  replied: boolean;
  conversationId: string | null;
}

export interface ProtocolView {
  id: string;
  name: string;
  serviceMatch: string;
  daysAfter: number;
  message: string;
  active: boolean;
  /** No radar agora (dentro da janela) */
  dueNow: number;
  sent90: number;
  booked90: number;
}

export interface ReturnsData {
  rows: RadarRow[];
  followUps: FollowUp[];
  protocols: ProtocolView[];
  impact: { sent: number; booked: number };
  windowDays: number;
  clinicName: string;
  canSend: boolean;
  canTask: boolean;
  canSchedule: boolean;
}

export interface ReturnsPrefs {
  tab: "radar" | "acompanhar";
  showBlocked: boolean;
  sort: "atraso" | "vencimento" | "nome";
}

export const DEFAULT_RETURNS_PREFS: ReturnsPrefs = { tab: "radar", showBlocked: true, sort: "atraso" };

export const WINDOWS = [7, 14, 30, 60] as const;
