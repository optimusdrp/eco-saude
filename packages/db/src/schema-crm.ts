/**
 * Esquema do módulo CRM (ambiente da clínica).
 *
 * ISOLAMENTO ENTRE CLÍNICAS
 * Toda tabela tem `clinic_id`. Além do filtro no código, o PostgreSQL aplica
 * Row-Level Security (migração 0005): o app da clínica acessa os dados com o
 * papel "ecosaude_tenant" e só enxerga as linhas da clínica da sessão.
 * O `clinic_id` tem como padrão a clínica da sessão (app.clinic_id), então
 * nem é preciso informá-lo nos inserts feitos pelo app.
 *
 * PREPARO PARA O MODO OFFLINE
 * - IDs em UUID podem ser gerados no aparelho (sem depender do servidor)
 * - `client_id` em mensagens e eventos: reenviar a mesma ação não duplica
 * - `version` em contatos e consultas: detecta edição simultânea (conflito)
 */
import type { ClosureKind, OpeningHours, RoomKind, RuleAction, RuleCondition, RuleFilter, WeeklySchedule } from "@ecosaude/core/crm";
import { APPOINTMENT_STATUSES, CHANNEL_MODES, CHANNELS, CLINIC_ROLES, CONVERSATION_STATUSES, JOURNEY_STAGES, MESSAGE_DIRECTIONS, MESSAGE_STATUSES, WAITLIST_PERIODS } from "@ecosaude/core/crm";
import { relations, sql } from "drizzle-orm";
import { boolean, date, index, inet, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clinics } from "./schema";

/* --------------------------------- Enums ---------------------------------- */

export const channelEnum = pgEnum("channel", CHANNELS);
export const channelModeEnum = pgEnum("channel_mode", CHANNEL_MODES);
export const journeyStageEnum = pgEnum("journey_stage", JOURNEY_STAGES);
export const appointmentStatusEnum = pgEnum("appointment_status", APPOINTMENT_STATUSES);
export const conversationStatusEnum = pgEnum("conversation_status", CONVERSATION_STATUSES);
export const messageDirectionEnum = pgEnum("message_direction", MESSAGE_DIRECTIONS);
export const messageStatusEnum = pgEnum("message_status", MESSAGE_STATUSES);
export const clinicRoleEnum = pgEnum("clinic_role", CLINIC_ROLES);
export const waitlistPeriodEnum = pgEnum("waitlist_period", WAITLIST_PERIODS);
export const waitlistStatusEnum = pgEnum("waitlist_status", ["aguardando", "oferecido", "agendado", "removido"]);
export const offerStatusEnum = pgEnum("offer_status", ["aberta", "preenchida", "expirada", "cancelada"]);

/* -------------------------------- Auxiliares ------------------------------- */

/** Coluna da clínica: obrigatória, com padrão = clínica da sessão atual. */
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

/* ------------------------------ Perfis (cargos) ---------------------------- */

/**
 * Perfis de acesso da clínica. Os 3 do sistema (system_key preenchido) não
 * podem ser excluídos; os demais são cargos criados pela clínica.
 * `permissions` guarda as chaves do catálogo (@ecosaude/core/crm, permissions.ts).
 * `base` é o nível de referência do cargo (alertas e contagens).
 */
export const clinicRoles = pgTable(
  "clinic_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    description: text("description"),
    base: clinicRoleEnum("base").notNull(),
    systemKey: clinicRoleEnum("system_key"),
    permissions: text("permissions")
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clinic_roles_name_unique").on(t.clinicId, sql`lower(${t.name})`),
    uniqueIndex("clinic_roles_system_unique")
      .on(t.clinicId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
  ],
);

/* ------------------------------ Usuários da clínica ------------------------ */

