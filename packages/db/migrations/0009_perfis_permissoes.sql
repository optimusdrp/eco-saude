CREATE TABLE "clinic_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid DEFAULT nullif(current_setting('app.clinic_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base" "clinic_role" NOT NULL,
	"system_key" "clinic_role",
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_users" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "clinic_users" ADD COLUMN "permission_grants" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_users" ADD COLUMN "permission_revokes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_roles" ADD CONSTRAINT "clinic_roles_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_roles_name_unique" ON "clinic_roles" USING btree ("clinic_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_roles_system_unique" ON "clinic_roles" USING btree ("clinic_id","system_key") WHERE "clinic_roles"."system_key" is not null;--> statement-breakpoint
ALTER TABLE "clinic_users" ADD CONSTRAINT "clinic_users_role_id_clinic_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."clinic_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Isolamento entre clínicas (mesmo modelo da migração 0005)
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_roles TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE clinic_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinic_roles
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
-- O perfil de uma pessoa tem de ser da MESMA clínica (o banco garante, não só a tela)
CREATE FUNCTION clinic_users_role_same_clinic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clinic_roles r WHERE r.id = NEW.role_id AND r.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'perfil de outra clínica' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinic_users_role_same_clinic BEFORE INSERT OR UPDATE OF role_id, clinic_id ON clinic_users
  FOR EACH ROW EXECUTE FUNCTION clinic_users_role_same_clinic();
--> statement-breakpoint
-- Perfis do sistema para as clínicas que já existem (mesmas permissões de DEFAULT_ROLE_PERMISSIONS)
INSERT INTO clinic_roles (clinic_id, name, description, base, system_key, permissions)
SELECT c.id, v.name, v.description, v.key::clinic_role, v.key::clinic_role, v.perms
  FROM clinics c
 CROSS JOIN (VALUES
   ('gestor', 'Gestão', 'Tudo, inclusive equipe, permissões e canais.',
    ARRAY['conversas.ver','conversas.responder','conversas.iniciar','conversas.massa','agenda.ver','agenda.editar','agenda.cancelar','agenda.confirmacoes','espera.gerir','pacientes.ver','pacientes.editar','contatos.massa','contatos.mesclar','contatos.exportar','jornada.ver','jornada.editar','jornada.responsavel','tarefas.ver','tarefas.gerir','retornos.gerir','retornos.protocolos','config.clinica','config.automacoes','config.mensagens','config.respostas','config.canais','config.equipe','config.permissoes','config.seguranca','config.plano']),
   ('recepcao', 'Recepção', 'Atendimento do dia a dia: conversas, agenda, contatos e tarefas.',
    ARRAY['conversas.ver','conversas.responder','conversas.iniciar','conversas.massa','agenda.ver','agenda.editar','agenda.cancelar','agenda.confirmacoes','espera.gerir','pacientes.ver','pacientes.editar','contatos.massa','contatos.mesclar','jornada.ver','jornada.editar','jornada.responsavel','tarefas.ver','tarefas.gerir','retornos.gerir','retornos.protocolos','config.respostas']),
   ('profissional', 'Profissional de saúde', 'Vê conversas e fichas; mexe na própria rotina da agenda.',
    ARRAY['conversas.ver','agenda.ver','agenda.editar','pacientes.ver','jornada.ver','tarefas.ver'])
 ) AS v(key, name, description, perms)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE clinic_users u SET role_id = r.id
  FROM clinic_roles r
 WHERE r.clinic_id = u.clinic_id AND r.system_key = u.role AND u.role_id IS NULL;
