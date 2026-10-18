/**
 * FUSOS HORÁRIOS DO BRASIL (por clínica)
 *
 * Usamos os nomes oficiais da base IANA ("America/Manaus"), e não "UTC-4", por um
 * motivo prático: se o horário de verão voltar, ele volta só em alguns estados.
 * Com o nome por região, a atualização da base de fusos (Node e PostgreSQL) já
 * aplica a regra certa a cada clínica, sem mexer no código nem nos cadastros.
 *
 * O Brasil não tem horário de verão desde 2019. Os deslocamentos abaixo são os atuais.
 */

export interface BrTimeZone {
  id: string;
  /** Deslocamento atual em relação ao UTC, em horas */
  offset: number;
  /** Onde se usa (para a pessoa reconhecer o seu) */
  label: string;
  /** UFs que usam este fuso (sugestão automática pelo estado da clínica) */
  ufs: string[];
}

export const BR_TIME_ZONES: readonly BrTimeZone[] = [
  { id: "America/Noronha", offset: -2, label: "Fernando de Noronha", ufs: [] },
  { id: "America/Sao_Paulo", offset: -3, label: "Brasília: DF, GO, MG, ES, RJ, SP, PR, SC e RS", ufs: ["DF", "GO", "MG", "ES", "RJ", "SP", "PR", "SC", "RS"] },
  { id: "America/Bahia", offset: -3, label: "Bahia", ufs: ["BA"] },
  { id: "America/Fortaleza", offset: -3, label: "CE, MA, PI, RN e PB", ufs: ["CE", "MA", "PI", "RN", "PB"] },
  { id: "America/Recife", offset: -3, label: "Pernambuco", ufs: ["PE"] },
  { id: "America/Maceio", offset: -3, label: "Alagoas e Sergipe", ufs: ["AL", "SE"] },
  { id: "America/Belem", offset: -3, label: "Pará (leste) e Amapá", ufs: ["PA", "AP"] },
  { id: "America/Santarem", offset: -3, label: "Pará (oeste)", ufs: [] },
  { id: "America/Araguaina", offset: -3, label: "Tocantins", ufs: ["TO"] },
  { id: "America/Campo_Grande", offset: -4, label: "Mato Grosso do Sul", ufs: ["MS"] },
  { id: "America/Cuiaba", offset: -4, label: "Mato Grosso", ufs: ["MT"] },
  { id: "America/Manaus", offset: -4, label: "Amazonas (a maior parte)", ufs: ["AM"] },
  { id: "America/Porto_Velho", offset: -4, label: "Rondônia", ufs: ["RO"] },
  { id: "America/Boa_Vista", offset: -4, label: "Roraima", ufs: ["RR"] },
  { id: "America/Rio_Branco", offset: -5, label: "Acre", ufs: ["AC"] },
  { id: "America/Eirunepe", offset: -5, label: "Amazonas (sudoeste: Eirunepé e região)", ufs: [] },
];

export const DEFAULT_CLINIC_TIMEZONE = "America/Sao_Paulo";

const IDS = new Set(BR_TIME_ZONES.map((z) => z.id));
export const isBrTimeZone = (id: string | null | undefined): id is string => !!id && IDS.has(id);

/** Sugestão pelo estado (UF) da clínica. Sem estado ou desconhecido: Brasília. */
export function suggestTimeZone(uf: string | null | undefined): string {
  const u = (uf ?? "").trim().toUpperCase();
  return BR_TIME_ZONES.find((z) => z.ufs.includes(u))?.id ?? DEFAULT_CLINIC_TIMEZONE;
}

/** "UTC−4 · Amazonas (a maior parte)" para listas */
export function timeZoneLabel(id: string): string {
  const z = BR_TIME_ZONES.find((x) => x.id === id);
  if (!z) return id;
  return `UTC${z.offset < 0 ? "−" : "+"}${Math.abs(z.offset)}: ${z.label}`;
}

/* --------------------------- Fuso da clínica atual -------------------------- */

/**
 * O servidor registra aqui como descobrir o fuso da clínica da requisição atual
 * (contexto por requisição). Sem resolvedor, ou fora de uma requisição: Brasília.
 * No navegador não há resolvedor: os componentes recebem o fuso por parâmetro.
 */
let resolver: (() => string | undefined) | null = null;

export function setTimeZoneResolver(fn: () => string | undefined): void {
  resolver = fn;
}

/** Fuso da clínica da requisição atual. */
export function clinicTimeZone(): string {
  return resolver?.() ?? DEFAULT_CLINIC_TIMEZONE;
}
