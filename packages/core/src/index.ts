/**
 * @ecosaude/core: o "vocabulário" do negócio em um só lugar.
 * Site, backoffice e banco usam estas listas, então um novo status ou perfil
 * é adicionado aqui uma vez só.
 *
 * Cada lista é declarada "as const" para o TypeScript gerar tipos exatos
 * (ex.: LeadStage = "novo" | "contato" | ...).
 */

/* ------------------------------- Marca -------------------------------- */

/**
 * Identidade do ecossistema em UM lugar: trocar o nome ou o slogan é mudar aqui.
 * Grafia: "Tropi" no texto, "tropi" (minúsculas) só no logotipo. Nunca "TROPI".
 * Tropi vem de tropismo: o movimento em direção à luz.
 */
export const BRAND = {
  name: "Tropi",
  /** Slogan: a jornada inteira do paciente, que atravessa os quatro módulos */
  tagline: "Do primeiro contato ao retorno.",
  /** Como a equipe de suporte é chamada nos textos ("fale com a equipe Tropi") */
  team: "equipe Tropi",
} as const;

/* ------------------------------ Módulos ------------------------------ */

/** Ids internos (rotas, banco, planos). NÃO mudam com a marca: só os nomes exibidos mudam. */
export const MODULE_IDS = ["crm", "erp", "pep", "bi"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** Nome curto do módulo (dentro do Tropi): menus, planos, etiquetas. Português simples, sem siglas. */
export const MODULE_LABEL: Record<ModuleId, string> = {
  crm: "Atendimento",
  erp: "Gestão",
  pep: "Prontuário",
  bi: "Indicadores",
};

/** Nome completo, para quando o módulo aparece sozinho (site, contratação): "Tropi Atendimento". */
export const MODULE_FULL_NAME: Record<ModuleId, string> = {
  crm: `${BRAND.name} ${MODULE_LABEL.crm}`,
  erp: `${BRAND.name} ${MODULE_LABEL.erp}`,
  pep: `${BRAND.name} ${MODULE_LABEL.pep}`,
  bi: `${BRAND.name} ${MODULE_LABEL.bi}`,
};

/* ------------------------------- Leads ------------------------------- */

/** Etapas do funil comercial, na ordem em que acontecem. */
export const LEAD_STAGES = ["novo", "contato", "demonstracao", "proposta", "ganho", "perdido"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  novo: "Novo",
  contato: "Em contato",
  demonstracao: "Demonstração",
  proposta: "Proposta",
  ganho: "Ganho",
  perdido: "Perdido",
};

/** Etapas encerradas: não aparecem como "em aberto" no funil. */
export const LEAD_CLOSED_STAGES: readonly LeadStage[] = ["ganho", "perdido"];

export const CLINIC_SIZES = ["1-3", "4-10", "11-30", "31+"] as const;
export type ClinicSize = (typeof CLINIC_SIZES)[number];

export const CLINIC_SIZE_LABEL: Record<ClinicSize, string> = {
  "1-3": "1 a 3 profissionais",
  "4-10": "4 a 10 profissionais",
  "11-30": "11 a 30 profissionais",
  "31+": "Mais de 30 profissionais",
};

/* --------------------------- Contratações --------------------------- */

export const SUBSCRIPTION_STATUSES = ["teste", "ativa", "suspensa", "cancelada"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  teste: "Em teste",
  ativa: "Ativa",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
};

/** Status que "ocupam" o módulo: só pode haver uma contratação assim por clínica e módulo. */
export const SUBSCRIPTION_OPEN_STATUSES: readonly SubscriptionStatus[] = ["teste", "ativa", "suspensa"];

/** Status que liberam as funcionalidades para a clínica usar. */
export const SUBSCRIPTION_ENABLED_STATUSES: readonly SubscriptionStatus[] = ["teste", "ativa"];

/**
 * Transições permitidas entre status.
 * Evita, por exemplo, reativar algo cancelado (o certo é criar nova contratação).
 */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  teste: ["ativa", "cancelada"],
  ativa: ["suspensa", "cancelada"],
  suspensa: ["ativa", "cancelada"],
  cancelada: [],
};

export const BILLING_CYCLES = ["mensal", "anual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/* ------------------------------- Equipe ------------------------------ */

export const STAFF_ROLES = ["admin", "comercial", "suporte", "financeiro"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Administrador",
  comercial: "Comercial",
  suporte: "Suporte",
  financeiro: "Financeiro",
};

/**
 * Permissões por ação (não só por tela).
 * Regra: cada server action chama requirePermission("...") antes de agir.
 */
export const PERMISSIONS = [
  "leads.view",
  "leads.edit",
  "clinics.view",
  "clinics.edit",
  "subscriptions.edit",
  "catalog.view",
  "catalog.edit",
  "staff.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  comercial: ["leads.view", "leads.edit", "clinics.view", "clinics.edit", "subscriptions.edit", "catalog.view"],
  suporte: ["leads.view", "clinics.view", "catalog.view"],
  financeiro: ["clinics.view", "subscriptions.edit", "catalog.view", "catalog.edit", "audit.view"],
};

export function can(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/* ------------------------------- Dinheiro ---------------------------- */

/**
 * Valores em dinheiro são guardados em CENTAVOS (inteiros) para evitar
 * erros de arredondamento de ponto flutuante (0,1 + 0,2 ≠ 0,3).
 */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Converte "1.234,56" ou "1234.56" em centavos. Retorna null se inválido. */
export function parseMoneyToCents(input: string): number | null {
  const clean = input.trim().replace(/[R$\s]/g, "");
  if (!clean) return null;
  // Formato brasileiro: ponto como milhar e vírgula como decimal
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
