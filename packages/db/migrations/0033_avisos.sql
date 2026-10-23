CREATE TABLE "user_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"contact_id" uuid,
	"ref_id" uuid NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pep_settings" ADD COLUMN "emergency_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notices" ADD CONSTRAINT "user_notices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notices" ADD CONSTRAINT "user_notices_user_id_clinic_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."clinic_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notices" ADD CONSTRAINT "user_notices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_notices_once" ON "user_notices" USING btree ("user_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "user_notices_user_idx" ON "user_notices" USING btree ("clinic_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_notices_ref_idx" ON "user_notices" USING btree ("clinic_id","ref_id");--> statement-breakpoint
-- ============================ Avisos da equipe (sino) ============================

ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check CHECK (kind IN ('pep_emergencia','triagem_urgente'));
--> statement-breakpoint
ALTER TABLE user_notices ADD CONSTRAINT user_notices_href_check CHECK (href ~ '^/[A-Za-z0-9/_?=&.-]*$');
--> statement-breakpoint

-- Isolamento entre clínicas. O app cria, marca como lido e apaga (rotina de 90 dias e LGPD).
GRANT SELECT, INSERT, UPDATE, DELETE ON user_notices TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE user_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_notices USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint

-- Só "lido" e "e-mail enviado" mudam depois de criado: o texto do aviso não é reescrito
CREATE OR REPLACE FUNCTION user_notices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.kind <> OLD.kind OR NEW.title <> OLD.title OR NEW.body <> OLD.body
     OR NEW.href <> OLD.href OR NEW.ref_id <> OLD.ref_id OR NEW.created_at <> OLD.created_at
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    RAISE EXCEPTION 'Aviso não pode ser alterado (só marcado como lido)' USING ERRCODE = 'EC003';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_notices_guard BEFORE UPDATE ON user_notices FOR EACH ROW EXECUTE FUNCTION user_notices_guard();
