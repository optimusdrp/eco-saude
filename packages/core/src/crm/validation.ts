/**
 * Validações dos formulários do Tropi (usadas no navegador E no servidor).
 */
import { ROOM_KINDS } from "./units";
import { z } from "zod";
import { passwordSchema } from "../validation/index";
import { APPOINTMENT_STATUSES, CHANNELS, CLINIC_ROLES, JOURNEY_STAGES, WAITLIST_PERIODS } from "./constants";
import { RULE_ACTIONS, RULE_CONDITIONS, RULE_TRIGGER_KEYS } from "./automations";
import { validateWeekly, WEEKDAY_KEYS, type WeeklySchedule } from "./hours";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Telefone: guarda só números, com DDI 55 quando vier só DDD + número. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Telefone inválido. Use DDD + número.")
  .transform((v) => (v === "" ? undefined : v.length <= 11 ? `55${v}` : v));

/** CPF válido (dígitos verificadores). Aceita com ou sem pontuação; vazio = não informado. */
export function isValidCpf(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

export const cpfSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => v === "" || isValidCpf(v), "CPF inválido.")
  .transform((v) => v || undefined);

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  phone: phoneSchema,
  email: z.union([z.email("E-mail inválido."), z.literal("")]).transform((v) => v || undefined),
  birthDate: z.union([z.iso.date({ error: "Data inválida." }), z.literal("")]).transform((v) => v || undefined),
  /** Sexo biológico (define a referência dos exames) e CPF: opcionais */
  sex: z.union([z.enum(["F", "M"]), z.literal("")]).optional().transform((v) => v || undefined),
  cpf: cpfSchema.optional(),
  preferredChannel: z.union([z.enum(CHANNELS), z.literal("")]).transform((v) => v || undefined),
  source: optionalText(60),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12),
    ),
  consentMarketing: z.boolean(),
  /** Versão lida pela tela (controle de edição simultânea). */
  version: z.coerce.number().int().min(1).optional(),
});

export const stageChangeSchema = z.object({
  contactId: z.uuid(),
  stage: z.enum(JOURNEY_STAGES),
  lostReason: optionalText(300),
});

export const noteSchema = z.object({
  contactId: z.uuid(),
  body: z.string().trim().min(1, "Escreva a anotação.").max(2000),
  /** ID gerado no navegador: reenviar a mesma nota (ex.: rede instável) não duplica. */
  clientId: z.uuid().optional(),
});

export const sendMessageSchema = z.object({
  conversationId: z.uuid(),
  /** Pode ficar vazio quando vai um anexo (a ação confere: texto OU arquivo) */
  body: z.string().trim().max(4000),
  internal: z.boolean(),
  clientId: z.uuid(),
  /** Mensagem a partir de modelo aprovado (permitida fora da janela de 24h). */
  templateId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
});

/** Duração opcional da consulta, em minutos (vazio = padrão do profissional) */
const durationField = z
  .union([z.coerce.number().int().min(5, "Mínimo de 5 minutos.").max(480, "Máximo de 8 horas."), z.literal("")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

export const appointmentSchema = z.object({
  contactId: z.uuid({ error: "Escolha o paciente." }),
  professionalId: z.uuid({ error: "Escolha o profissional." }),
  date: z.iso.date({ error: "Informe a data." }),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Informe o horário."),
  service: optionalText(80),
  notes: optionalText(500),
  /** De onde veio a marcação (conversa, recepção, lista de espera) */
  source: z.enum(["recepcao", "conversa", "lista_espera"]).default("recepcao"),
  /** Mensagem de proposta ao paciente pelo canal da conversa */
  notifyConversationId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  /** Duração própria (vazio = a duração padrão do profissional) */
  durationMinutes: durationField,
});

export const appointmentStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(APPOINTMENT_STATUSES),
  reason: optionalText(300),
  version: z.coerce.number().int().min(1),
});

/** Remarcar: novo dia/horário (e, se quiser, outro profissional). */
export const rescheduleSchema = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().min(1),
  professionalId: z.uuid({ error: "Escolha o profissional." }),
  date: z.iso.date({ error: "Informe a data." }),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Escolha o horário."),
  /** Avisar o paciente pelo canal dele */
  notify: z.boolean(),
  durationMinutes: durationField,
});

/** Corrigir serviço, observações e duração de uma consulta já marcada. */
export const appointmentDetailsSchema = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().min(1),
  service: optionalText(80),
  notes: optionalText(500),
  durationMinutes: durationField,
  /** Consultório: id, "" = sem consultório, ausente = não muda */
  roomId: z.union([z.uuid(), z.literal("")]).optional(),
});

/* ------------------------------ Profissionais ------------------------------ */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato 08:00.");

export const PROFESSIONAL_COLORS = ["crm", "erp", "pep", "bi"] as const;

/** Semana de atendimento (JSON vindo do editor de horários do profissional). */
const periodSchema = z.object({ start: hhmm, end: hhmm, unitId: z.uuid().optional(), roomId: z.uuid().optional() });
const daySchema = z.object({
  periods: z.array(periodSchema).max(4),
  slotMinutes: z.coerce.number().int().min(5).max(240).optional(),
});
export const weeklyScheduleSchema = z.partialRecord(z.enum(WEEKDAY_KEYS), daySchema);