export const clinicUsers = pgTable(
  "clinic_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Nível de referência (igual ao `base` do perfil); o que a pessoa pode fazer vem do perfil */
    role: clinicRoleEnum("role").notNull(),
    /** Perfil (cargo). Vazio = perfil do sistema equivalente a `role` */
    roleId: uuid("role_id").references(() => clinicRoles.id, { onDelete: "set null" }),
    /** Ajuste fino só desta pessoa, além do perfil */
    permissionGrants: text("permission_grants")
      .array()
      .notNull()
      .default(sql`'{}'`),
    permissionRevokes: text("permission_revokes")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * Unidades em que a pessoa trabalha (agenda, Hoje e Consultório mostram só elas).
     * Vazio = todas as unidades.
     */
    unitIds: uuid("unit_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * PERFIL DE PROFISSIONAL DE SAÚDE (registro no conselho: CRM, CRO, COREN, CRP, CRN...).
     * Só quem tem este perfil (aqui ou num profissional da agenda ligado ao acesso) lê e registra
     * conteúdo clínico no Prontuário, qualquer que seja o cargo (ex.: gestora que também é médica).
     */
    healthCouncil: text("health_council"),
    healthCouncilNumber: text("health_council_number"),
    healthCouncilUf: text("health_council_uf"),
    active: boolean("active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpLastStep: integer("totp_last_step"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // E-mail único em TODAS as clínicas: o login descobre a clínica pelo e-mail
  (t) => [uniqueIndex("clinic_users_email_unique").on(sql`lower(${t.email})`), index("clinic_users_clinic_idx").on(t.clinicId)],
);

/** Sessões dos usuários da clínica (mesmo modelo do backoffice: só o hash do token). */
export const clinicSessions = pgTable(
  "clinic_sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    twoFactorPassed: boolean("two_factor_passed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("clinic_sessions_user_idx").on(t.userId)],
);

/**
 * Links de "Esqueci a senha". Guarda só o HASH do token (o token existe apenas no
 * e-mail). Uso único, prazo curto; pedir de novo invalida o anterior.
 * Fora do papel da clínica (ecosaude_tenant): só a autenticação mexe aqui.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** Pedido substituído por outro mais novo (ou cancelado pela troca de senha) */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    requestedIp: inet("requested_ip"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("password_resets_token_unique").on(t.tokenHash), index("password_resets_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Limite de tentativas de rotas públicas (ex.: pedidos de recuperação por IP).
 * A chave é um HASH (o IP não fica guardado em claro). Linhas antigas são apagadas pela rotina.
 */
export const authThrottle = pgTable(
  "auth_throttle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucket: text("bucket").notNull(),
    keyHash: text("key_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_throttle_idx").on(t.bucket, t.keyHash, t.createdAt)],
);

/* -------------------------- Unidades e consultórios ------------------------ */

/**
 * Unidade de atendimento: cada endereço onde a clínica atende. Toda clínica tem uma
 * principal (main), criada sozinha; quem tem um endereço só nem vê a escolha nas telas.
 * O endereço, o telefone e o CNES da unidade vão no cabeçalho dos documentos clínicos.
 */
export const clinicUnits = pgTable(
  "clinic_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    main: boolean("main").notNull().default(false),
    address: text("address"),
    district: text("district"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    phone: text("phone"),
    /** Cadastro Nacional de Estabelecimentos de Saúde (cada endereço tem o seu) */
    cnes: text("cnes"),
    /**
     * Horário de funcionamento (dias e períodos). null = herda: a unidade principal usa o padrão
     * (seg a sex, 8h às 18h) e as demais, o da principal. {} = não abre em nenhum dia.
     */
    openingHours: jsonb("opening_hours").$type<OpeningHours>(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clinic_units_name_unique").on(t.clinicId, sql`lower(${t.name})`),
    uniqueIndex("clinic_units_main_unique")
      .on(t.clinicId)
      .where(sql`${t.main}`),
  ],
);

/**
 * FERIADOS E FECHAMENTOS: dias em que a clínica (unit_id nulo) ou uma unidade não atende.
 * Bloqueiam os horários livres da unidade, avisam na marcação e mudam a resposta automática.
 * `national` = trazido pela lista de feriados nacionais (não repete ao trazer de novo).
 */
export const clinicClosures = pgTable(
  "clinic_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    unitId: uuid("unit_id").references(() => clinicUnits.id, { onDelete: "cascade" }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    reason: text("reason").notNull(),
    kind: text("kind").$type<ClosureKind>().notNull().default("feriado"),
    national: boolean("national").notNull().default(false),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("clinic_closures_dates_idx").on(t.clinicId, t.endsOn, t.startsOn),
    uniqueIndex("clinic_closures_national_unique")
      .on(t.clinicId, t.startsOn)
      .where(sql`${t.national}`),
  ],
);

/** Consultório ou sala de uma unidade. Duas consultas no mesmo consultório ao mesmo tempo: o banco recusa. */
export const clinicRooms = pgTable(
  "clinic_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => clinicUnits.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    kind: text("kind").$type<RoomKind>().notNull().default("consultorio"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("clinic_rooms_name_unique").on(t.unitId, sql`lower(${t.name})`), index("clinic_rooms_unit_idx").on(t.clinicId, t.unitId)],
);

/* ------------------------------- Profissionais ----------------------------- */

export const professionals = pgTable(
  "professionals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    specialty: text("specialty"),
    /** Cor da coluna na agenda (token da paleta: crm, erp, pep, bi) */
    color: text("color").notNull().default("crm"),
    userId: uuid("user_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    workStart: text("work_start").notNull().default("08:00"),
    workEnd: text("work_end").notNull().default("18:00"),
    breakStart: text("break_start").default("12:00"),
    breakEnd: text("break_end").default("13:00"),
    /** 0 = domingo ... 6 = sábado */
    workDays: integer("work_days")
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5}'`),
    /**
     * Semana completa: períodos e duração POR DIA (veja @ecosaude/core/crm hours.ts).
     * É a fonte de verdade; as colunas work_* acima ficam como resumo (primeiro
     * início, último fim, primeiro intervalo) para relatórios e compatibilidade.
     */
    weeklySchedule: jsonb("weekly_schedule").$type<WeeklySchedule>(),
    /**
     * Registro no conselho (CRM, CRO, CRP, CRN...): vai na receita, no atestado e nos demais
     * documentos do Tropi Prontuário. Ex.: council "CRM", number "12345", uf "RS".
     */
    council: text("council"),
    councilNumber: text("council_number"),
    councilUf: text("council_uf"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("professionals_clinic_idx").on(t.clinicId)],
);

/** Ausências por data (férias, congresso, folga): o profissional não tem horários livres. */
export const professionalAbsences = pgTable(
  "professional_absences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("professional_absences_pro_idx").on(t.clinicId, t.professionalId, t.endsOn)],
);

/* --------------------------------- Contatos -------------------------------- */

/**
 * Pessoa que fala com a clínica: começa como contato novo (lead) e segue
 * a jornada até paciente. Uma só ficha, do primeiro "oi" ao retorno anual.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    /** Somente números, com DDI (ex.: 5551999990000) */
    phone: text("phone"),
    email: text("email"),
    birthDate: date("birth_date"),
    /** Sexo biológico (F/M): usado no prontuário (referências e documentos). Vazio = não informado */
    sex: text("sex"),
    /** CPF (só números): identificação nos documentos clínicos (receita, atestado) e integrações */
    cpf: text("cpf"),
    stage: journeyStageEnum("stage").notNull().default("novo"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    lostReason: text("lost_reason"),
    /** Origem: whatsapp, instagram, indicação, google... */
    source: text("source"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    ownerId: uuid("owner_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    preferredChannel: channelEnum("preferred_channel"),
    /** Consentimento LGPD para mensagens de relacionamento (retornos, campanhas) */
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    /** Pediu para não receber mensagens (SAIR) */
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    /** Convênio informado (ou "Particular") */
    insurance: text("insurance"),
    /** Quem indicou a clínica (nome ou relação: "amiga Carla") */
    referredBy: text("referred_by"),
    /** LGPD: dados apagados a pedido do titular (irreversível). Ficha fica só com números sem identificação. */
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    /** Controle de edição simultânea (sobe 1 a cada alteração) */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_clinic_stage_idx").on(t.clinicId, t.stage), index("contacts_clinic_phone_idx").on(t.clinicId, t.phone)],
);

/** Como encontrar a mesma pessoa em cada canal (telefone, @usuário, id da página). */
export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contact_identities_unique").on(t.clinicId, t.channel, t.externalId)],
);

/* -------------------------------- Conversas -------------------------------- */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    status: conversationStatusEnum("status").notNull().default("aberta"),
    assigneeId: uuid("assignee_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    /**
     * Para quem responder: o identificador (telefone/@/id) de quem escreveu por
     * último nesta conversa. Importante quando o paciente tem dois números.
     * Só é usado enquanto ainda for uma identidade deste paciente.
     */
    replyTo: text("reply_to"),
    /** Última mensagem do paciente: define a janela de 24h dos canais da Meta */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    /** Desde quando o paciente espera resposta (null = ninguém esperando) */
    awaitingReplySince: timestamp("awaiting_reply_since", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    /** Última intenção detectada (agendar, remarcar...) */
    intent: text("intent"),
    /** Quem decidiu a intenção: regras (palavras-chave), ia ou equipe (correção manual) */
    intentSource: text("intent_source"),
    /** Certeza da IA (0 a 100), quando foi ela */
    intentConfidence: integer("intent_confidence"),
    /** Trecho que decidiu (explicação curta da IA) */
    intentReason: text("intent_reason"),
    /** Mensagem do paciente aguardando a IA confirmar/corrigir a intenção (fila) */
    intentPendingMessageId: uuid("intent_pending_message_id"),
    intentAttempts: integer("intent_attempts").notNull().default(0),
    /** Sentimento do paciente (calmo, impaciente, irritado, ameaca...) e quem decidiu (regras, ia, equipe) */
    sentiment: text("sentiment"),
    sentimentSource: text("sentiment_source"),
    sentimentConfidence: integer("sentiment_confidence"),
    sentimentReason: text("sentiment_reason"),
    /** 0 = tranquilo ... 4 = ameaça */
    sentimentLevel: integer("sentiment_level").notNull().default(0),
    /** Posição extra na fila (0 = normal). Calculada pelo ajuste "subir na fila a partir de" */
    sentimentPriority: integer("sentiment_priority").notNull().default(0),
    /** Maior nível já avisado à gestão nesta conversa (avisa de novo só se piorar) */
    sentimentAlertedLevel: integer("sentiment_alerted_level").notNull().default(0),
    sentimentPendingMessageId: uuid("sentiment_pending_message_id"),
    sentimentAttempts: integer("sentiment_attempts").notNull().default(0),
    urgent: boolean("urgent").notNull().default(false),
    urgentKind: text("urgent_kind"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Uma conversa por pessoa e canal: o histórico fica contínuo
    uniqueIndex("conversations_contact_channel_unique").on(t.clinicId, t.contactId, t.channel),
    index("conversations_inbox_idx").on(t.clinicId, t.status, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    /** in = paciente, out = clínica, note = nota interna, system = aviso automático */
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body").notNull(),
    status: messageStatusEnum("status").notNull(),
    authorId: uuid("author_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    /** ID da mensagem no canal (WhatsApp, Telegram...): impede gravar a mesma duas vezes */
    externalId: text("external_id"),
    /** ID gerado no aparelho de quem enviou: impede duplicar ao reenviar (offline) */
    clientId: uuid("client_id"),
    /** Modelo usado (necessário fora da janela de 24h) */
    templateKey: text("template_key"),
    /** Dados de automação, ex.: { kind: "waitlist_offer", offerId } */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    /** Só envia a partir deste momento (melhor horário do paciente). null = já */
    sendAfter: timestamp("send_after", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("messages_external_unique")
      .on(t.clinicId, t.channel, t.externalId)
      .where(sql`${t.externalId} is not null`),
    uniqueIndex("messages_client_unique")
      .on(t.clinicId, t.clientId)
      .where(sql`${t.clientId} is not null`),
    index("messages_queue_idx")
      .on(t.status)
      .where(sql`${t.status} = 'fila'`),
    // Ritmo do WhatsApp do celular: quantas saíram no último minuto e na última hora
    index("messages_sent_out_idx")
      .on(t.clinicId, t.channel, t.sentAt)
      .where(sql`${t.direction} = 'out' and ${t.sentAt} is not null`),
  ],
);

/* ---------------------------------- Agenda --------------------------------- */

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "restrict" }),
    /** Unidade onde a consulta acontece (vem do período da semana do profissional) */
    unitId: uuid("unit_id").references(() => clinicUnits.id, { onDelete: "restrict" }),
    /** Consultório (fixo do período, escolhido sozinho entre os livres, ou trocado na consulta) */
    roomId: uuid("room_id").references(() => clinicRooms.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").notNull().default("agendado"),
    service: text("service"),
    notes: text("notes"),
    /** recepcao, conversa, lista_espera */
    source: text("source").notNull().default("recepcao"),
    confirmationRequestedAt: timestamp("confirmation_requested_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    npsRequestedAt: timestamp("nps_requested_at", { withTimezone: true }),
    /** Automação "Lembrete no dia" já enviou (não repete) */
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    /** Automação "Mensagem pós-consulta" já enviou (não repete) */
    postVisitSentAt: timestamp("post_visit_sent_at", { withTimezone: true }),
    /** Chegada do paciente (botão "Chegou" = status compareceu) */
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    /** Fim do atendimento (botão "Finalizar atendimento"): mede a duração real */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("appointments_clinic_start_idx").on(t.clinicId, t.startsAt),
    index("appointments_contact_idx").on(t.contactId),
    index("appointments_unit_start_idx").on(t.clinicId, t.unitId, t.startsAt),
    // + restrição de "sem horário duplicado" por profissional (migração 0005, extensão btree_gist)
  ],
);

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** null = qualquer profissional */
    professionalId: uuid("professional_id").references(() => professionals.id, { onDelete: "set null" }),
    /** Unidade em que o paciente aceita ser atendido (null = qualquer) */
    unitId: uuid("unit_id").references(() => clinicUnits.id, { onDelete: "set null" }),
    period: waitlistPeriodEnum("period").notNull().default("qualquer"),
    notes: text("notes"),
    status: waitlistStatusEnum("status").notNull().default("aguardando"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("waitlist_clinic_status_idx").on(t.clinicId, t.status)],
);

/** Horário liberado (cancelamento) oferecido à lista de espera. Quem responder SIM primeiro fica com ele. */
export const slotOffers = pgTable("slot_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: clinicId(),
  professionalId: uuid("professional_id")
    .notNull()
    .references(() => professionals.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: offerStatusEnum("status").notNull().default("aberta"),
  originAppointmentId: uuid("origin_appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  filledAppointmentId: uuid("filled_appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  filledByContactId: uuid("filled_by_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const slotOfferCandidates = pgTable(
  "slot_offer_candidates",
  {
    offerId: uuid("offer_id")
      .notNull()
      .references(() => slotOffers.id, { onDelete: "cascade" }),
    waitlistEntryId: uuid("waitlist_entry_id")
      .notNull()
      .references(() => waitlistEntries.id, { onDelete: "cascade" }),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** enviada, aceitou, recusou, atrasado (respondeu depois de preenchida) */
    outcome: text("outcome").notNull().default("enviada"),
    /** Fatores do paciente NO MOMENTO da oferta (é o que permite aprender quem aceita) */
    features: jsonb("features").$type<Record<string, unknown>>(),
    /** Chance de aceitar estimada na hora (0 a 100) */
    score: integer("score"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.offerId, t.waitlistEntryId] })],
);

/* ------------------------- Relacionamento e rotina -------------------------- */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    assigneeId: uuid("assignee_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    /** manual, nps_baixo, retorno... */
    kind: text("kind").notNull().default("manual"),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_clinic_due_idx").on(t.clinicId, t.dueDate)],
);

/** Respostas rápidas: digite /atalho na conversa. */
export const quickReplies = pgTable(
  "quick_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    shortcut: text("shortcut").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Representa um modelo aprovado pela Meta: pode ser enviado fora da janela de 24h */
    approvedTemplate: boolean("approved_template").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quick_replies_shortcut_unique").on(t.clinicId, t.shortcut)],
);

/** Protocolos de retorno: "revisão em 180 dias", "retorno de 30 dias após consulta"... */
export const returnProtocols = pgTable("return_protocols", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: clinicId(),
  name: text("name").notNull(),
  /** Parte do nome do serviço da consulta (vazio = qualquer consulta) */
  serviceMatch: text("service_match"),
  daysAfter: integer("days_after").notNull(),
  message: text("message").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const npsResponses = pgTable("nps_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: clinicId(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  score: integer("score").notNull(),
  createdAt: createdAt(),
});

/**
 * Linha do tempo e trilha de ações do CRM: mudança de etapa, anotações,
 * status de consulta, lembretes enviados...
 */
export const crmEvents = pgTable(
  "crm_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    clientId: uuid("client_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("crm_events_contact_idx").on(t.clinicId, t.contactId, t.createdAt),
    uniqueIndex("crm_events_client_unique")
      .on(t.clinicId, t.clientId)
      .where(sql`${t.clientId} is not null`),
  ],
);

/**
 * Pares marcados como "não é a mesma pessoa" (ex.: mãe e filho com o mesmo
 * celular). Não voltam a aparecer na lista de possíveis duplicados.
 * Sempre gravado com contact_a < contact_b, para o par ser único.
 */
export const contactDuplicateDismissals = pgTable(
  "contact_duplicate_dismissals",
  {
    clinicId: clinicId(),
    contactA: uuid("contact_a")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    contactB: uuid("contact_b")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.contactA, t.contactB] })],
);

/**
 * Preferências do CRM da clínica (uma linha por clínica).
 * Confirmação automática: a rotina agendada envia o pedido de confirmação
 * das consultas de daqui a N dias, a partir de um horário do dia.
 */
export const crmSettings = pgTable("crm_settings", {
  clinicId: clinicId().primaryKey(),
  autoConfirm: boolean("auto_confirm").notNull().default(true),
  /** Hora local (fuso da clínica) a partir da qual o envio do dia acontece, 0 a 23 */
  confirmHour: integer("confirm_hour").notNull().default(10),
  /** Consultas de quantos dias à frente (1 = amanhã) */
  confirmDaysBefore: integer("confirm_days_before").notNull().default(1),
  /** Último dia (AAAA-MM-DD, fuso da clínica) em que a rotina já enviou: evita repetir */
  lastAutoConfirmOn: date("last_auto_confirm_on"),
  /** Automações do sistema: { chave: { enabled, ...parâmetros } } (padrões em @ecosaude/core/crm automations.ts) */
  automations: jsonb("automations").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
  /** Localização para a previsão de chuva (descoberta pela cidade da clínica) */
  geo: jsonb("geo").$type<{ lat: number; lon: number; place: string } | null>(),
  updatedAt: updatedAt(),
});

/**
 * Modelos aprendidos com os dados da clínica (risco de falta, aceite de encaixe).
 * Um registro por treino; o último "active" é o que vale. Guarda o relatório
 * (acerto no teste, comparação com a regra antiga, motivo de não usar).
 */
export const learnedModels = pgTable(
  "learned_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    /** risco | encaixe */
    kind: text("kind").notNull(),
    active: boolean("active").notNull().default(false),
    model: jsonb("model").$type<Record<string, unknown> | null>(),
    report: jsonb("report").$type<Record<string, unknown>>().notNull().default({}),
    trainedAt: timestamp("trained_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("learned_models_idx").on(t.clinicId, t.kind, t.trainedAt)],
);

/** Chuva por dia (previsão para os próximos dias, histórico para o treino). */
export const weatherDays = pgTable(
  "weather_days",
  {
    clinicId: clinicId(),
    date: date("date").notNull(),
    rainMm: real("rain_mm"),
    rainProb: integer("rain_prob"),
    /** previsao | historico */
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.date] })],
);

