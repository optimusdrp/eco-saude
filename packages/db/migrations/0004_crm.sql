CREATE TYPE "public"."appointment_status" AS ENUM('agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'telegram', 'instagram', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."channel_mode" AS ENUM('simulacao', 'real');--> statement-breakpoint
CREATE TYPE "public"."clinic_role" AS ENUM('gestor', 'recepcao', 'profissional');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('aberta', 'aguardando_paciente', 'resolvida');--> statement-breakpoint
CREATE TYPE "public"."journey_stage" AS ENUM('novo', 'em_conversa', 'agendado', 'paciente', 'reativar', 'perdido');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out', 'note', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('recebida', 'fila', 'enviada', 'entregue', 'lida', 'falhou');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('aberta', 'preenchida', 'expirada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."waitlist_period" AS ENUM('manha', 'tarde', 'qualquer');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('aguardando', 'oferecido', 'agendado', 'removido');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'agendado' NOT NULL,
	"service" text,
	"notes" text,
	"source" text DEFAULT 'recepcao' NOT NULL,
	"confirmation_requested_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"nps_requested_at" timestamp with time zone,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"mode" "channel_mode" DEFAULT 'simulacao' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"display_name" text,
	"external_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"two_factor_passed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "clinic_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_last_step" integer,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"birth_date" date,
	"stage" "journey_stage" DEFAULT 'novo' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lost_reason" text,
	"source" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"owner_id" uuid,
	"preferred_channel" "channel",
	"consent_marketing" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "conversation_status" DEFAULT 'aberta' NOT NULL,
	"assignee_id" uuid,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"last_inbound_at" timestamp with time zone,
	"awaiting_reply_since" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"intent" text,
	"urgent" boolean DEFAULT false NOT NULL,
	"urgent_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid,
	"actor_id" uuid,
	"type" text NOT NULL,
	"data" jsonb,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"direction" "message_direction" NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" NOT NULL,
	"author_id" uuid,
	"external_id" text,
	"client_id" uuid,
	"template_key" text,
	"meta" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nps_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"appointment_id" uuid,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professionals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"specialty" text,
	"color" text DEFAULT 'crm' NOT NULL,
	"user_id" uuid,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"work_start" text DEFAULT '08:00' NOT NULL,
	"work_end" text DEFAULT '18:00' NOT NULL,
	"break_start" text DEFAULT '12:00',
	"break_end" text DEFAULT '13:00',
	"work_days" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"shortcut" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"approved_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_protocols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"service_match" text,
	"days_after" integer NOT NULL,
	"message" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot_offer_candidates" (
	"offer_id" uuid NOT NULL,
	"waitlist_entry_id" uuid NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"outcome" text DEFAULT 'enviada' NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "slot_offer_candidates_offer_id_waitlist_entry_id_pk" PRIMARY KEY("offer_id","waitlist_entry_id")
);
--> statement-breakpoint
CREATE TABLE "slot_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "offer_status" DEFAULT 'aberta' NOT NULL,
	"origin_appointment_id" uuid,
	"filled_appointment_id" uuid,
	"filled_by_contact_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"due_date" date NOT NULL,
	"done_at" timestamp with time zone,
	"assignee_id" uuid,
	"kind" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"professional_id" uuid,
	"period" "waitlist_period" DEFAULT 'qualquer' NOT NULL,
	"notes" text,
	"status" "waitlist_status" DEFAULT 'aguardando' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_clinic_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_sessions" ADD CONSTRAINT "clinic_sessions_user_id_clinic_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."clinic_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_sessions" ADD CONSTRAINT "clinic_sessions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_users" ADD CONSTRAINT "clinic_users_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_clinic_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_clinic_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_events" ADD CONSTRAINT "crm_events_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_events" ADD CONSTRAINT "crm_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_events" ADD CONSTRAINT "crm_events_actor_id_clinic_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_clinic_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_user_id_clinic_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_protocols" ADD CONSTRAINT "return_protocols_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offer_candidates" ADD CONSTRAINT "slot_offer_candidates_offer_id_slot_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."slot_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offer_candidates" ADD CONSTRAINT "slot_offer_candidates_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offer_candidates" ADD CONSTRAINT "slot_offer_candidates_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offer_candidates" ADD CONSTRAINT "slot_offer_candidates_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offers" ADD CONSTRAINT "slot_offers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offers" ADD CONSTRAINT "slot_offers_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offers" ADD CONSTRAINT "slot_offers_origin_appointment_id_appointments_id_fk" FOREIGN KEY ("origin_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offers" ADD CONSTRAINT "slot_offers_filled_appointment_id_appointments_id_fk" FOREIGN KEY ("filled_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offers" ADD CONSTRAINT "slot_offers_filled_by_contact_id_contacts_id_fk" FOREIGN KEY ("filled_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_offers" ADD CONSTRAINT "slot_offers_created_by_clinic_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_clinic_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_clinic_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_clinic_start_idx" ON "appointments" USING btree ("clinic_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_contact_idx" ON "appointments" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_unique" ON "channel_connections" USING btree ("clinic_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_account_unique" ON "channel_connections" USING btree ("channel","external_account_id") WHERE "channel_connections"."external_account_id" is not null;--> statement-breakpoint
CREATE INDEX "clinic_sessions_user_idx" ON "clinic_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_users_email_unique" ON "clinic_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "clinic_users_clinic_idx" ON "clinic_users" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_unique" ON "contact_identities" USING btree ("clinic_id","channel","external_id");--> statement-breakpoint
CREATE INDEX "contacts_clinic_stage_idx" ON "contacts" USING btree ("clinic_id","stage");--> statement-breakpoint
CREATE INDEX "contacts_clinic_phone_idx" ON "contacts" USING btree ("clinic_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_contact_channel_unique" ON "conversations" USING btree ("clinic_id","contact_id","channel");--> statement-breakpoint
CREATE INDEX "conversations_inbox_idx" ON "conversations" USING btree ("clinic_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "crm_events_contact_idx" ON "crm_events" USING btree ("clinic_id","contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_events_client_unique" ON "crm_events" USING btree ("clinic_id","client_id") WHERE "crm_events"."client_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_unique" ON "messages" USING btree ("clinic_id","channel","external_id") WHERE "messages"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_unique" ON "messages" USING btree ("clinic_id","client_id") WHERE "messages"."client_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_queue_idx" ON "messages" USING btree ("status") WHERE "messages"."status" = 'fila';--> statement-breakpoint
CREATE INDEX "professionals_clinic_idx" ON "professionals" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quick_replies_shortcut_unique" ON "quick_replies" USING btree ("clinic_id","shortcut");--> statement-breakpoint
CREATE INDEX "tasks_clinic_due_idx" ON "tasks" USING btree ("clinic_id","due_date");--> statement-breakpoint
CREATE INDEX "waitlist_clinic_status_idx" ON "waitlist_entries" USING btree ("clinic_id","status");