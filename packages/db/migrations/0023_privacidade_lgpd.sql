CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"protocol" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'aberta' NOT NULL,
	"contact_id" uuid,
	"subject_hash" text,
	"channel" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"identity_checked" boolean DEFAULT false NOT NULL,
	"refusal_reason" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_created_by_clinic_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_decided_by_clinic_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_protocol" ON "privacy_requests" USING btree ("clinic_id","protocol");--> statement-breakpoint
CREATE INDEX "privacy_requests_status_idx" ON "privacy_requests" USING btree ("clinic_id","status","due_at");--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_checks" CHECK (
  "kind" IN ('exclusao', 'acesso')
  AND "status" IN ('aberta', 'concluida', 'recusada')
  AND "channel" IN ('presencial', 'whatsapp', 'email', 'telefone', 'outro')
  AND ("refusal_reason" IS NULL OR "refusal_reason" IN ('identidade', 'obrigacao_legal', 'nao_titular', 'duplicado'))
  AND ("status" <> 'recusada' OR "refusal_reason" IS NOT NULL)
);
--> statement-breakpoint
-- Nova permissão "pacientes.anonimizar" (excluir dados a pedido do titular): só a Gestão
UPDATE clinic_roles
   SET permissions = array_append(permissions, 'pacientes.anonimizar')
 WHERE system_key = 'gestor'
   AND NOT ('pacientes.anonimizar' = ANY (permissions));
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_requests TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON privacy_requests USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