/** Duração por profissional e procedimento (aplicada pela equipe a partir da duração real). */
export const serviceDurations = pgTable(
  "service_durations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    serviceKey: text("service_key").notNull(),
    serviceLabel: text("service_label").notNull(),
    minutes: integer("minutes").notNull(),
    updatedBy: uuid("updated_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("service_durations_unique").on(t.clinicId, t.professionalId, t.serviceKey)],
);

/** Resumo da manhã (Hoje): o último texto do dia e os números que ele resume. */
export const dayBriefs = pgTable(
  "day_briefs",
  {
    clinicId: clinicId(),
    date: date("date").notNull(),
    /** Impressão dos números: mudou = novo texto */
    factsHash: text("facts_hash").notNull(),
    text: text("text").notNull(),
    /** ia | regras */
    source: text("source").notNull(),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.date] })],
);

/**
 * Mensagens automáticas reescritas pela clínica (o padrão fica no código:
 * @ecosaude/core/crm templates.ts). Sem linha = usa o texto padrão.
 */
export const messageTemplates = pgTable(
  "message_templates",
  {
    clinicId: clinicId(),
    key: text("key").notNull(),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.key] })],
);

/** Regras de automação da clínica: QUANDO (gatilho) + SE (condições) + ENTÃO (ações). */
export const automationRules = pgTable(
  "automation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    trigger: text("trigger").notNull(),
    filter: jsonb("filter").$type<RuleFilter>().notNull().default({}),
    conditions: jsonb("conditions").$type<RuleCondition[]>().notNull().default([]),
    actions: jsonb("actions").$type<RuleAction[]>().notNull().default([]),
    delayMinutes: integer("delay_minutes").notNull().default(0),
    oncePerContact: boolean("once_per_contact").notNull().default(false),
    runs: integer("runs").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automation_rules_trigger_idx").on(t.clinicId, t.trigger)],
);

