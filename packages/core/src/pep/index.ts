/**
 * TROPI PRONTUÁRIO: regras sem banco e sem servidor (rodam também no navegador).
 *
 *  - Modelos de atendimento: campos configuráveis (texto, número, escolha, escala...).
 *  - Sinais vitais: faixas de adulto e alertas de valor preocupante; IMC calculado.
 *  - Documentos: o conteúdo de cada tipo (receita, atestado, declaração, pedido de exames,
 *    encaminhamento), validado antes de gerar o PDF.
 *  - Sigilo: quem pode abrir o prontuário de quem.
 *
 * O que precisa de criptografia (hash do registro finalizado) fica em ./server.ts.
 */
import { z } from "zod";

/* ------------------------------ Modelos (campos) ------------------------------ */

export const FIELD_TYPES = ["texto", "texto_longo", "numero", "escolha", "multipla", "escala", "sim_nao", "titulo"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  texto: "Texto curto",
  texto_longo: "Texto longo",
  numero: "Número",
  escolha: "Escolha única",
  multipla: "Múltipla escolha",
  escala: "Escala (0 a 10)",
  sim_nao: "Sim ou não",
  titulo: "Título de seção",
};

export const templateFieldSchema = z.object({
  /** Identificador estável do campo (as respostas ficam guardadas por ele) */
  id: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "Identificador: letras minúsculas, números e _"),
  label: z.string().trim().min(1, "Nome do campo").max(120),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  unit: z.string().trim().max(20).optional(),
  required: z.boolean().optional(),
  hint: z.string().trim().max(200).optional(),
});
export type TemplateField = z.infer<typeof templateFieldSchema>;

export const templateFieldsSchema = z
  .array(templateFieldSchema)
  .min(1, "Inclua pelo menos um campo")
  .max(80)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      if (seen.has(f.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `Campo repetido: ${f.id}` });
      seen.add(f.id);
      if ((f.type === "escolha" || f.type === "multipla") && !f.options?.length) ctx.addIssue({ code: "custom", path: [i, "options"], message: `${f.label}: informe as opções` });
    });
  });

export type Answers = Record<string, string | number | boolean | string[] | null>;

/** Confere as respostas contra o modelo. Na finalização, campos obrigatórios precisam estar preenchidos. */
export function validateAnswers(fields: TemplateField[], answers: Answers, opts: { final: boolean }): { answers: Answers; errors: Record<string, string> } {
  const out: Answers = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === "titulo") continue;
    const v = answers[f.id];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    if (empty) {
      if (opts.final && f.required) errors[f.id] = `${f.label}: obrigatório`;
      continue;
    }
    switch (f.type) {
      case "texto":
      case "texto_longo":
        out[f.id] = String(v).slice(0, f.type === "texto" ? 500 : 20000);
        break;
      case "numero": {
        const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
        if (Number.isFinite(n)) out[f.id] = n;
        else errors[f.id] = `${f.label}: número inválido`;
        break;
      }
      case "escala": {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= 10) out[f.id] = n;
        else errors[f.id] = `${f.label}: de 0 a 10`;
        break;
      }
      case "sim_nao":
        out[f.id] = v === true || v === "sim" || v === "true";
        break;
      case "escolha":
        if (f.options?.includes(String(v))) out[f.id] = String(v);
        else errors[f.id] = `${f.label}: opção inválida`;
        break;
      case "multipla": {
        const list = (Array.isArray(v) ? v : [String(v)]).filter((x) => f.options?.includes(x));
        if (list.length) out[f.id] = list;
        break;
      }
    }
  }
  return { answers: out, errors };
}

/* ------------------------------ Modelos prontos ------------------------------ */

export interface BuiltInTemplate {
  key: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
}

