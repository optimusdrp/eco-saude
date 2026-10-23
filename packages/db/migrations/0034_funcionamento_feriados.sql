CREATE TABLE "clinic_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"unit_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text NOT NULL,
	"kind" text DEFAULT 'feriado' NOT NULL,
	"national" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_units" ADD COLUMN "opening_hours" jsonb;--> statement-breakpoint
ALTER TABLE "clinic_closures" ADD CONSTRAINT "clinic_closures_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_closures" ADD CONSTRAINT "clinic_closures_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_closures" ADD CONSTRAINT "clinic_closures_created_by_clinic_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_closures_dates_idx" ON "clinic_closures" USING btree ("clinic_id","ends_on","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_closures_national_unique" ON "clinic_closures" USING btree ("clinic_id","starts_on") WHERE "clinic_closures"."national";--> statement-breakpoint
-- ====================== Horário de funcionamento e feriados por unidade ======================

ALTER TABLE clinic_closures ADD CONSTRAINT clinic_closures_range_check CHECK (ends_on >= starts_on AND ends_on - starts_on <= 366);
--> statement-breakpoint
ALTER TABLE clinic_closures ADD CONSTRAINT clinic_closures_kind_check CHECK (kind IN ('feriado','recesso','outro'));
--> statement-breakpoint
ALTER TABLE clinic_closures ADD CONSTRAINT clinic_closures_reason_check CHECK (length(btrim(reason)) BETWEEN 2 AND 120);
--> statement-breakpoint
ALTER TABLE clinic_units ADD CONSTRAINT clinic_units_opening_hours_check CHECK (opening_hours IS NULL OR jsonb_typeof(opening_hours) = 'object');
--> statement-breakpoint

-- Fechamento de uma unidade: a unidade tem de ser da MESMA clínica (a FK sozinha não confere isso)
CREATE OR REPLACE FUNCTION clinic_closures_unit_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clinic_units u WHERE u.id = NEW.unit_id AND u.clinic_id = NEW.clinic_id) THEN
    RAISE EXCEPTION 'A unidade não é desta clínica' USING ERRCODE = 'EC002';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinic_closures_unit_check BEFORE INSERT OR UPDATE ON clinic_closures FOR EACH ROW EXECUTE FUNCTION clinic_closures_unit_check();
--> statement-breakpoint

-- Isolamento entre clínicas
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_closures TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE clinic_closures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinic_closures USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint

-- O horário que a clínica já tinha (na automação "Fora do horário") vira o horário da unidade principal
UPDATE clinic_units u
   SET opening_hours = (
     SELECT coalesce(jsonb_object_agg(d.value, jsonb_build_object('periods', jsonb_build_array(jsonb_build_object('start', s.automations->'fora_horario'->>'inicio', 'end', s.automations->'fora_horario'->>'fim')))), '{}'::jsonb)
       FROM jsonb_array_elements_text(s.automations->'fora_horario'->'dias') d)
  FROM crm_settings s
 WHERE s.clinic_id = u.clinic_id AND u.main AND u.opening_hours IS NULL
   AND jsonb_typeof(s.automations->'fora_horario'->'dias') = 'array'
   AND (s.automations->'fora_horario'->>'inicio') ~ '^\d{2}:\d{2}$'
   AND (s.automations->'fora_horario'->>'fim') ~ '^\d{2}:\d{2}$';