/**
 * Fila de execução das regras: cada gatilho que bate vira uma linha "pendente"
 * com hora para rodar (agora ou depois da espera). O resultado fica gravado
 * (feita, ignorada com o motivo, ou falhou) e aparece no histórico.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    /** Dados do evento que disparou (etapa, nota, texto...) */
    event: jsonb("event").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    /** pendente, feita, ignorada, falhou */
    status: text("status").notNull().default("pendente"),
    result: text("result"),
    createdAt: createdAt(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [index("automation_runs_due_idx").on(t.clinicId, t.status, t.runAt), index("automation_runs_rule_idx").on(t.ruleId, t.contactId)],
);

/**
 * Rascunhos de resposta sugeridos (IA ou plano B por regras). Registro para
 * auditoria (quem pediu, qual modelo, quanto demorou, por que caiu no plano B)
 * e para medir a qualidade: o atendente usou como veio, editou ou descartou?
 */
export const aiDrafts = pgTable(
  "ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Última mensagem do paciente considerada (cache: mesma mensagem = mesmo rascunho) */
    lastMessageId: uuid("last_message_id"),
    requestedBy: uuid("requested_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    /** ia | regras */
    source: text("source").notNull(),
    provider: text("provider"),
    model: text("model"),
    tone: text("tone"),
    /** Por que caiu no plano B (desligada, sem chave, falha, lenta, bloqueada...) */
    fallbackReason: text("fallback_reason"),
    body: text("body").notNull(),
    needsHuman: boolean("needs_human").notNull().default(false),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** usado | editado | descartado (null = ainda sem decisão) */
    outcome: text("outcome"),
    sentBody: text("sent_body"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_drafts_conv_idx").on(t.clinicId, t.conversationId, t.createdAt), index("ai_drafts_user_idx").on(t.clinicId, t.requestedBy, t.createdAt)],
);

/**
 * Classificações de intenção: o que as palavras-chave acharam, o que a IA achou,
 * o que ficou e as correções da equipe. Mede se a IA está acertando.
 */
export const aiClassifications = pgTable(
  "ai_classifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id"),
    rulesIntent: text("rules_intent"),
    aiIntent: text("ai_intent"),
    finalIntent: text("final_intent"),
    confidence: integer("confidence"),
    /** ia | regras | equipe */
    source: text("source").notNull(),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    fallbackReason: text("fallback_reason"),
    correctedBy: uuid("corrected_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_classifications_idx").on(t.clinicId, t.createdAt)],
);