/** Modelos que toda clínica recebe (pode editar uma cópia). Fase 1: clínica médica geral. */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    key: "clinica_geral_primeira",
    specialty: "Clínica médica geral",
    name: "Primeira consulta",
    fields: [
      { id: "queixa", label: "Queixa principal", type: "texto", required: true },
      { id: "hda", label: "História da doença atual", type: "texto_longo", required: true },
      { id: "sec_antecedentes", label: "Antecedentes", type: "titulo" },
      { id: "antecedentes_pessoais", label: "Antecedentes pessoais", type: "texto_longo", hint: "Doenças prévias, cirurgias, internações" },
      { id: "antecedentes_familiares", label: "Antecedentes familiares", type: "texto_longo" },
      { id: "habitos", label: "Hábitos", type: "multipla", options: ["Tabagismo", "Ex-tabagista", "Álcool", "Atividade física regular", "Sedentarismo"] },
      { id: "revisao_sistemas", label: "Revisão de sistemas", type: "texto_longo" },
      { id: "sec_exame", label: "Exame físico", type: "titulo" },
      { id: "estado_geral", label: "Estado geral", type: "escolha", options: ["Bom", "Regular", "Ruim"] },
      { id: "exame_fisico", label: "Exame físico", type: "texto_longo" },
    ],
  },
  {
    key: "clinica_geral_retorno",
    specialty: "Clínica médica geral",
    name: "Retorno / evolução",
    fields: [
      { id: "evolucao", label: "Evolução desde a última consulta", type: "texto_longo", required: true },
      { id: "adesao", label: "Seguiu o tratamento?", type: "escolha", options: ["Sim", "Em parte", "Não"] },
      { id: "exames_trazidos", label: "Exames trazidos", type: "texto_longo" },
      { id: "exame_fisico", label: "Exame físico", type: "texto_longo" },
    ],
  },
];

/* --------------------------------- Sinais vitais -------------------------------- */

export const VITALS = [
  { id: "pas", label: "Pressão sistólica", unit: "mmHg", min: 50, max: 300 },
  { id: "pad", label: "Pressão diastólica", unit: "mmHg", min: 20, max: 200 },
  { id: "fc", label: "Frequência cardíaca", unit: "bpm", min: 20, max: 250 },
  { id: "fr", label: "Frequência respiratória", unit: "irpm", min: 4, max: 80 },
  { id: "temp", label: "Temperatura", unit: "°C", min: 30, max: 45 },
  { id: "spo2", label: "Saturação de O₂", unit: "%", min: 50, max: 100 },
  { id: "peso", label: "Peso", unit: "kg", min: 0.3, max: 400 },
  { id: "altura", label: "Altura", unit: "cm", min: 20, max: 250 },
  { id: "glicemia", label: "Glicemia capilar", unit: "mg/dL", min: 10, max: 1000 },
] as const;
export type VitalId = (typeof VITALS)[number]["id"];
export type Vitals = Partial<Record<VitalId, number>>;

export interface VitalAlert {
  id: VitalId | "imc";
  level: "atencao" | "urgente";
  message: string;
}

/** Lê e confere os sinais vitais digitados (vírgula ou ponto). Valores impossíveis viram erro. */
export function parseVitals(raw: Record<string, string | number | null | undefined>): { vitals: Vitals; errors: Record<string, string> } {
  const vitals: Vitals = {};
  const errors: Record<string, string> = {};
  for (const v of VITALS) {
    const r = raw[v.id];
    if (r === undefined || r === null || r === "") continue;
    const n = typeof r === "number" ? r : Number(String(r).replace(",", "."));
    if (!Number.isFinite(n) || n < v.min || n > v.max) errors[v.id] = `${v.label}: valor fora do possível (${v.min} a ${v.max} ${v.unit})`;
    else vitals[v.id] = Math.round(n * 10) / 10;
  }
  if (vitals.pas !== undefined && vitals.pad !== undefined && vitals.pad >= vitals.pas) errors.pad = "Pressão diastólica maior que a sistólica: confira.";
  return { vitals, errors };
}

/** IMC (kg/m²) e a classificação da OMS para adultos */
export function bmi(v: Vitals): { value: number; label: string } | null {
  if (!v.peso || !v.altura) return null;
  const value = Math.round((v.peso / (v.altura / 100) ** 2) * 10) / 10;
  const label = value < 18.5 ? "Baixo peso" : value < 25 ? "Peso adequado" : value < 30 ? "Sobrepeso" : value < 35 ? "Obesidade grau I" : value < 40 ? "Obesidade grau II" : "Obesidade grau III";
  return { value, label };
}

