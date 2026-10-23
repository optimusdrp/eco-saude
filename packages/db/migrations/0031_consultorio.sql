CREATE TABLE "pep_triages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"appointment_id" uuid,
	"complaint" text,
	"vitals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"notes" text,
	"recorded_by" uuid,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_users" ADD COLUMN "health_council" text;--> statement-breakpoint
ALTER TABLE "clinic_users" ADD COLUMN "health_council_number" text;--> statement-breakpoint
ALTER TABLE "clinic_users" ADD COLUMN "health_council_uf" text;--> statement-breakpoint
ALTER TABLE "pep_triages" ADD CONSTRAINT "pep_triages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pep_triages" ADD CONSTRAINT "pep_triages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pep_triages" ADD CONSTRAINT "pep_triages_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pep_triages" ADD CONSTRAINT "pep_triages_recorded_by_clinic_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pep_triages_appointment_unique" ON "pep_triages" USING btree ("appointment_id") WHERE "pep_triages"."appointment_id" is not null;--> statement-breakpoint
CREATE INDEX "pep_triages_contact_idx" ON "pep_triages" USING btree ("clinic_id","contact_id","created_at");--> statement-breakpoint
-- ====================== Consultório, triagem e perfil de profissional de saúde ======================

-- Registro no conselho do acesso: sigla em maiúsculas (CRM, COREN...), número e UF
ALTER TABLE clinic_users ADD CONSTRAINT clinic_users_health_council_check
  CHECK ((health_council IS NULL AND health_council_number IS NULL)
      OR (health_council ~ '^[A-Z]{2,8}$' AND health_council_number ~ '^[0-9A-Za-z.-]{1,20}$'));
--> statement-breakpoint
ALTER TABLE clinic_users ADD CONSTRAINT clinic_users_health_council_uf_check CHECK (health_council_uf IS NULL OR health_council_uf ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE pep_triages ADD CONSTRAINT pep_triages_priority_check CHECK (priority IN ('normal','prioritario','urgente'));
--> statement-breakpoint

-- Auditoria: nova ação "triagem"
ALTER TABLE pep_audit DROP CONSTRAINT pep_audit_action_check;
--> statement-breakpoint
ALTER TABLE pep_audit ADD CONSTRAINT pep_audit_action_check CHECK (action IN ('abrir','emergencia','finalizar','adendo','emitir','imprimir','cancelar_documento','exportar','triagem'));
--> statement-breakpoint

-- Triagem: isolamento entre clínicas; o app inclui e corrige, nunca apaga (é registro clínico)
GRANT SELECT, INSERT, UPDATE ON pep_triages TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE pep_triages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON pep_triages USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint

-- Perfis do sistema já gravados recebem as permissões novas (os padrões do código valem para quem não tem)
UPDATE clinic_roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['prontuario.consultorio'])) WHERE system_key = 'gestor';
--> statement-breakpoint
UPDATE clinic_roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['prontuario.consultorio','prontuario.resumo','prontuario.triagem','prontuario.documentos'])) WHERE system_key = 'profissional';
