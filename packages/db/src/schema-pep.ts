/**
 * Esquema do TROPI PRONTUÁRIO (prontuário eletrônico do paciente).
 *
 * REGRAS LEGAIS QUE MOLDAM AS TABELAS
 *  - CFM 1.821/2007 e Lei 13.787/2018: o prontuário é guardado por no mínimo 20 anos
 *    e o registro finalizado não pode ser alterado. Correção = ADENDO (novo registro,
 *    com autor e data), nunca edição.
 *  - Por isso: chaves para contato/profissional usam "no action" (não apaga paciente com
 *    prontuário), e a migração 0030 cria políticas RESTRITIVAS no banco: atendimento
 *    finalizado não aceita UPDATE nem DELETE; adendo e auditoria aceitam só INSERT.
 *  - LGPD: o pedido de exclusão do titular NÃO apaga o prontuário (art. 16, I: obrigação
 *    legal). A identificação é copiada para `identity_snapshot` antes de anonimizar o contato.
 *
 * Isolamento entre clínicas: igual ao CRM (clinic_id + Row-Level Security).
 * Exceção: `cid10`, tabela de referência pública (DATASUS), igual para todas as clínicas.
 */
import type { AccessMode, Answers, ClinicArea, Diagnosis, DocumentContent, DocumentKind, TemplateField, TemplateKind, Vitals } from "@ecosaude/core/pep";
import { sql } from "drizzle-orm";
import { boolean, index, inet, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinics } from "./schema";
import { appointments, clinicUnits, clinicUsers, contacts, professionals } from "./schema-crm";

