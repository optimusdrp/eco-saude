ALTER TABLE "professionals" ADD COLUMN "first_template_id" uuid;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "return_template_id" uuid;--> statement-breakpoint
ALTER TABLE "pep_settings" ADD COLUMN "areas" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "pep_templates" ADD COLUMN "specialty_key" text;--> statement-breakpoint
ALTER TABLE "pep_templates" ADD COLUMN "kind" text;--> statement-breakpoint
-- ================= Prontuário por especialidade (formulários e áreas da clínica) =================
-- Colunas novas em tabelas que já têm RLS (tenant_isolation) e GRANT para ecosaude_tenant:
-- as regras valem também para elas. Nada de tabela nova.
--
-- pep_settings.areas: áreas em que a clínica atende (vazio = o Tropi deduz pelos profissionais).
-- pep_templates.specialty_key / kind: ligam o modelo a uma especialidade do catálogo e dizem se é
--   primeira consulta, retorno ou outro. O atendimento usa isso para abrir o formulário certo.
-- professionals.first_template_id / return_template_id: escolha da gestão para cada profissional.
ALTER TABLE "pep_templates" ADD CONSTRAINT "pep_templates_kind_check" CHECK ("kind" is null or "kind" in ('primeira', 'retorno', 'outro'));--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_first_template_fk" FOREIGN KEY ("first_template_id") REFERENCES "pep_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_return_template_fk" FOREIGN KEY ("return_template_id") REFERENCES "pep_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
-- O modelo escolhido precisa ser da MESMA clínica do profissional (o RLS já esconde os de outra
-- clínica na tela; esta trava garante no banco, mesmo para um erro de programação).
CREATE OR REPLACE FUNCTION professionals_template_same_clinic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.first_template_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pep_templates t WHERE t.id = NEW.first_template_id AND t.clinic_id = NEW.clinic_id) THEN
    RAISE EXCEPTION 'Modelo de outra clínica' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.return_template_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pep_templates t WHERE t.id = NEW.return_template_id AND t.clinic_id = NEW.clinic_id) THEN
    RAISE EXCEPTION 'Modelo de outra clínica' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER professionals_template_same_clinic BEFORE INSERT OR UPDATE OF first_template_id, return_template_id ON "professionals" FOR EACH ROW EXECUTE FUNCTION professionals_template_same_clinic();--> statement-breakpoint
-- Modelos prontos que as clínicas já têm (clínica médica geral): passam a ser reconhecidos
UPDATE "pep_templates" SET "specialty_key" = 'clinica_geral', "kind" = CASE "system_key" WHEN 'clinica_geral_primeira' THEN 'primeira' ELSE 'retorno' END
  WHERE "system_key" IN ('clinica_geral_primeira', 'clinica_geral_retorno');