/**
 * Resumos de conversa ("Resumir", para quem assume no meio).
 * Fica guardado: a próxima pessoa que abrir a conversa já vê o último resumo
 * (e quantas mensagens chegaram depois dele), sem nova chamada à IA.
 */
export const aiSummaries = pgTable(
  "ai_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Última mensagem (de qualquer lado, inclusive nota) que o resumo cobre */
    lastMessageId: uuid("last_message_id"),
    /** Quantas mensagens foram lidas */
    messagesRead: integer("messages_read").notNull().default(0),
    requestedBy: uuid("requested_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    /** ia | regras */
    source: text("source").notNull(),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    /** Uma linha: "quer clareamento, pediu valor, prefere sábado de manhã, ainda sem resposta" */
    headline: text("headline").notNull(),
    /** Pontos curtos (no máximo 6) */
    points: jsonb("points").$type<string[]>().notNull().default([]),
    /** O que falta fazer, e quem precisa agir */
    nextStep: text("next_step"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** A equipe achou útil? (null = não avaliou) */
    helpful: boolean("helpful"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_summaries_conv_idx").on(t.clinicId, t.conversationId, t.createdAt), index("ai_summaries_user_idx").on(t.clinicId, t.requestedBy, t.createdAt)],
);

/**
 * Sentimento: o que as palavras-chave acharam, o que a IA achou, o que ficou,
 * se a gestão foi avisada e as correções da equipe. Mede se a IA está acertando.
 */
export const aiSentiments = pgTable(
  "ai_sentiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id"),
    rulesSentiment: text("rules_sentiment"),
    aiSentiment: text("ai_sentiment"),
    finalSentiment: text("final_sentiment"),
    level: integer("level").notNull().default(0),
    confidence: integer("confidence"),
    /** ia | regras | equipe */
    source: text("source").notNull(),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    fallbackReason: text("fallback_reason"),
    /** Gerou aviso para a gestão? */
    alerted: boolean("alerted").notNull().default(false),
    correctedBy: uuid("corrected_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_sentiments_idx").on(t.clinicId, t.createdAt)],
);

/**
 * "Lembrar o que ficou prometido": FILA e REGISTRO ao mesmo tempo.
 * Cada mensagem com jeito de compromisso entra como "pendente"; depois de lida
 * (IA ou regras) vira "feita", com as promessas achadas e as tarefas criadas.
 */
export const aiPromises = pgTable(
  "ai_promises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    /** Quem escreveu (vira o responsável da tarefa quando a promessa é da clínica) */
    authorId: uuid("author_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    /** clinica | paciente: de que lado veio a mensagem */
    side: text("side").notNull(),
    /** pendente | feita */
    status: text("status").notNull().default("pendente"),
    attempts: integer("attempts").notNull().default(0),
    /** ia | regras */
    source: text("source"),
    confidence: integer("confidence"),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    fallbackReason: text("fallback_reason"),
    /** Promessas achadas: [{ who, what, due }] */
    found: jsonb("found").$type<{ who: string; what: string; due: string | null }[]>().notNull().default([]),
    taskIds: jsonb("task_ids").$type<string[]>().notNull().default([]),
    /** Quantas a equipe marcou como "não era promessa" (mede falso positivo) */
    undone: integer("undone").notNull().default(0),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("ai_promises_pending_idx").on(t.clinicId, t.status), index("ai_promises_conv_idx").on(t.clinicId, t.conversationId, t.createdAt)],
);

/**
 * Fila genérica de trabalhos da IA que rodam DEPOIS (after/rotina):
 * cadastro (dados na conversa), etiquetas (comportamento), perda (motivo), retorno (texto).
 */
export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    /** cadastro | etiquetas | perda | retorno */
    kind: text("kind").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Mensagem relacionada (ex.: o lembrete de retorno a personalizar) */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    /** pendente | feita */
    status: text("status").notNull().default("pendente"),
    attempts: integer("attempts").notNull().default(0),
    /** ia | regras (de onde saiu o resultado) e por que não foi a IA */
    source: text("source"),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("ai_jobs_pending_idx").on(t.clinicId, t.status, t.kind)],
);

