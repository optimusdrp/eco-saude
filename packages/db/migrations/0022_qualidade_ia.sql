CREATE TABLE "ai_rule_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"actor_id" uuid,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"fallback_reason" text,
	"latency_ms" integer,
	"rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_reply_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"key" text NOT NULL,
	"shortcut" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"count" integer NOT NULL,
	"conversations" integer NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"fallback_reason" text,
	"status" text DEFAULT 'pendente' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" uuid,
	"week" text NOT NULL,
	"tempo" real,
	"cordialidade" real NOT NULL,
	"clareza" real,
	"horario" real,
	"total" real NOT NULL,
	"first_response_min" integer,
	"wanted_schedule" boolean DEFAULT false NOT NULL,
	"offered_slot" boolean DEFAULT false NOT NULL,
	"strength" text,
	"tip" text,
	"quote" text,
	"source" text NOT NULL,
	"confidence" integer,
	"model" text,
	"fallback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_rule_drafts" ADD CONSTRAINT "ai_rule_drafts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_rule_drafts" ADD CONSTRAINT "ai_rule_drafts_actor_id_clinic_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_rule_drafts" ADD CONSTRAINT "ai_rule_drafts_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_reply_suggestions" ADD CONSTRAINT "quick_reply_suggestions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_reply_suggestions" ADD CONSTRAINT "quick_reply_suggestions_decided_by_clinic_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audits" ADD CONSTRAINT "service_audits_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audits" ADD CONSTRAINT "service_audits_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audits" ADD CONSTRAINT "service_audits_agent_id_clinic_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."clinic_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_rule_drafts_idx" ON "ai_rule_drafts" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quick_reply_suggestions_key" ON "quick_reply_suggestions" USING btree ("clinic_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "service_audits_unique" ON "service_audits" USING btree ("clinic_id","conversation_id","week");--> statement-breakpoint
CREATE INDEX "service_audits_week_idx" ON "service_audits" USING btree ("clinic_id","week");--> statement-breakpoint
ALTER TABLE "ai_rule_drafts" ADD CONSTRAINT "ai_rule_drafts_checks" CHECK ("source" IN ('ia', 'regras'));
--> statement-breakpoint
ALTER TABLE "quick_reply_suggestions" ADD CONSTRAINT "quick_reply_suggestions_checks" CHECK ("source" IN ('ia', 'regras') AND "status" IN ('pendente', 'aceita', 'descartada'));
--> statement-breakpoint
ALTER TABLE "service_audits" ADD CONSTRAINT "service_audits_checks" CHECK ("source" IN ('ia', 'regras') AND "total" BETWEEN 0 AND 10 AND "cordialidade" BETWEEN 0 AND 10);
--> statement-breakpoint
-- Nova permissão "qualidade.ver" (auditoria de atendimento): vem ligada só para a Gestão
UPDATE clinic_roles
   SET permissions = array_append(permissions, 'qualidade.ver')
 WHERE system_key = 'gestor'
   AND NOT ('qualidade.ver' = ANY (permissions));
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_rule_drafts, quick_reply_suggestions, service_audits TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE ai_rule_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quick_reply_suggestions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_audits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_rule_drafts USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quick_reply_suggestions USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON service_audits USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
