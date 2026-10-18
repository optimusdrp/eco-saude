CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"kind" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"message_id" uuid,
	"status" text DEFAULT 'pendente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"source" text,
	"model" text,
	"fallback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"evidence" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_reviews" (
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_a" uuid NOT NULL,
	"contact_b" uuid NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"confidence" integer,
	"model" text,
	"fallback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_reviews_clinic_id_contact_a_contact_b_pk" PRIMARY KEY("clinic_id","contact_a","contact_b")
);
--> statement-breakpoint
CREATE TABLE "loss_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"category" text NOT NULL,
	"quote" text,
	"source" text NOT NULL,
	"confidence" integer,
	"lost_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "insurance" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "referred_by" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "send_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suggestions" ADD CONSTRAINT "contact_suggestions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suggestions" ADD CONSTRAINT "contact_suggestions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suggestions" ADD CONSTRAINT "contact_suggestions_decided_by_clinic_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_contact_a_contacts_id_fk" FOREIGN KEY ("contact_a") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_contact_b_contacts_id_fk" FOREIGN KEY ("contact_b") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_jobs_pending_idx" ON "ai_jobs" USING btree ("clinic_id","status","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suggestions_unique" ON "contact_suggestions" USING btree ("clinic_id","contact_id","kind","field","value");--> statement-breakpoint
CREATE INDEX "loss_reasons_idx" ON "loss_reasons" USING btree ("clinic_id","lost_at");--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_checks" CHECK ("kind" IN ('cadastro', 'etiquetas', 'perda', 'retorno') AND "status" IN ('pendente', 'feita'));
--> statement-breakpoint
ALTER TABLE "contact_suggestions" ADD CONSTRAINT "contact_suggestions_checks" CHECK ("kind" IN ('campo', 'etiqueta') AND "status" IN ('pendente', 'aplicada', 'descartada') AND "source" IN ('ia', 'regras'));
--> statement-breakpoint
-- A fila de envio ignora mensagens agendadas para depois (índice parcial cobre o filtro)
CREATE INDEX IF NOT EXISTS "messages_send_after_idx" ON "messages" ("send_after") WHERE "status" = 'fila';
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_jobs, loss_reasons, contact_suggestions, duplicate_reviews TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE loss_reasons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contact_suggestions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE duplicate_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_jobs USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON loss_reasons USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contact_suggestions USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON duplicate_reviews USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
