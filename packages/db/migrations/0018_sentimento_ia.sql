CREATE TABLE "ai_sentiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"rules_sentiment" text,
	"ai_sentiment" text,
	"final_sentiment" text,
	"level" integer DEFAULT 0 NOT NULL,
	"confidence" integer,
	"source" text NOT NULL,
	"model" text,
	"latency_ms" integer,
	"fallback_reason" text,
	"alerted" boolean DEFAULT false NOT NULL,
	"corrected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_source" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_confidence" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_alerted_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_pending_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sentiment_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_sentiments" ADD CONSTRAINT "ai_sentiments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sentiments" ADD CONSTRAINT "ai_sentiments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sentiments" ADD CONSTRAINT "ai_sentiments_corrected_by_clinic_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_sentiments_idx" ON "ai_sentiments" USING btree ("clinic_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_sentiments" ADD CONSTRAINT "ai_sentiments_source_check" CHECK ("source" IN ('ia', 'regras', 'equipe'));
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_sentiments TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE ai_sentiments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_sentiments
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
