CREATE TABLE "ai_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"last_message_id" uuid,
	"messages_read" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"source" text NOT NULL,
	"model" text,
	"fallback_reason" text,
	"headline" text NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_step" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"helpful" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_requested_by_clinic_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_summaries_conv_idx" ON "ai_summaries" USING btree ("clinic_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_summaries_user_idx" ON "ai_summaries" USING btree ("clinic_id","requested_by","created_at");--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_source_check" CHECK ("source" IN ('ia', 'regras'));
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_summaries TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE ai_summaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_summaries
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
