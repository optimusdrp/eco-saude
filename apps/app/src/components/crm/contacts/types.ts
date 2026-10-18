/**
 * Tipos e padrões da tela de CONTATOS (leads e pacientes).
 */
import type { Channel, JourneyStage } from "@ecosaude/core/crm";

export interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  stage: JourneyStage;
  /** Paciente = já compareceu a ao menos uma consulta */
  kind: "lead" | "paciente";
  tags: string[];
  channel: Channel | null;
  source: string | null;
  ownerName: string | null;
  birthdayToday: boolean;
  age: number | null;
  optedOut: boolean;
  consent: boolean;
  next: string | null;
  lastInteraction: string | null;
  lastVisit: string | null;
  createdAt: string;
  visits: number;
  noShows: number;
  conversationId: string | null;
}

export interface ContactsData {
  rows: ContactRow[];
  total: number;
  page: number;
  pages: number;
  size: number;
  /** Filtros atuais (como estão na URL) */
  params: Record<string, string>;
  stats: { total: number; leads: number; pacientes: number; novos30: number; semConsent: number; aniversariantes: number };
  stageCounts: Partial<Record<JourneyStage, number>>;
  facets: { sources: string[]; tags: string[]; channels: Channel[] };
  team: { id: string; name: string }[];
  segments: Record<string, { label: string; hint: string }>;
  sorts: Record<string, string>;
  canEdit: boolean;
  canStage: boolean;
  canSchedule: boolean;
  canExport: boolean;
  /** Pedidos LGPD em aberto (só para quem pode decidir) */
  privacy: { open: number; late: number } | null;
}

/** Colunas opcionais da tabela (cada pessoa escolhe as suas) */
export type ColumnId = "contato" | "etapa" | "canal" | "origem" | "responsavel" | "consulta" | "interacao" | "visitas" | "cadastro" | "etiquetas";

export const COLUMNS: Record<ColumnId, string> = {
  contato: "Celular e e-mail",
  etapa: "Etapa",
  canal: "Canal preferido",
  origem: "Origem",
  responsavel: "Responsável",
  consulta: "Próxima consulta",
  interacao: "Última interação",
  visitas: "Consultas e faltas",
  cadastro: "Cadastrado em",
  etiquetas: "Etiquetas",
};

export interface ContactsPrefs {
  view: "tabela" | "cartoes";
  density: "confortavel" | "compacta";
  columns: ColumnId[];
}

export const DEFAULT_CONTACTS_PREFS: ContactsPrefs = {
  view: "tabela",
  density: "confortavel",
  columns: ["contato", "etapa", "consulta", "interacao", "responsavel"],
};