/**
 * Alertas para ADULTOS (crianças têm faixas por idade: sem alerta automático na fase 1).
 * "urgente" = pede ação imediata (ex.: crise hipertensiva, saturação baixa).
 */
export function vitalAlerts(v: Vitals, ageYears: number | null): VitalAlert[] {
  if (ageYears !== null && ageYears < 18) return [];
  const a: VitalAlert[] = [];
  if (v.pas !== undefined || v.pad !== undefined) {
    const s = v.pas ?? 0;
    const d = v.pad ?? 0;
    if (s >= 180 || d >= 120) a.push({ id: "pas", level: "urgente", message: "Pressão muito alta (180/120 ou mais): avaliar crise hipertensiva." });
    else if (s >= 140 || d >= 90) a.push({ id: "pas", level: "atencao", message: "Pressão elevada (140/90 ou mais)." });
    else if (v.pas !== undefined && s < 90) a.push({ id: "pas", level: "atencao", message: "Pressão baixa (sistólica abaixo de 90)." });
  }
  if (v.fc !== undefined) {
    if (v.fc < 40 || v.fc > 130) a.push({ id: "fc", level: "urgente", message: `Frequência cardíaca ${v.fc} bpm.` });
    else if (v.fc < 50 || v.fc > 100) a.push({ id: "fc", level: "atencao", message: `Frequência cardíaca ${v.fc} bpm (fora de 50 a 100).` });
  }
  if (v.fr !== undefined && (v.fr < 10 || v.fr > 24)) a.push({ id: "fr", level: v.fr > 30 || v.fr < 8 ? "urgente" : "atencao", message: `Frequência respiratória ${v.fr} irpm.` });
  if (v.temp !== undefined) {
    if (v.temp >= 39.5 || v.temp < 35) a.push({ id: "temp", level: "urgente", message: `Temperatura ${v.temp} °C.` });
    else if (v.temp >= 37.8) a.push({ id: "temp", level: "atencao", message: `Febre (${v.temp} °C).` });
  }
  if (v.spo2 !== undefined) {
    if (v.spo2 < 90) a.push({ id: "spo2", level: "urgente", message: `Saturação ${v.spo2}%.` });
    else if (v.spo2 < 95) a.push({ id: "spo2", level: "atencao", message: `Saturação ${v.spo2}% (abaixo de 95).` });
  }
  if (v.glicemia !== undefined) {
    if (v.glicemia < 70) a.push({ id: "glicemia", level: v.glicemia < 54 ? "urgente" : "atencao", message: `Glicemia ${v.glicemia} mg/dL (hipoglicemia).` });
    else if (v.glicemia >= 250) a.push({ id: "glicemia", level: v.glicemia >= 400 ? "urgente" : "atencao", message: `Glicemia ${v.glicemia} mg/dL.` });
  }
  const b = bmi(v);
  if (b && (b.value < 18.5 || b.value >= 30)) a.push({ id: "imc", level: "atencao", message: `IMC ${b.value.toLocaleString("pt-BR")} (${b.label.charAt(0).toLowerCase()}${b.label.slice(1)}).` });
  return a;
}

/* ------------------------------------ CID-10 ------------------------------------ */

export interface Diagnosis {
  code: string;
  name: string;
  /** Diagnóstico principal do atendimento */
  principal?: boolean;
}

export function normalizeCidCode(v: string): string {
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length > 3 ? `${c.slice(0, 3)}.${c.slice(3, 4)}` : c;
}

export const isCidCode = (v: string) => /^[A-Z]\d{2}(\.\d)?$/.test(v);

/** Texto para busca sem acento e em minúsculas */
export function searchText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/* ---------------------------------- Documentos ---------------------------------- */

