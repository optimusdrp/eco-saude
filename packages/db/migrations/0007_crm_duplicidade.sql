-- Duplicidade de cadastros: pares marcados como "não é a mesma pessoa" (com isolamento por clínica).
CREATE TABLE "contact_duplicate_dismissals" (
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"contact_a" uuid NOT NULL,
	"contact_b" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_duplicate_dismissals_contact_a_contact_b_pk" PRIMARY KEY("contact_a","contact_b")
);
--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_contact_a_contacts_id_fk" FOREIGN KEY ("contact_a") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_contact_b_contacts_id_fk" FOREIGN KEY ("contact_b") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_created_by_clinic_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_duplicate_dismissals" ADD CONSTRAINT "contact_duplicate_dismissals_order_check" CHECK ("contact_a" < "contact_b");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_duplicate_dismissals TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE contact_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contact_duplicate_dismissals
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