export const professionalSchema = z
  .object({
    id: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((v) => v || undefined),
    name: z.string().trim().min(2, "Informe o nome.").max(120),
    specialty: optionalText(80),
    /** Conselho profissional (CRM, CRO, CRBM...), número e UF: vão no pedido de exame e no laudo assinado */
    council: z
      .string()
      .trim()
      .toUpperCase()
      .max(10)
      .refine((v) => v === "" || /^[A-Z]{2,8}$/.test(v), "Use a sigla do conselho (ex.: CRM, CRO, CRBM).")
      .transform((v) => v || undefined)
      .optional(),
    councilNumber: z
      .string()
      .trim()
      .max(20)
      .refine((v) => v === "" || /^[0-9A-Za-z.-]+$/.test(v), "Número do registro inválido.")
      .transform((v) => v || undefined)
      .optional(),
    councilUf: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "UF com 2 letras.")
      .transform((v) => v || undefined)
      .optional(),
    color: z.enum(PROFESSIONAL_COLORS),
    /** Duração padrão da consulta (cada dia pode ter a sua) */
    slotMinutes: z.coerce.number().int().min(5, "Mínimo de 5 minutos.").max(240, "Máximo de 4 horas."),
    /** Semana: chega como texto JSON do formulário */
    weeklySchedule: z
      .string()
      .transform((v, ctx) => {
        try {
          return JSON.parse(v) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Horários inválidos." });
          return z.NEVER;
        }
      })
      .pipe(weeklyScheduleSchema),
    /** Usuário do sistema ligado a este profissional (vê a própria agenda) */
    userId: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((v) => v || undefined),
    active: z.boolean(),
  })
  .superRefine((d, ctx) => {
    for (const message of validateWeekly(d.weeklySchedule as WeeklySchedule, d.slotMinutes)) ctx.addIssue({ code: "custom", path: ["weeklySchedule"], message });
  });

/* -------------------------- Unidades e consultórios -------------------------- */

const ufField = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "UF com 2 letras.")
  .transform((v) => v || undefined)
  .optional();

/** Unidade de atendimento (endereço onde a clínica atende) */
export const unitSchema = z.object({
  id: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  name: z.string().trim().min(2, "Informe o nome (ex.: Unidade Centro).").max(80),
  address: optionalText(200),
  district: optionalText(80),
  city: optionalText(80),
  state: ufField,
  zip: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 8, "CEP com 8 números.")
    .transform((v) => v || undefined)
    .optional(),
  phone: optionalText(30),
  /** Cadastro Nacional de Estabelecimentos de Saúde (7 números): vai nos documentos */
  cnes: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{7}$/.test(v), "CNES com 7 números.")
    .transform((v) => v || undefined)
    .optional(),
  active: z.boolean(),
});

/** Consultório ou sala de uma unidade */
export const roomSchema = z.object({
  id: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  unitId: z.uuid("Escolha a unidade."),
  name: z.string().trim().min(1, "Informe o nome (ex.: Consultório 1).").max(60),
  kind: z.enum(ROOM_KINDS),
  notes: optionalText(200),
  active: z.boolean(),
});

/** Ausência do profissional (férias, congresso, folga): sem horários livres nesses dias. */
export const absenceSchema = z
  .object({
    professionalId: z.uuid(),
    startsOn: z.iso.date({ error: "Informe a data de início." }),
    endsOn: z.iso.date({ error: "Informe a data de fim." }),
    reason: optionalText(120),
  })
  .refine((d) => d.endsOn >= d.startsOn, { path: ["endsOn"], message: "O fim precisa ser no mesmo dia ou depois do início." });

/* ------------------------- Preferências do Tropi ----------------------------- */

export const crmSettingsSchema = z.object({
  autoConfirm: z.boolean(),
  confirmHour: z.coerce.number().int().min(0).max(23),
  confirmDaysBefore: z.coerce.number().int().min(1).max(3),
});

/** Abrir conversa com o paciente por um canal. */
export const startConversationSchema = z.object({
  contactId: z.uuid(),
  channel: z.enum(CHANNELS),
});

export const waitlistSchema = z.object({
  contactId: z.uuid({ error: "Escolha o paciente." }),
  professionalId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  /** Unidade em que o paciente aceita ser atendido (vazio = qualquer) */
  unitId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  period: z.enum(WAITLIST_PERIODS),
  notes: optionalText(300),
});

export const quickReplySchema = z.object({
  id: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,24}$/, "Use de 2 a 24 letras, números ou hífen (sem a barra)."),
  title: z.string().trim().min(2, "Informe o título.").max(60),
  body: z.string().trim().min(2, "Escreva a mensagem.").max(1000),
  approvedTemplate: z.boolean(),
});