const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .default(sql`nullif(current_setting('app.clinic_id', true), '')::uuid`)
    .references(() => clinics.id, { onDelete: "cascade" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------- Tipos auxiliares ------------------------------- */

export interface Allergy {
  name: string;
  reaction?: string;
  severity?: "leve" | "moderada" | "grave";
}
export interface MedicationInUse {
  name: string;
  dose?: string;
}
export interface Problem {
  name: string;
  cid?: string;
  since?: string;
  active: boolean;
}
/** Cópia da identificação feita antes da anonimização LGPD (o prontuário continua identificável para a clínica) */
export interface IdentitySnapshot {
  name: string;
  birthDate: string | null;
  sex: string | null;
  cpf: string | null;
  at: string;
}
/** Cabeçalho congelado do documento: o PDF sai igual mesmo se o cadastro mudar depois */
export interface DocumentHeader {
  clinic: { name: string; document?: string | null; address?: string | null; phone?: string | null; note?: string | null };
  professional: { name: string; specialty?: string | null; council?: string | null };
  patient: { name: string; cpf?: string | null; birthDate?: string | null; age?: number | null };
}

/* --------------------------------- Ajustes ---------------------------------- */

export const pepSettings = pgTable("pep_settings", {
  clinicId: clinicId().primaryKey(),
  /** todos = qualquer profissional abre; proprios = só quem atendeu (demais por acesso de emergência) */
  accessMode: text("access_mode").$type<AccessMode>().notNull().default("todos"),
  /** Linha extra no cabeçalho dos documentos (ex.: endereço, CNES, telefone) */
  headerNote: text("header_note"),
  /** Dias padrão de retorno sugeridos ao finalizar (vazio = sem sugestão) */
  defaultReturnDays: integer("default_return_days"),
  /**
   * Acesso de emergência: além do sino, avisar a gestão por e-mail.
   * O e-mail NÃO leva nome do paciente nem motivo (e-mail não é canal seguro): só que houve
   * um acesso e o link para ver no Tropi.
   */
  emergencyEmail: boolean("emergency_email").notNull().default(false),
  /**
   * Áreas em que a clínica atende (medicina, odontologia, psicologia...): definem os formulários
   * prontos instalados e servem de reserva quando a especialidade do profissional não é reconhecida.
   */
  areas: text("areas").array().$type<ClinicArea[]>().notNull().default(sql`'{}'`),
  updatedBy: uuid("updated_by").references(() => clinicUsers.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

/* --------------------------------- Modelos ---------------------------------- */

export const pepTemplates = pgTable(
  "pep_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    specialty: text("specialty").notNull(),
    /** Especialidade do catálogo do Tropi (SPECIALTIES.key). Vazio = modelo próprio da clínica */
    specialtyKey: text("specialty_key"),
    /** primeira | retorno | outro: o Tropi usa para escolher o formulário certo no atendimento */
    kind: text("kind").$type<TemplateKind>(),
    name: text("name").notNull(),
    fields: jsonb("fields").$type<TemplateField[]>().notNull(),
    /** Modelo pronto do Tropi (BUILT_IN_TEMPLATES.key). A clínica pode editar a cópia dela. */
    systemKey: text("system_key"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("pep_templates_system_unique")
      .on(t.clinicId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    index("pep_templates_clinic_idx").on(t.clinicId, t.active),
  ],
);

/* -------------------------------- Atendimentos ------------------------------- */

export const pepEncounters = pgTable(
  "pep_encounters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "no action" }),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "no action" }),
    /** Consulta da agenda que originou o atendimento (vazio = atendimento avulso) */
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    /** Unidade onde o atendimento aconteceu (endereço e CNES dos documentos) */
    unitId: uuid("unit_id").references(() => clinicUnits.id, { onDelete: "restrict" }),
    templateId: uuid("template_id").references(() => pepTemplates.id, { onDelete: "set null" }),
    /** Cópia dos campos do modelo no momento do atendimento (editar o modelo não muda registros antigos) */
    templateName: text("template_name"),
    templateFields: jsonb("template_fields").$type<TemplateField[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").$type<"rascunho" | "finalizado">().notNull().default("rascunho"),
    answers: jsonb("answers").$type<Answers>().notNull().default(sql`'{}'::jsonb`),
    vitals: jsonb("vitals").$type<Vitals>().notNull().default(sql`'{}'::jsonb`),
    diagnoses: jsonb("diagnoses").$type<Diagnosis[]>().notNull().default(sql`'[]'::jsonb`),
    /** Conduta / plano */
    conduct: text("conduct"),
    returnDays: integer("return_days"),
    returnNote: text("return_note"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    finishedBy: uuid("finished_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    /** SHA-256 do conteúdo finalizado (detecta qualquer alteração posterior no banco) */
    hash: text("hash"),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pep_encounters_contact_idx").on(t.clinicId, t.contactId, t.startedAt),
    index("pep_encounters_pro_idx").on(t.clinicId, t.professionalId, t.status),
    uniqueIndex("pep_encounters_appointment_unique")
      .on(t.appointmentId)
      .where(sql`${t.appointmentId} is not null`),
  ],
);

/** Complemento de um atendimento já finalizado (a única forma de "corrigir" o registro) */
export const pepAddenda = pgTable(
  "pep_addenda",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => pepEncounters.id, { onDelete: "no action" }),
    text: text("text").notNull(),
    authorId: uuid("author_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("pep_addenda_encounter_idx").on(t.encounterId)],
);

/* -------------------------------- Documentos -------------------------------- */

export const pepDocuments = pgTable(
  "pep_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id").references(() => pepEncounters.id, { onDelete: "no action" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "no action" }),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "no action" }),
    kind: text("kind").$type<DocumentKind>().notNull(),
    content: jsonb("content").$type<DocumentContent>().notNull(),
    header: jsonb("header").$type<DocumentHeader>().notNull(),
    hash: text("hash").notNull(),
    /** Código impresso no documento: confere a autenticidade em /documento/<código> */
    verificationCode: text("verification_code").notNull(),
    issuedBy: uuid("issued_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /** Documento emitido por engano: fica cancelado (a verificação mostra "cancelado") */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    revokeReason: text("revoke_reason"),
  },
  (t) => [uniqueIndex("pep_documents_code_unique").on(t.verificationCode), index("pep_documents_contact_idx").on(t.clinicId, t.contactId, t.issuedAt), index("pep_documents_encounter_idx").on(t.encounterId)],
);

/* ------------------------------ Resumo do paciente ----------------------------- */

/** O que aparece no topo do prontuário: alergias, medicamentos em uso, problemas, antecedentes */
export const pepPatientProfiles = pgTable("pep_patient_profiles", {
  contactId: uuid("contact_id")
    .primaryKey()
    .references(() => contacts.id, { onDelete: "no action" }),
  clinicId: clinicId(),
  allergies: jsonb("allergies").$type<Allergy[]>().notNull().default(sql`'[]'::jsonb`),
  /** Marcado quando o profissional confirma "nega alergias" (diferente de "não perguntado") */
  noKnownAllergies: boolean("no_known_allergies").notNull().default(false),
  medications: jsonb("medications").$type<MedicationInUse[]>().notNull().default(sql`'[]'::jsonb`),
  problems: jsonb("problems").$type<Problem[]>().notNull().default(sql`'[]'::jsonb`),
  history: text("history"),
  identitySnapshot: jsonb("identity_snapshot").$type<IdentitySnapshot>(),
  updatedBy: uuid("updated_by").references(() => clinicUsers.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
});

/* --------------------------------- Triagem ---------------------------------- */

export const TRIAGE_PRIORITIES = ["normal", "prioritario", "urgente"] as const;
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];

/**
 * Pré-consulta (enfermagem ou o próprio profissional): queixa, sinais vitais e prioridade.
 * Uma por consulta. Os sinais vitais vão automaticamente para o atendimento quando ele começa.
 */
export const pepTriages = pgTable(
  "pep_triages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "no action" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    complaint: text("complaint"),
    vitals: jsonb("vitals").$type<Vitals>().notNull().default(sql`'{}'::jsonb`),
    priority: text("priority").$type<TriagePriority>().notNull().default("normal"),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    recordedByName: text("recorded_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("pep_triages_appointment_unique")
      .on(t.appointmentId)
      .where(sql`${t.appointmentId} is not null`),
    index("pep_triages_contact_idx").on(t.clinicId, t.contactId, t.createdAt),
  ],
);

/* -------------------------------- Auditoria --------------------------------- */

export const PEP_AUDIT_ACTIONS = ["abrir", "emergencia", "finalizar", "adendo", "emitir", "imprimir", "cancelar_documento", "exportar", "triagem"] as const;
export type PepAuditAction = (typeof PEP_AUDIT_ACTIONS)[number];

/** Quem viu e fez o quê no prontuário. Só INSERT (ninguém do app altera ou apaga). */
export const pepAudit = pgTable(
  "pep_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    userId: uuid("user_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    userName: text("user_name").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "no action" }),
    encounterId: uuid("encounter_id"),
    documentId: uuid("document_id"),
    action: text("action").$type<PepAuditAction>().notNull(),
    /** Justificativa (obrigatória no acesso de emergência) */
    reason: text("reason"),
    ip: inet("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pep_audit_contact_idx").on(t.clinicId, t.contactId, t.at), index("pep_audit_action_idx").on(t.clinicId, t.action, t.at)],
);

/* ---------------------------------- CID-10 ---------------------------------- */

/** CID-10 (DATASUS, revisão 2008): categorias (A00) e subcategorias (A00.0). Leitura para todos. */
export const cid10 = pgTable(
  "cid10",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    /** Nome sem acento, minúsculo (busca) */
    search: text("search").notNull(),
    /** F ou M quando o código só vale para um sexo */
    sex: text("sex"),
    chapter: integer("chapter").notNull(),
  },
  // ~14 mil linhas: a busca por trecho (ILIKE) varre a tabela em poucos milissegundos, sem índice extra
);