/** Motivo da perda organizado (uma linha por vez que o contato foi para Perdido). */
export const lossReasons = pgTable(
  "loss_reasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    quote: text("quote"),
    /** ia | regras | equipe (corrigido) */
    source: text("source").notNull(),
    confidence: integer("confidence"),
    lostAt: timestamp("lost_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("loss_reasons_idx").on(t.clinicId, t.lostAt)],
);

/** Sugestões para a ficha (cadastro) e etiquetas: a equipe aplica ou descarta. */
export const contactSuggestions = pgTable(
  "contact_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** campo | etiqueta */
    kind: text("kind").notNull(),
    /** email, birthDate, insurance, referredBy (campo) ou o nome da etiqueta */
    field: text("field").notNull(),
    value: text("value").notNull(),
    /** Trecho da conversa ou a contagem que mostra o dado */
    evidence: text("evidence"),
    /** ia | regras */
    source: text("source").notNull(),
    /** pendente | aplicada | descartada */
    status: text("status").notNull().default("pendente"),
    decidedBy: uuid("decided_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  // Uma sugestão por contato + campo + valor (descartada não volta a aparecer)
  (t) => [uniqueIndex("contact_suggestions_unique").on(t.clinicId, t.contactId, t.kind, t.field, t.value)],
);

/** Opinião sobre um par de possíveis duplicados (cache: não pergunta de novo à IA). */
export const duplicateReviews = pgTable(
  "duplicate_reviews",
  {
    clinicId: clinicId(),
    contactA: uuid("contact_a")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    contactB: uuid("contact_b")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    verdict: text("verdict").notNull(),
    reason: text("reason").notNull(),
    /** ia | regras */
    source: text("source").notNull(),
    confidence: integer("confidence"),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.contactA, t.contactB] })],
);

/**
 * "Criar regra escrevendo em português": cada pedido, quem leu (IA ou regras) e se
 * virou regra salva. Mede o acerto sem guardar dado de paciente (só a frase do gestor).
 */
export const aiRuleDrafts = pgTable(
  "ai_rule_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    actorId: uuid("actor_id").references(() => clinicUsers.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    /** ia | regras */
    source: text("source").notNull(),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    latencyMs: integer("latency_ms"),
    /** Preenchido quando a pessoa salva a regra a partir deste rascunho */
    ruleId: uuid("rule_id").references(() => automationRules.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_rule_drafts_idx").on(t.clinicId, t.createdAt)],
);

/**
 * Respostas rápidas sugeridas: textos que a equipe repetiu. `key` = impressão digital
 * do grupo (não sugere de novo o que foi descartado ou já virou atalho).
 */
export const quickReplySuggestions = pgTable(
  "quick_reply_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    key: text("key").notNull(),
    shortcut: text("shortcut").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Vezes que apareceu e em quantas conversas (na última busca) */
    count: integer("count").notNull(),
    conversations: integer("conversations").notNull(),
    /** ia | regras */
    source: text("source").notNull(),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    /** pendente | aceita | descartada */
    status: text("status").notNull().default("pendente"),
    decidedBy: uuid("decided_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quick_reply_suggestions_key").on(t.clinicId, t.key)],
);

/**
 * Auditoria de atendimento por amostragem. Guarda só notas, dica e um trecho da
 * fala da EQUIPE (sem nome do paciente). Uma avaliação por conversa por semana.
 */
export const serviceAudits = pgTable(
  "service_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Quem mais respondeu na conversa (a pessoa avaliada) */
    agentId: uuid("agent_id").references(() => clinicUsers.id, { onDelete: "cascade" }),
    /** Semana ISO: 2026-W42 */
    week: text("week").notNull(),
    tempo: real("tempo"),
    cordialidade: real("cordialidade").notNull(),
    clareza: real("clareza"),
    horario: real("horario"),
    total: real("total").notNull(),
    firstResponseMin: integer("first_response_min"),
    wantedSchedule: boolean("wanted_schedule").notNull().default(false),
    offeredSlot: boolean("offered_slot").notNull().default(false),
    strength: text("strength"),
    tip: text("tip"),
    quote: text("quote"),
    /** ia | regras */
    source: text("source").notNull(),
    confidence: integer("confidence"),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("service_audits_unique").on(t.clinicId, t.conversationId, t.week), index("service_audits_week_idx").on(t.clinicId, t.week)],
);

/**
 * "Agendar pelo pedido": o que a IA (ou o plano B) entendeu, os horários sugeridos
 * e se virou consulta. Mede o acerto: a recepção usou o horário sugerido?
 */
