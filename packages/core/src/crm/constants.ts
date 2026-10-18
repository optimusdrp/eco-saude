/**
 * Vocabulário do CRM (canais, jornada, agenda, perfis da clínica).
 * Banco, telas e regras usam estas listas: um novo status é criado AQUI.
 */

/* --------------------------------- Canais ---------------------------------- */

export const CHANNELS = ["whatsapp", "telegram", "instagram", "facebook"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  facebook: "Messenger",
};

/**
 * Janela de atendimento de cada canal (em horas).
 * WhatsApp, Instagram e Messenger só permitem mensagem livre até 24h depois
 * da última mensagem do paciente. Depois disso, só modelos aprovados.
 * Telegram não tem essa regra (null).
 */
export const CHANNEL_WINDOW_HOURS: Record<Channel, number | null> = {
  whatsapp: 24,
  instagram: 24,
  facebook: 24,
  telegram: null,
};

export const CHANNEL_MODES = ["simulacao", "real"] as const;
export type ChannelMode = (typeof CHANNEL_MODES)[number];

/* --------------------------------- Jornada --------------------------------- */

/**
 * Jornada única do primeiro contato ao paciente fiel.
 * Em vez de um funil que termina no "ganho", a jornada continua depois da
 * primeira consulta (paciente ativo -> para reativar), que é onde a clínica
 * mais perde receita sem perceber.
 */
export const JOURNEY_STAGES = ["novo", "em_conversa", "agendado", "paciente", "reativar", "perdido"] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export const JOURNEY_STAGE_LABEL: Record<JourneyStage, string> = {
  novo: "Novo contato",
  em_conversa: "Em conversa",
  agendado: "Agendado",
  paciente: "Paciente ativo",
  reativar: "Para reativar",
  perdido: "Perdido",
};

/** Explicação curta de cada etapa (exibida no quadro, didático). */
export const JOURNEY_STAGE_HINT: Record<JourneyStage, string> = {
  novo: "Chegou e ainda não foi respondido",
  em_conversa: "A equipe já respondeu, sem consulta marcada",
  agendado: "Tem consulta marcada",
  paciente: "Já foi atendido na clínica",
  reativar: "Paciente sem consulta há mais de 6 meses",
  perdido: "Desistiu ou não respondeu mais",
};

/** A partir de quantos dias parado na etapa o cartão "esquenta" (alerta visual). */
export const JOURNEY_STALE_DAYS: Partial<Record<JourneyStage, number>> = {
  novo: 1,
  em_conversa: 3,
  reativar: 14,
};

/** Dias sem consulta para um paciente ativo ir para "Para reativar". */
export const REACTIVATION_DAYS = 180;

/* ---------------------------------- Agenda --------------------------------- */

export const APPOINTMENT_STATUSES = ["agendado", "confirmado", "compareceu", "faltou", "cancelado"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  compareceu: "Compareceu",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

/** Mudanças de status permitidas a partir de cada status. */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  agendado: ["confirmado", "compareceu", "faltou", "cancelado"],
  confirmado: ["compareceu", "faltou", "cancelado", "agendado"],
  compareceu: ["agendado"], // desfazer engano
  faltou: ["agendado"],
  cancelado: ["agendado"], // desfazer cancelamento (só para consulta futura e se o horário continuar livre)
};

/**
 * "Compareceu" e "Faltou" só valem a partir de pouco antes do horário.
 * Evita o toque errado que manda a pesquisa de satisfação antes da consulta.
 */
export const ATTENDANCE_TOLERANCE_MIN = 30;

/** Duração permitida para uma consulta (minutos) */
export const APPOINTMENT_DURATION_MIN = 5;
export const APPOINTMENT_DURATION_MAX = 480;

export const WAITLIST_PERIODS = ["manha", "tarde", "qualquer"] as const;
export type WaitlistPeriod = (typeof WAITLIST_PERIODS)[number];

export const WAITLIST_PERIOD_LABEL: Record<WaitlistPeriod, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  qualquer: "Qualquer horário",
};

/** Quantos pacientes da lista de espera recebem a oferta de um horário liberado. */
export const WAITLIST_OFFER_SIZE = 3;

/* -------------------------------- Conversas -------------------------------- */

export const CONVERSATION_STATUSES = ["aberta", "aguardando_paciente", "resolvida"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  aberta: "Aberta",
  aguardando_paciente: "Aguardando paciente",
  resolvida: "Resolvida",
};

export const MESSAGE_DIRECTIONS = ["in", "out", "note", "system"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_STATUSES = ["recebida", "fila", "enviada", "entregue", "lida", "falhou"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Meta de primeira resposta (minutos). O relógio da conversa fica âmbar na metade e vermelho ao estourar. */
export const FIRST_RESPONSE_TARGET_MIN = 15;

/** Confirmação automática: último horário (local) em que a rotina ainda envia. */
export const AUTO_CONFIRM_LAST_HOUR = 20;

/* ------------------------------ Perfis da clínica -------------------------- */

export const CLINIC_ROLES = ["gestor", "recepcao", "profissional"] as const;
export type ClinicRole = (typeof CLINIC_ROLES)[number];

export const CLINIC_ROLE_LABEL: Record<ClinicRole, string> = {
  gestor: "Gestão",
  recepcao: "Recepção",
  profissional: "Profissional de saúde",
};

/* Permissões, perfis e cargos: veja permissions.ts */

/* ---------------------------- Funcionalidades (plano) ---------------------- */

/**
 * Chaves das funcionalidades do CRM (as mesmas do catálogo no backoffice).
 * O plano contratado decide quais ficam liberadas.
 */
export const CRM_FEATURES = {
  inbox: "crm.inbox",
  funnel: "crm.funnel",
  confirmations: "crm.confirmations",
  waitlist: "crm.waitlist",
  campaigns: "crm.campaigns",
  nps: "crm.nps",
  noShowRisk: "crm.noshow_risk",
} as const;
export type CrmFeature = (typeof CRM_FEATURES)[keyof typeof CRM_FEATURES];

export const CRM_FEATURE_LABEL: Record<CrmFeature, string> = {
  "crm.inbox": "Caixa de entrada omnichannel",
  "crm.funnel": "Jornada do paciente",
  "crm.confirmations": "Confirmação de consultas",
  "crm.waitlist": "Lista de espera inteligente",
  "crm.campaigns": "Radar de retornos",
  "crm.nps": "Pesquisa de satisfação",
  "crm.noshow_risk": "Risco de falta",
};

/** Fuso padrão das clínicas (Brasil sem horário de verão desde 2019). */
/** @deprecated Fuso PADRÃO (clínica sem fuso escolhido). Para o fuso da clínica atual use clinicTimeZone(). */
export const CLINIC_TIMEZONE = "America/Sao_Paulo";
