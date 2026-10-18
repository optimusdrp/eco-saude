CREATE TABLE "ai_promises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"author_id" uuid,
	"side" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"source" text,
	"confidence" integer,
	"model" text,
	"latency_ms" integer,
	"fallback_reason" text,
	"found" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"undone" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_promises" ADD CONSTRAINT "ai_promises_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_promises" ADD CONSTRAINT "ai_promises_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_promises" ADD CONSTRAINT "ai_promises_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_promises" ADD CONSTRAINT "ai_promises_author_id_clinic_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_promises_pending_idx" ON "ai_promises" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "ai_promises_conv_idx" ON "ai_promises" USING btree ("clinic_id","conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_promises" ADD CONSTRAINT "ai_promises_checks" CHECK ("side" IN ('clinica', 'paciente') AND "status" IN ('pendente', 'feita') AND ("source" IS NULL OR "source" IN ('ia', 'regras')));
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_promises TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE ai_promises ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_promises
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