export const DOCUMENT_KINDS = ["receita", "receita_especial", "atestado", "declaracao", "pedido_exames", "encaminhamento"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  receita: "Receita",
  receita_especial: "Receita de controle especial",
  atestado: "Atestado",
  declaracao: "Declaração de comparecimento",
  pedido_exames: "Pedido de exames",
  encaminhamento: "Encaminhamento",
};

const text = (max: number) => z.string().trim().max(max);

export const prescriptionItemSchema = z.object({
  medication: text(200).min(2, "Nome do medicamento"),
  /** Como usar: "1 comprimido de 8 em 8 horas por 7 dias" */
  instructions: text(500).min(2, "Como usar"),
  quantity: text(80).optional(),
  route: z.enum(["oral", "topica", "injetavel", "inalatoria", "oftalmica", "otologica", "nasal", "retal", "vaginal", "sublingual", "outra"]).default("oral"),
});

export const ROUTE_LABEL: Record<z.infer<typeof prescriptionItemSchema>["route"], string> = {
  oral: "Uso oral",
  topica: "Uso tópico",
  injetavel: "Uso injetável",
  inalatoria: "Uso inalatório",
  oftalmica: "Uso oftálmico",
  otologica: "Uso otológico",
  nasal: "Uso nasal",
  retal: "Uso retal",
  vaginal: "Uso vaginal",
  sublingual: "Uso sublingual",
  outra: "Outra via",
};

export const documentContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("receita"), items: z.array(prescriptionItemSchema).min(1, "Inclua pelo menos um medicamento").max(20), notes: text(1000).optional() }),
  z.object({ kind: z.literal("receita_especial"), items: z.array(prescriptionItemSchema).min(1, "Inclua pelo menos um medicamento").max(3), notes: text(1000).optional() }),
  z.object({
    kind: z.literal("atestado"),
    days: z.coerce.number().int().min(1, "Mínimo 1 dia").max(365),
    startDate: z.iso.date(),
    /** O CID só vai no atestado com autorização expressa do paciente */
    includeCid: z.boolean().default(false),
    cid: z.string().optional(),
    notes: text(1000).optional(),
  }),
  z.object({ kind: z.literal("declaracao"), date: z.iso.date(), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/), companion: text(160).optional() }),
  z.object({ kind: z.literal("pedido_exames"), items: z.array(text(200).min(2)).min(1, "Inclua pelo menos um exame").max(40), indication: text(500).optional() }),
  z.object({ kind: z.literal("encaminhamento"), to: text(160).min(2, "Para quem (especialidade ou profissional)"), reason: text(2000).min(5, "Motivo do encaminhamento"), urgency: z.enum(["eletivo", "prioritario", "urgente"]).default("eletivo") }),
]);
export type DocumentContent = z.infer<typeof documentContentSchema>;

/* ------------------------------------ Sigilo ------------------------------------ */

export const ACCESS_MODES = ["todos", "proprios"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const ACCESS_MODE_LABEL: Record<AccessMode, string> = {
  todos: "Todos os prontuários da clínica",
  proprios: "Só dos pacientes que o profissional atendeu (os demais por acesso de emergência)",
};

/**
 * Pode abrir o prontuário? "emergencia" = só com justificativa (registrada e avisada à gestão).
 * `attended`: o profissional (ligado ao usuário) já atendeu ou tem consulta com o paciente.
 */
export function recordAccess(input: { mode: AccessMode; canRead: boolean; canEmergency: boolean; attended: boolean }): "liberado" | "emergencia" | "negado" {
  if (!input.canRead) return "negado";
  if (input.mode === "todos" || input.attended) return "liberado";
  return input.canEmergency ? "emergencia" : "negado";
}

/* --------------------------------- Idade e datas -------------------------------- */

export function ageYears(birthDate: string | null | undefined, at = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const [y, m, d] = birthDate.slice(0, 10).split("-").map(Number) as [number, number, number];
  let age = at.getUTCFullYear() - y;
  if (at.getUTCMonth() + 1 < m || (at.getUTCMonth() + 1 === m && at.getUTCDate() < d)) age--;
  return age >= 0 && age < 150 ? age : null;
}

/* Avisos ativos (acesso de emergência, triagem urgente) */
export * from "./notices";
