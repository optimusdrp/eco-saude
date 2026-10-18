CREATE TABLE "day_briefs" (
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"date" date NOT NULL,
	"facts_hash" text NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"fallback_reason" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_briefs_clinic_id_date_pk" PRIMARY KEY("clinic_id","date")
);
--> statement-breakpoint
CREATE TABLE "learned_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"model" jsonb,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trained_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_durations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"service_key" text NOT NULL,
	"service_label" text NOT NULL,
	"minutes" integer NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_days" (
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"date" date NOT NULL,
	"rain_mm" real,
	"rain_prob" integer,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_days_clinic_id_date_pk" PRIMARY KEY("clinic_id","date")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD COLUMN "geo" jsonb;--> statement-breakpoint
ALTER TABLE "slot_offer_candidates" ADD COLUMN "features" jsonb;--> statement-breakpoint
ALTER TABLE "slot_offer_candidates" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "day_briefs" ADD CONSTRAINT "day_briefs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learned_models" ADD CONSTRAINT "learned_models_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_durations" ADD CONSTRAINT "service_durations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_durations" ADD CONSTRAINT "service_durations_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_durations" ADD CONSTRAINT "service_durations_updated_by_clinic_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."clinic_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_days" ADD CONSTRAINT "weather_days_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learned_models_idx" ON "learned_models" USING btree ("clinic_id","kind","trained_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_durations_unique" ON "service_durations" USING btree ("clinic_id","professional_id","service_key");--> statement-breakpoint
ALTER TABLE "learned_models" ADD CONSTRAINT "learned_models_kind_check" CHECK ("kind" IN ('risco', 'encaixe'));
--> statement-breakpoint
ALTER TABLE "day_briefs" ADD CONSTRAINT "day_briefs_source_check" CHECK ("source" IN ('ia', 'regras'));
--> statement-breakpoint
-- Chegada de quem já está como "compareceu" antes desta versão: usa o horário marcado (sem inventar saída)
UPDATE appointments SET arrived_at = starts_at WHERE status = 'compareceu' AND arrived_at IS NULL;
--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON learned_models, weather_days, service_durations, day_briefs TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE learned_models ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE weather_days ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_durations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE day_briefs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON learned_models USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON weather_days USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON service_durations USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON day_briefs USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