export const aiScheduleSuggestions = pgTable(
  "ai_schedule_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    /** ia | regras */
    source: text("source").notNull(),
    model: text("model"),
    fallbackReason: text("fallback_reason"),
    confidence: integer("confidence"),
    /** O pedido entendido (datas, período, horário, profissional, procedimento, trecho) */
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    /** Horários sugeridos (ISO), para saber se a recepção usou um deles */
    slots: jsonb("slots").$type<string[]>().notNull().default([]),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** Virou consulta? Com um horário sugerido? */
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    usedSuggestion: boolean("used_suggestion"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_schedule_conv_idx").on(t.clinicId, t.conversationId, t.createdAt), index("ai_schedule_user_idx").on(t.clinicId, t.requestedBy, t.createdAt)],
);

/** Canais da clínica: modo simulação hoje, real quando houver credenciais. */
export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    channel: channelEnum("channel").notNull(),
    mode: channelModeEnum("mode").notNull().default("simulacao"),
    active: boolean("active").notNull().default(true),
    /** Nome exibido: número do WhatsApp, @ do bot, nome da página */
    displayName: text("display_name"),
    /**
     * Identificador da conta no provedor (phone_number_id da Meta, id da página,
     * nome do bot). É por ele que o webhook descobre de qual clínica é a mensagem.
     * Os SEGREDOS (tokens) nunca ficam aqui: vão para variáveis de ambiente
     * ou cofre de segredos (AWS Secrets Manager).
     */
    externalAccountId: text("external_account_id"),
    /**
     * Como o canal se conecta (CONNECTION_KINDS): QR code, Cloud API via Evolution,
     * Cloud API direto, login do Instagram, página, bot. Vazio = ainda não escolhido.
     * Na Evolution, external_account_id é o NOME DA INSTÂNCIA (é por ele que o webhook acha a clínica).
     */
    kind: text("kind"),
    /** Estado da conexão com o provedor (CONNECTION_STATES) e desde quando */
    connectionState: text("connection_state").notNull().default("desconectado"),
    stateAt: timestamp("state_at", { withTimezone: true }),
    /** Último erro do provedor (para a tela mostrar o motivo) */
    lastError: text("last_error"),
    /**
     * Tokens DESTA clínica (página, Instagram, bot) criptografados com AES-256-GCM
     * (chave do servidor). Nunca voltam para a tela; sem eles, vale o token do ambiente.
     */
    credentialsEnc: text("credentials_enc"),
    /**
     * Ritmo de envio das mensagens AUTOMÁTICAS no WhatsApp do celular (PacingConfig de
     * @ecosaude/core/crm: sugestão escolhida ou números personalizados). Vazio = "cauteloso".
     */
    pacing: jsonb("pacing"),
    /**
     * Quando pode sair a próxima automática por este número. Reservado de forma atômica a cada
     * envio (agora + intervalo sorteado): dois despachos ao mesmo tempo nunca furam o intervalo.
     */
    paceNextAt: timestamp("pace_next_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("channel_connections_unique").on(t.clinicId, t.channel),
    uniqueIndex("channel_connections_account_unique")
      .on(t.channel, t.externalAccountId)
      .where(sql`${t.externalAccountId} is not null`),
  ],
);

/* -------------------------------- Relações --------------------------------- */

export const clinicUsersRelations = relations(clinicUsers, ({ one, many }) => ({
  clinic: one(clinics, { fields: [clinicUsers.clinicId], references: [clinics.id] }),
  sessions: many(clinicSessions),
}));

export const clinicSessionsRelations = relations(clinicSessions, ({ one }) => ({
  user: one(clinicUsers, { fields: [clinicSessions.userId], references: [clinicUsers.id] }),
}));

export const professionalsRelations = relations(professionals, ({ one, many }) => ({
  user: one(clinicUsers, { fields: [professionals.userId], references: [clinicUsers.id] }),
  appointments: many(appointments),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  owner: one(clinicUsers, { fields: [contacts.ownerId], references: [clinicUsers.id] }),
  identities: many(contactIdentities),
  conversations: many(conversations),
  appointments: many(appointments),
  events: many(crmEvents),
  tasks: many(tasks),
  waitlist: many(waitlistEntries),
}));

