/**
 * Esquema do banco (Drizzle ORM).
 * Cada `pgTable` vira uma tabela no PostgreSQL. Após mudar este arquivo:
 *   pnpm db:generate   -> cria o SQL da migração em packages/db/migrations
 *   pnpm db:migrate    -> aplica no banco
 *
 * Convenções:
 *  - ids em UUID (não revelam quantos registros existem, ao contrário de 1, 2, 3...)
 *  - datas com fuso (timestamptz)
 *  - dinheiro em centavos (integer)
 *  - nomes de colunas em snake_case no banco, camelCase no TypeScript
 */
import { BILLING_CYCLES, CLINIC_SIZES, LEAD_STAGES, MODULE_IDS, STAFF_ROLES, SUBSCRIPTION_STATUSES } from "@ecosaude/core";
import { relations, sql } from "drizzle-orm";
import { boolean, index, inet, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/* --------------------------------- Enums ---------------------------------- */
// Enums do PostgreSQL gerados a partir das listas do @ecosaude/core.
export const moduleIdEnum = pgEnum("module_id", MODULE_IDS);
export const leadStageEnum = pgEnum("lead_stage", LEAD_STAGES);
export const clinicSizeEnum = pgEnum("clinic_size", CLINIC_SIZES);
export const subscriptionStatusEnum = pgEnum("subscription_status", SUBSCRIPTION_STATUSES);
export const billingCycleEnum = pgEnum("billing_cycle", BILLING_CYCLES);
export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);

/** Colunas de data padrão. */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* --------------------------------- Equipe --------------------------------- */

export const staffUsers = pgTable(
  "staff_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: staffRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    /** Obriga a trocar a senha no próximo login (contas recém-criadas). */
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    /** Segredo do 2FA CRIPTOGRAFADO (AES-256-GCM). Nunca em texto puro. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    /** Último intervalo de 30s já usado: impede reutilizar o mesmo código (replay). */
    totpLastStep: integer("totp_last_step"),
    /** Proteção contra tentativa e erro de senha. */
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  // e-mail único sem diferenciar maiúsculas
  (t) => [uniqueIndex("staff_users_email_unique").on(sql`lower(${t.email})`)],
);

/**
 * Sessões de login.
 * O navegador guarda um token aleatório; aqui fica só o HASH (sha-256) dele.
 * Se o banco vazar, os tokens não podem ser usados.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha-256 do token
    userId: uuid("user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    /** false até o usuário passar pela 2FA (quando ela está ativa). */
    twoFactorPassed: boolean("two_factor_passed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ---------------------------------- Leads --------------------------------- */

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    clinicName: text("clinic_name").notNull(),
    size: clinicSizeEnum("size").notNull(),
    interests: moduleIdEnum("interests")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Data do consentimento LGPD dado no formulário. */
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    source: text("source").notNull().default("site"),
    stage: leadStageEnum("stage").notNull().default("novo"),
    ownerId: uuid("owner_id").references(() => staffUsers.id, { onDelete: "set null" }),
    lostReason: text("lost_reason"),
    /** Preenchido quando o lead vira cliente. */
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("leads_stage_idx").on(t.stage), index("leads_created_idx").on(t.createdAt)],
);

export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => staffUsers.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_notes_lead_idx").on(t.leadId)],
);

/* ------------------------------ Catálogo ---------------------------------- */

/** Módulos do ecossistema (CRM, ERP...). id = "crm", "erp"... */
export const modules = pgTable("modules", {
  id: moduleIdEnum("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Funcionalidades de cada módulo (ex.: "Lista de espera inteligente"). */
export const submodules = pgTable(
  "submodules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: moduleIdEnum("module_id")
      .notNull()
      .references(() => modules.id),
    /** Identificador estável usado pelo código dos sistemas, ex.: "crm.waitlist". */
    key: text("key").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("submodules_key_unique").on(t.key)],
);

/** Planos de cada módulo (cada módulo é vendido separadamente). */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: moduleIdEnum("module_id")
      .notNull()
      .references(() => modules.id),
    name: text("name").notNull(),
    description: text("description"),
    priceMonthlyCents: integer("price_monthly_cents").notNull(),
    /** Limite de usuários da clínica neste plano (null = ilimitado). */
    maxUsers: integer("max_users"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("plans_module_name_unique").on(t.moduleId, t.name)],
);

/** Quais funcionalidades cada plano inclui. */
export const planSubmodules = pgTable(
  "plan_submodules",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    submoduleId: uuid("submodule_id")
      .notNull()
      .references(() => submodules.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.planId, t.submoduleId] })],
);

/* --------------------------- Clínicas e contratações ---------------------- */

