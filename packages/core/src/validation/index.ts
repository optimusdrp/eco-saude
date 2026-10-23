import { z } from "zod";
import {
  BILLING_CYCLES,
  CLINIC_SIZES,
  LEAD_STAGES,
  MODULE_IDS,
  STAFF_ROLES,
  SUBSCRIPTION_STATUSES,
} from "../index";

// Mensagens padrão do zod em português do Brasil (para campos sem mensagem própria)
z.config(z.locales.ptBR());

/**
 * Validações compartilhadas (zod).
 * Usadas no navegador (feedback imediato) E no servidor (validação de
 * verdade: o navegador pode ser burlado, o servidor não).
 */

/** Texto obrigatório com limite de tamanho e espaços removidos. */
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);
/** Texto opcional: string vazia vira undefined. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/* ------------------------- Formulário do site ------------------------ */

export const contactSchema = z.object({
  name: text(2, 120, "Informe seu nome."),
  email: z.email("Informe um e-mail válido.").max(160),
  clinic: text(2, 160, "Informe o nome da clínica ou do laboratório."),
  size: z.enum(CLINIC_SIZES, { error: "Escolha o número de profissionais." }),
  interests: z.array(z.enum(MODULE_IDS)).min(1, "Escolha pelo menos um módulo."),
  /** Consentimento LGPD: obrigatório para guardar o contato. */
  consent: z.literal(true, { error: "É preciso autorizar o contato." }),
  /** Campo invisível anti-robô: humanos deixam vazio. */
  website: z.string().max(0).optional(),
});
export type ContactInput = z.infer<typeof contactSchema>;

/* ------------------------------ Backoffice --------------------------- */

export const loginSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

export const totpCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "O código tem 6 números."),
});

/** Senha forte o suficiente para uma área com dados de clientes. */
export const passwordSchema = z
  .string()
  .min(12, "Use pelo menos 12 caracteres.")
  .max(128)
  .regex(/[a-z]/, "Inclua uma letra minúscula.")
  .regex(/[A-Z]/, "Inclua uma letra maiúscula.")
  .regex(/\d/, "Inclua um número.");

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Informe a senha atual."),
    next: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, { path: ["confirm"], message: "As senhas não conferem." });

/** "Esqueci a senha": só o e-mail */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Informe um e-mail válido.")),
});

/** Nova senha pelo link do e-mail (o token vem do endereço, nunca digitado) */
export const resetPasswordSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Link inválido."),
    next: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, {
    path: ["confirm"],
    message: "As senhas não conferem.",
  });

export const leadUpdateSchema = z.object({
  id: z.uuid(),
  stage: z.enum(LEAD_STAGES),
  ownerId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  lostReason: optionalText(300),
});

export const leadNoteSchema = z.object({
  leadId: z.uuid(),
  body: text(1, 2000, "Escreva a anotação."),
});

/** CNPJ: aceita com ou sem pontuação; guardamos só os 14 números. */
export const cnpjSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => v === "" || isValidCnpj(v), "CNPJ inválido.")
  .transform((v) => v || undefined);

export const clinicSchema = z.object({
  tradeName: text(2, 160, "Informe o nome da clínica ou do laboratório."),
  legalName: optionalText(200),
  cnpj: cnpjSchema,
  email: z.union([z.email("E-mail inválido."), z.literal("")]).transform((v) => v || undefined),
  phone: optionalText(30),
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/, "Use a sigla do estado, ex.: RS.")
    .transform((v) => v || undefined),
  leadId: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || undefined),
});

export const subscriptionCreateSchema = z.object({
  clinicId: z.uuid(),
  planId: z.uuid({ error: "Escolha um plano." }),
  status: z.enum(["teste", "ativa"]),
  billingCycle: z.enum(BILLING_CYCLES),
  trialDays: z.coerce.number().int().min(1).max(60).default(7),
});

export const subscriptionStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  reason: optionalText(300),
});

export const subscriptionOverrideSchema = z.object({
  subscriptionId: z.uuid(),
  submoduleId: z.uuid(),
  /** "default" remove a exceção e volta ao que o plano define. */
  mode: z.enum(["default", "on", "off"]),
});

export const planSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || undefined),
  moduleId: z.enum(MODULE_IDS),
  name: text(2, 60, "Informe o nome do plano."),
  description: optionalText(300),
  priceMonthly: z.string().trim().min(1, "Informe o preço."),
  maxUsers: z.coerce.number().int().min(1).max(10000).optional(),
  active: z.boolean(),
  submoduleIds: z.array(z.uuid()),
});

export const staffCreateSchema = z.object({
  name: text(2, 120, "Informe o nome."),
  email: z.email("E-mail inválido."),
  role: z.enum(STAFF_ROLES),
});

export const staffUpdateSchema = z.object({
  id: z.uuid(),
  role: z.enum(STAFF_ROLES),
  active: z.boolean(),
});

/* ------------------------------ Utilidades --------------------------- */

/** Valida os dígitos verificadores do CNPJ (algoritmo oficial da Receita). */
export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

/** Converte erros do zod em { campo: mensagem } para exibir no formulário. */
export function flattenErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
