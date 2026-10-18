-- Preferências do CRM por clínica (confirmação automática) + regras de integridade.
CREATE TABLE "crm_settings" (
	"clinic_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"auto_confirm" boolean DEFAULT true NOT NULL,
	"confirm_hour" integer DEFAULT 10 NOT NULL,
	"confirm_days_before" integer DEFAULT 1 NOT NULL,
	"last_auto_confirm_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Limites aceitos (a tela valida, o banco garante)
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_confirm_hour_check" CHECK ("confirm_hour" BETWEEN 0 AND 23);
--> statement-breakpoint
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_confirm_days_check" CHECK ("confirm_days_before" BETWEEN 1 AND 3);
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_settings TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_settings
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
-- Profissionais: horários coerentes
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_slot_check" CHECK ("slot_minutes" BETWEEN 5 AND 240);