export const clinics = pgTable(
  "clinics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradeName: text("trade_name").notNull(),
    legalName: text("legal_name"),
    cnpj: text("cnpj"),
    email: text("email"),
    phone: text("phone"),
    city: text("city"),
    state: text("state"),
    /**
     * Fuso horário da clínica (nome IANA, ex.: "America/Manaus"). Agenda, lembretes,
     * horário de atendimento e relatórios "do dia" seguem este fuso. Só fusos do Brasil
     * (CHECK na migração 0025). Padrão: Brasília.
     */
    timeZone: text("time_zone").notNull().default("America/Sao_Paulo"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("clinics_cnpj_unique")
      .on(t.cnpj)
      .where(sql`${t.cnpj} is not null`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    /** Copiado do plano para permitir a regra "uma contratação aberta por módulo". */
    moduleId: moduleIdEnum("module_id").notNull(),
    status: subscriptionStatusEnum("status").notNull(),
    billingCycle: billingCycleEnum("billing_cycle").notNull().default("mensal"),
    /** Preço "congelado" no momento da contratação (mudanças no catálogo não afetam). */
    priceMonthlyCents: integer("price_monthly_cents").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => staffUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("subscriptions_clinic_idx").on(t.clinicId),
    // Regra de negócio garantida PELO BANCO: no máximo uma contratação
    // em teste/ativa/suspensa por clínica e módulo.
    uniqueIndex("subscriptions_one_open_per_module")
      .on(t.clinicId, t.moduleId)
      .where(sql`${t.status} in ('teste', 'ativa', 'suspensa')`),
  ],
);

/**
 * Exceções de funcionalidade por contratação.
 * Ex.: liberar "Lista de espera" para uma clínica do plano Essencial, como cortesia.
 * enabled=true libera algo fora do plano; enabled=false bloqueia algo do plano.
 */
export const subscriptionOverrides = pgTable(
  "subscription_overrides",
  {
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    submoduleId: uuid("submodule_id")
      .notNull()
      .references(() => submodules.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.subscriptionId, t.submoduleId] })],
);

/* -------------------------------- Auditoria ------------------------------- */

/**
 * Trilha de auditoria: quem fez o quê, quando e de onde.
 * IMUTÁVEL: um gatilho no banco (migração custom) bloqueia UPDATE e DELETE,
 * inclusive para quem tem acesso direto ao banco pela aplicação.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * "restrict": quem já tem ações registradas NÃO pode ser apagado do banco
     * (a auditoria é imutável). Membros que saem da equipe são DESATIVADOS.
     */
    actorId: uuid("actor_id").references(() => staffUsers.id, { onDelete: "restrict" }),
    /** Copiado para o registro continuar legível mesmo fora do contexto. */
    actorEmail: text("actor_email"),
    action: text("action").notNull(), // ex.: "lead.stage_changed"
    entity: text("entity").notNull(), // ex.: "lead"
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

/** Controle de envios do formulário do site (limite por IP contra spam). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(), // ex.: "contato:203.0.113.5"
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------- Relações -------------------------------- */
// Permitem consultas aninhadas, ex.: db.query.clinics.findFirst({ with: { subscriptions: true } })

export const staffUsersRelations = relations(staffUsers, ({ many }) => ({
  sessions: many(sessions),
  leads: many(leads),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(staffUsers, { fields: [sessions.userId], references: [staffUsers.id] }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  owner: one(staffUsers, { fields: [leads.ownerId], references: [staffUsers.id] }),
  clinic: one(clinics, { fields: [leads.clinicId], references: [clinics.id] }),
  notes: many(leadNotes),
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
  author: one(staffUsers, { fields: [leadNotes.authorId], references: [staffUsers.id] }),
}));

export const modulesRelations = relations(modules, ({ many }) => ({
  submodules: many(submodules),
  plans: many(plans),
}));

export const submodulesRelations = relations(submodules, ({ one, many }) => ({
  module: one(modules, { fields: [submodules.moduleId], references: [modules.id] }),
  plans: many(planSubmodules),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  module: one(modules, { fields: [plans.moduleId], references: [modules.id] }),
  submodules: many(planSubmodules),
  subscriptions: many(subscriptions),
}));

export const planSubmodulesRelations = relations(planSubmodules, ({ one }) => ({
  plan: one(plans, { fields: [planSubmodules.planId], references: [plans.id] }),
  submodule: one(submodules, { fields: [planSubmodules.submoduleId], references: [submodules.id] }),
}));

export const clinicsRelations = relations(clinics, ({ many }) => ({
  subscriptions: many(subscriptions),
  leads: many(leads),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  clinic: one(clinics, { fields: [subscriptions.clinicId], references: [clinics.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  overrides: many(subscriptionOverrides),
}));

export const subscriptionOverridesRelations = relations(subscriptionOverrides, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscriptionOverrides.subscriptionId],
    references: [subscriptions.id],
  }),
  submodule: one(submodules, { fields: [subscriptionOverrides.submoduleId], references: [submodules.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(staffUsers, { fields: [auditLog.actorId], references: [staffUsers.id] }),
}));
