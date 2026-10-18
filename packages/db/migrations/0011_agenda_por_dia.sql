CREATE TABLE "professional_absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "weekly_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "professional_absences" ADD CONSTRAINT "professional_absences_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_absences" ADD CONSTRAINT "professional_absences_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_absences" ADD CONSTRAINT "professional_absences_created_by_clinic_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professional_absences_pro_idx" ON "professional_absences" USING btree ("clinic_id","professional_id","ends_on");--> statement-breakpoint
ALTER TABLE "professional_absences" ADD CONSTRAINT "professional_absences_dates_check" CHECK ("ends_on" >= "starts_on");
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON professional_absences TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE professional_absences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON professional_absences
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
-- Semana dos profissionais que já existem, a partir do expediente único:
-- cada dia de atendimento ganha 1 período (sem intervalo) ou 2 (antes e depois do intervalo)
UPDATE professionals p
   SET weekly_schedule = (
     SELECT jsonb_object_agg(
              d::text,
              jsonb_build_object('periods',
                CASE WHEN p.break_start IS NOT NULL AND p.break_end IS NOT NULL THEN
                  jsonb_build_array(
                    jsonb_build_object('start', p.work_start, 'end', p.break_start),
                    jsonb_build_object('start', p.break_end, 'end', p.work_end))
                ELSE
                  jsonb_build_array(jsonb_build_object('start', p.work_start, 'end', p.work_end))
                END))
       FROM unnest(p.work_days) AS d)
 WHERE p.weekly_schedule IS NULL AND cardinality(p.work_days) > 0;