export const contactIdentitiesRelations = relations(contactIdentities, ({ one }) => ({
  contact: one(contacts, { fields: [contactIdentities.contactId], references: [contacts.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  contact: one(contacts, { fields: [conversations.contactId], references: [contacts.id] }),
  assignee: one(clinicUsers, { fields: [conversations.assigneeId], references: [clinicUsers.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  author: one(clinicUsers, { fields: [messages.authorId], references: [clinicUsers.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  contact: one(contacts, { fields: [appointments.contactId], references: [contacts.id] }),
  professional: one(professionals, { fields: [appointments.professionalId], references: [professionals.id] }),
  unit: one(clinicUnits, { fields: [appointments.unitId], references: [clinicUnits.id] }),
  room: one(clinicRooms, { fields: [appointments.roomId], references: [clinicRooms.id] }),
}));

export const clinicUnitsRelations = relations(clinicUnits, ({ many }) => ({ rooms: many(clinicRooms) }));
export const clinicRoomsRelations = relations(clinicRooms, ({ one }) => ({ unit: one(clinicUnits, { fields: [clinicRooms.unitId], references: [clinicUnits.id] }) }));

export const waitlistEntriesRelations = relations(waitlistEntries, ({ one }) => ({
  contact: one(contacts, { fields: [waitlistEntries.contactId], references: [contacts.id] }),
  professional: one(professionals, { fields: [waitlistEntries.professionalId], references: [professionals.id] }),
}));

export const slotOffersRelations = relations(slotOffers, ({ one, many }) => ({
  professional: one(professionals, { fields: [slotOffers.professionalId], references: [professionals.id] }),
  candidates: many(slotOfferCandidates),
  filledBy: one(contacts, { fields: [slotOffers.filledByContactId], references: [contacts.id] }),
}));

export const slotOfferCandidatesRelations = relations(slotOfferCandidates, ({ one }) => ({
  offer: one(slotOffers, { fields: [slotOfferCandidates.offerId], references: [slotOffers.id] }),
  contact: one(contacts, { fields: [slotOfferCandidates.contactId], references: [contacts.id] }),
  entry: one(waitlistEntries, { fields: [slotOfferCandidates.waitlistEntryId], references: [waitlistEntries.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  contact: one(contacts, { fields: [tasks.contactId], references: [contacts.id] }),
  assignee: one(clinicUsers, { fields: [tasks.assigneeId], references: [clinicUsers.id] }),
}));

export const crmEventsRelations = relations(crmEvents, ({ one }) => ({
  contact: one(contacts, { fields: [crmEvents.contactId], references: [contacts.id] }),
  actor: one(clinicUsers, { fields: [crmEvents.actorId], references: [clinicUsers.id] }),
}));

export const npsResponsesRelations = relations(npsResponses, ({ one }) => ({
  contact: one(contacts, { fields: [npsResponses.contactId], references: [contacts.id] }),
}));

/**
 * PEDIDOS DO TITULAR (LGPD, art. 18): exclusão e cópia dos dados.
 * O registro é a prova de que a clínica atendeu (prestação de contas). Por isso
 * NÃO guarda nome, telefone nem e-mail: só um hash (HMAC) do identificador, que
 * permite conferir depois "este número já pediu exclusão?" sem guardar o número.
 * Recusa: só por motivo de uma lista fechada (sem texto livre com dado pessoal).
 */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    /** LGPD-2026-00042 */
    protocol: text("protocol").notNull(),
    /** exclusao | acesso */
    kind: text("kind").notNull(),
    /** aberta | concluida | recusada */
    status: text("status").notNull().default("aberta"),
    /** Ficha do paciente (continua apontando para a ficha anonimizada) */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** HMAC do telefone/e-mail normalizado (nunca o dado em si) */
    subjectHash: text("subject_hash"),
    /** presencial | whatsapp | email | telefone | outro */
    channel: text("channel").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** Quem registrou e quem decidiu (equipe) */
    createdBy: uuid("created_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => clinicUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** A equipe conferiu que quem pediu é o titular (ou representante legal) */
    identityChecked: boolean("identity_checked").notNull().default(false),
    /** Motivo da recusa (lista fechada) */
    refusalReason: text("refusal_reason"),
    /** Quantos registros foram apagados ou anonimizados, por tipo */
    result: jsonb("result").$type<Record<string, number>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("privacy_requests_protocol").on(t.clinicId, t.protocol), index("privacy_requests_status_idx").on(t.clinicId, t.status, t.dueAt)],
);

/**
 * ANEXOS DAS CONVERSAS (foto, áudio, vídeo, PDF, documentos).
 * O arquivo fica no armazenamento PRIVADO (pasta local em desenvolvimento, S3 em produção);
 * aqui fica só a ficha dele. A chave do arquivo não tem nome do paciente nem do arquivo.
 *
 * status:
 *  - pendente: chegou pelo webhook, ainda não foi baixado do provedor
 *  - pronto:   guardado e conferido (tipo pelo conteúdo, tamanho, hash)
 *  - falhou:   não deu para baixar (link expirou, provedor fora) depois das tentativas
 *  - recusado: tipo não aceito ou grande demais (o arquivo NÃO é guardado)
 */
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    // Sem conversation_id de propósito: a unificação de cadastros move mensagens entre
    // conversas e apaga a antiga. O anexo segue a MENSAGEM.
    /** image | audio | video | document */
    kind: text("kind").notNull(),
    /** Tipo REAL (conferido pelo conteúdo) quando pronto; antes disso, o que o provedor disse */
    mime: text("mime"),
    /** Nome para mostrar e baixar (limpo, com a extensão real) */
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    /** Chave no armazenamento: clinics/<clínica>/anexos/<ano>/<mês>/<id> */
    storageKey: text("storage_key"),
    status: text("status").notNull().default("pendente"),
    /** Onde buscar no provedor (id da mídia, file_id, link temporário). Apagado quando pronto. */
    sourceRef: jsonb("source_ref").$type<Record<string, string> | null>(),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (t) => [index("message_attachments_message_idx").on(t.messageId), index("message_attachments_pending_idx").on(t.clinicId, t.status)],
);

/**
 * Fila de arquivos a remover do armazenamento. Um GATILHO do banco (migração 0027)
 * põe aqui a chave de todo anexo cuja ficha for apagada, por qualquer caminho
 * (exclusão LGPD, cascata, unificação). Assim nenhum arquivo fica órfão:
 * a remoção roda logo depois da ação e a rotina repete se o armazenamento falhar.
 */
export const storageDeletions = pgTable(
  "storage_deletions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    storageKey: text("storage_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("storage_deletions_idx").on(t.clinicId, t.createdAt)],
);

/* ------------------------------ Avisos (sino) ------------------------------- */

/** Tipos de aviso para a equipe. Cada um nasce de um evento já auditado em outro lugar. */
export const USER_NOTICE_KINDS = ["pep_emergencia", "triagem_urgente"] as const;
export type UserNoticeKind = (typeof USER_NOTICE_KINDS)[number];

/**
 * Avisos para UMA pessoa da equipe (o sino da barra superior).
 *
 * - Um registro por destinatário: cada um tem o próprio "lido".
 * - `refId` aponta o evento de origem (registro de acesso, triagem). O índice único
 *   (pessoa, tipo, origem) impede aviso repetido para o mesmo evento.
 * - LGPD: o texto pode citar o paciente (só quem já tem direito de ver aquele evento recebe);
 *   a anonimização apaga os avisos do paciente e a rotina apaga os com mais de 90 dias.
 *   O registro permanente fica na auditoria do prontuário (pep_audit), não aqui.
 */
export const userNotices = pgTable(
  "user_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: clinicId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    kind: text("kind").$type<UserNoticeKind>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Tela que resolve o aviso (caminho interno, ex.: /prontuario/ajustes) */
    href: text("href").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    refId: uuid("ref_id").notNull(),
    /** urgente = destaque vermelho no sino */
    urgent: boolean("urgent").notNull().default(false),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("user_notices_once").on(t.userId, t.kind, t.refId),
    index("user_notices_user_idx").on(t.clinicId, t.userId, t.createdAt),
    index("user_notices_ref_idx").on(t.clinicId, t.refId),
  ],
);
