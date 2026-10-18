CREATE TABLE "ai_schedule_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"requested_by" uuid,
	"source" text NOT NULL,
	"model" text,
	"fallback_reason" text,
	"confidence" integer,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"appointment_id" uuid,
	"used_suggestion" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_schedule_suggestions" ADD CONSTRAINT "ai_schedule_suggestions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_schedule_suggestions" ADD CONSTRAINT "ai_schedule_suggestions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_schedule_suggestions" ADD CONSTRAINT "ai_schedule_suggestions_requested_by_clinic_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_schedule_suggestions" ADD CONSTRAINT "ai_schedule_suggestions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_schedule_conv_idx" ON "ai_schedule_suggestions" USING btree ("clinic_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_schedule_user_idx" ON "ai_schedule_suggestions" USING btree ("clinic_id","requested_by","created_at");--> statement-breakpoint
ALTER TABLE "ai_schedule_suggestions" ADD CONSTRAINT "ai_schedule_suggestions_source_check" CHECK ("source" IN ('ia', 'regras'));
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_schedule_suggestions TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE ai_schedule_suggestions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_schedule_suggestions
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
