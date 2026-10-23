CREATE TABLE "clinic_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'consultorio' NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"main" boolean DEFAULT false NOT NULL,
	"address" text,
	"district" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"cnes" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "clinic_users" ADD COLUMN "unit_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "pep_encounters" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "clinic_rooms" ADD CONSTRAINT "clinic_rooms_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_rooms" ADD CONSTRAINT "clinic_rooms_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_units" ADD CONSTRAINT "clinic_units_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_rooms_name_unique" ON "clinic_rooms" USING btree ("unit_id",lower("name"));--> statement-breakpoint
CREATE INDEX "clinic_rooms_unit_idx" ON "clinic_rooms" USING btree ("clinic_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_units_name_unique" ON "clinic_units" USING btree ("clinic_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_units_main_unique" ON "clinic_units" USING btree ("clinic_id") WHERE "clinic_units"."main";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_id_clinic_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."clinic_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pep_encounters" ADD CONSTRAINT "pep_encounters_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_unit_start_idx" ON "appointments" USING btree ("clinic_id","unit_id","starts_at");--> statement-breakpoint
-- ========================== Unidades de atendimento e consultórios ==========================

-- Valores possíveis
ALTER TABLE clinic_rooms ADD CONSTRAINT clinic_rooms_kind_check CHECK (kind IN ('consultorio','procedimento','exame','triagem','outro'));
--> statement-breakpoint
ALTER TABLE clinic_units ADD CONSTRAINT clinic_units_state_check CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE clinic_units ADD CONSTRAINT clinic_units_zip_check CHECK (zip IS NULL OR zip ~ '^[0-9]{8}$');
--> statement-breakpoint
ALTER TABLE clinic_units ADD CONSTRAINT clinic_units_cnes_check CHECK (cnes IS NULL OR cnes ~ '^[0-9]{7}$');
--> statement-breakpoint
-- A unidade principal não pode ser desativada (sempre há onde atender)
ALTER TABLE clinic_units ADD CONSTRAINT clinic_units_main_active_check CHECK (NOT main OR active);
--> statement-breakpoint

-- Isolamento entre clínicas. Unidades e consultórios não são apagados pelo app (só desativados):
-- consultas e atendimentos antigos continuam apontando para eles.
GRANT SELECT, INSERT, UPDATE ON clinic_units, clinic_rooms TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE clinic_units ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinic_rooms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinic_units USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinic_rooms USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint

-- Toda clínica tem uma unidade principal: as que já existem ganham agora; as novas, ao serem criadas
INSERT INTO clinic_units (clinic_id, name, main, city, state, phone)
SELECT c.id, 'Unidade principal', true, c.city, CASE WHEN c.state ~ '^[A-Z]{2}$' THEN c.state END, c.phone
  FROM clinics c
 WHERE NOT EXISTS (SELECT 1 FROM clinic_units u WHERE u.clinic_id = c.id AND u.main);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION clinic_create_main_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO clinic_units (clinic_id, name, main, city, state, phone)
  VALUES (NEW.id, 'Unidade principal', true, NEW.city, CASE WHEN NEW.state ~ '^[A-Z]{2}$' THEN NEW.state END, NEW.phone);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinics_main_unit AFTER INSERT ON clinics FOR EACH ROW EXECUTE FUNCTION clinic_create_main_unit();
--> statement-breakpoint

-- Consultas e atendimentos que já existem ficam na unidade principal
UPDATE appointments a SET unit_id = u.id FROM clinic_units u WHERE u.clinic_id = a.clinic_id AND u.main AND a.unit_id IS NULL;
--> statement-breakpoint
UPDATE pep_encounters e SET unit_id = coalesce((SELECT a.unit_id FROM appointments a WHERE a.id = e.appointment_id), (SELECT u.id FROM clinic_units u WHERE u.clinic_id = e.clinic_id AND u.main)) WHERE e.unit_id IS NULL;
--> statement-breakpoint

-- Consulta sempre tem unidade; consultório (quando houver) é da mesma unidade; tudo da mesma clínica.
-- Sem unidade informada (ex.: integração antiga), fica na principal.
CREATE OR REPLACE FUNCTION appointments_place_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u_clinic uuid; r_unit uuid;
BEGIN
  IF NEW.unit_id IS NULL THEN
    SELECT id INTO NEW.unit_id FROM clinic_units WHERE clinic_id = NEW.clinic_id AND main;
  END IF;
  SELECT clinic_id INTO u_clinic FROM clinic_units WHERE id = NEW.unit_id;
  IF u_clinic IS DISTINCT FROM NEW.clinic_id THEN
    RAISE EXCEPTION 'Unidade inválida para esta clínica' USING ERRCODE = 'EC002';
  END IF;
  IF NEW.room_id IS NOT NULL THEN
    SELECT unit_id INTO r_unit FROM clinic_rooms WHERE id = NEW.room_id;
    IF r_unit IS DISTINCT FROM NEW.unit_id THEN
      RAISE EXCEPTION 'O consultório não é desta unidade' USING ERRCODE = 'EC002';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER appointments_place BEFORE INSERT OR UPDATE OF unit_id, room_id, clinic_id ON appointments FOR EACH ROW EXECUTE FUNCTION appointments_place_check();
--> statement-breakpoint
ALTER TABLE appointments ALTER COLUMN unit_id SET NOT NULL;
--> statement-breakpoint

-- CONSULTÓRIO SEM CONFLITO, garantido pelo banco (como já é para o profissional, migração 0005):
-- duas consultas no mesmo consultório ao mesmo tempo são recusadas (canceladas liberam).
ALTER TABLE appointments ADD CONSTRAINT appointments_room_no_overlap
  EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'cancelado' AND room_id IS NOT NULL);