export const returnProtocolSchema = z.object({
  id: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  serviceMatch: optionalText(80),
  daysAfter: z.coerce.number().int().min(7, "Mínimo de 7 dias.").max(730, "Máximo de 2 anos."),
  message: z.string().trim().min(10, "Escreva a mensagem.").max(1000),
  active: z.boolean(),
});

export const taskSchema = z.object({
  /** Tarefa sem paciente também vale (ex.: "conferir estoque de luvas") */
  contactId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
  title: z.string().trim().min(2, "Descreva a tarefa.").max(160),
  dueDate: z.iso.date({ error: "Informe a data." }),
  /** Responsável (vazio = quem está criando) */
  assigneeId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || undefined),
});

export const clinicUserSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  email: z.email("E-mail inválido."),
  role: z.enum(CLINIC_ROLES),
});

/** Novo acesso criado pela clínica: o perfil é um dos perfis (cargos) da clínica. */
export const clinicStaffSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  email: z.email("E-mail inválido."),
  roleId: z.uuid({ error: "Escolha o perfil." }),
});

/** Perfil (cargo) da clínica. */
export const clinicRoleSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  name: z.string().trim().min(2, "Dê um nome ao perfil.").max(60, "Use até 60 caracteres."),
  description: z
    .string()
    .trim()
    .max(200, "Use até 200 caracteres.")
    .transform((v) => v || null),
  base: z.enum(CLINIC_ROLES),
});

/** Mensagem enviada "como paciente" pelo simulador de canais. */
export const simulatorMessageSchema = z.object({
  channel: z.enum(CHANNELS),
  /** Identificador no canal: telefone (WhatsApp), @usuário (Telegram/Instagram) ou nome (Messenger) */
  externalId: z.string().trim().min(2, "Informe quem envia.").max(80),
  name: z.string().trim().max(120).optional(),
  /** Pode ficar vazio quando o paciente manda só um arquivo */
  text: z.string().trim().max(2000),
});

export { passwordSchema };

/* ----------------------------- Regras de automação ----------------------------- */

const ruleCondition = z.object({
  type: z.enum(RULE_CONDITIONS.map((c) => c.key) as [string, ...string[]]),
  value: z.string().trim().max(60).optional(),
});
const ruleAction = z.object({
  type: z.enum(RULE_ACTIONS.map((a) => a.key) as [string, ...string[]]),
  text: z.string().trim().max(1000).optional(),
  approved: z.boolean().optional(),
  dueInDays: z.coerce.number().int().min(0).max(60).optional(),
  assignee: z.string().max(40).optional(),
  stage: z.enum(JOURNEY_STAGES).optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
});

/** Regra "Quando → Se → Então" (chega como JSON do construtor). */
export const automationRuleSchema = z
  .object({
    name: z.string().trim().min(3, "Dê um nome à regra.").max(80),
    trigger: z.enum(RULE_TRIGGER_KEYS),
    filter: z.object({
      stage: z.union([z.enum(JOURNEY_STAGES), z.literal("")]).optional(),
      status: z.union([z.enum(APPOINTMENT_STATUSES), z.literal("")]).optional(),
      keywords: z.string().trim().max(300).optional(),
      channel: z.union([z.enum(CHANNELS), z.literal("")]).optional(),
      minScore: z.coerce.number().int().min(0).max(10).optional(),
      maxScore: z.coerce.number().int().min(0).max(10).optional(),
    }),
    conditions: z.array(ruleCondition).max(6),
    actions: z.array(ruleAction).min(1, "Inclua pelo menos uma ação.").max(6, "No máximo 6 ações."),
    delayMinutes: z.coerce.number().int().min(0).max(525600, "Espera de no máximo 1 ano."),
    oncePerContact: z.boolean(),
  })
  .superRefine((r, ctx) => {
    r.actions.forEach((a, i) => {
      if ((a.type === "send_message" || a.type === "internal_note" || a.type === "create_task") && !a.text)
        ctx.addIssue({ code: "custom", path: ["actions", i, "text"], message: "Escreva o texto da ação." });
      if ((a.type === "add_tag" || a.type === "remove_tag") && !a.tag) ctx.addIssue({ code: "custom", path: ["actions", i, "tag"], message: "Informe a etiqueta." });
      if (a.type === "move_stage" && !a.stage) ctx.addIssue({ code: "custom", path: ["actions", i, "stage"], message: "Escolha a etapa." });
      if (a.type === "set_owner" && !a.assignee) ctx.addIssue({ code: "custom", path: ["actions", i, "assignee"], message: "Escolha o responsável." });
    });
    r.conditions.forEach((c, i) => {
      if (["stage_in", "has_tag", "not_tag"].includes(c.type) && !c.value) ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: "Complete a condição." });
    });
    if (r.filter.minScore !== undefined && r.filter.maxScore !== undefined && r.filter.minScore > r.filter.maxScore)
      ctx.addIssue({ code: "custom", path: ["filter"], message: "A nota mínima é maior que a máxima." });
  });

/** Texto de mensagem automática editado pela clínica. */
export const messageTemplateSchema = z.object({
  key: z.string().min(1),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(1000, "Use até 1.000 caracteres."),
  enabled: z.boolean(),
});
