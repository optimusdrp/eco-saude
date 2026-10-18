CREATE TABLE "auth_throttle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"requested_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_clinic_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."clinic_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_throttle_idx" ON "auth_throttle" USING btree ("bucket","key_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_unique" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id","created_at");--> statement-breakpoint
-- Só a autenticação (conexão dona) usa estas tabelas: o papel da clínica não enxerga nada.
-- RLS ligado sem política = nenhum acesso para quem não é o dono, mesmo que alguém conceda GRANT por engano.
REVOKE ALL ON password_resets, auth_throttle FROM ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_throttle ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No máximo UM link válido por pessoa (pedir de novo revoga o anterior; a corrida entre dois pedidos para aqui)
CREATE UNIQUE INDEX password_resets_one_open ON password_resets (user_id) WHERE used_at IS NULL AND revoked_at IS NULL;
