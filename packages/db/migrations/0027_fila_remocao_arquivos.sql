CREATE TABLE "storage_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"storage_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "storage_deletions" ADD CONSTRAINT "storage_deletions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_deletions_idx" ON "storage_deletions" USING btree ("clinic_id","created_at");--> statement-breakpoint
ALTER TABLE "message_attachments" DROP COLUMN "conversation_id";--> statement-breakpoint
-- Isolamento entre clínicas
GRANT SELECT, INSERT, UPDATE, DELETE ON storage_deletions TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE storage_deletions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON storage_deletions USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
-- Toda ficha de anexo apagada (por qualquer caminho) agenda a remoção do arquivo
CREATE OR REPLACE FUNCTION ecosaude_queue_storage_deletion() RETURNS trigger AS $$
BEGIN
  IF OLD.storage_key IS NOT NULL THEN
    INSERT INTO storage_deletions (clinic_id, storage_key) VALUES (OLD.clinic_id, OLD.storage_key);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER message_attachments_queue_deletion AFTER DELETE ON message_attachments
  FOR EACH ROW EXECUTE FUNCTION ecosaude_queue_storage_deletion();
