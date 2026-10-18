CREATE TABLE "ai_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"rules_intent" text,
	"ai_intent" text,
	"final_intent" text,
	"confidence" integer,
	"source" text NOT NULL,
	"model" text,
	"latency_ms" integer,
	"fallback_reason" text,
	"corrected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "intent_source" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "intent_confidence" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "intent_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "intent_pending_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "intent_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_classifications" ADD CONSTRAINT "ai_classifications_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_classifications" ADD CONSTRAINT "ai_classifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_classifications" ADD CONSTRAINT "ai_classifications_corrected_by_clinic_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_classifications_idx" ON "ai_classifications" USING btree ("clinic_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_classifications" ADD CONSTRAINT "ai_classifications_source_check" CHECK ("source" IN ('ia', 'regras', 'equipe'));
--> statement-breakpoint
-- Fila da IA: só conversas com mensagem esperando classificação
CREATE INDEX "conversations_intent_pending_idx" ON "conversations" ("clinic_id") WHERE "intent_pending_message_id" IS NOT NULL;
--> statement-breakpoint
-- Intenções que já existem vieram das palavras-chave
UPDATE "conversations" SET "intent_source" = 'regras' WHERE "intent" IS NOT NULL AND "intent_source" IS NULL;
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_classifications TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE ai_classifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_classifications
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
