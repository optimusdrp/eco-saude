-- Migração escrita à mão (drizzle-kit generate --custom).
--
-- ISOLAMENTO ENTRE CLÍNICAS NO PRÓPRIO BANCO (Row-Level Security)
--
-- O app da clínica executa cada operação com o papel "ecosaude_tenant"
-- e com a variável app.clinic_id = clínica da sessão (ver withTenant()).
-- As políticas abaixo fazem o PostgreSQL devolver e aceitar SÓ as linhas
-- daquela clínica, mesmo que uma consulta do código esqueça o filtro.
--
-- O dono das tabelas (usado por migrações, seed e backoffice) não é afetado.
-- IMPORTANTE: toda tabela NOVA do CRM precisa entrar aqui (GRANT + POLICY).

-- 1) Papel sem login, usado via SET LOCAL ROLE
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecosaude_tenant') THEN
    CREATE ROLE ecosaude_tenant NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- O usuário que conecta precisa poder assumir o papel (SET ROLE)
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'ecosaude_tenant', 'MEMBER') THEN
    EXECUTE format('GRANT ecosaude_tenant TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  -- Acontece quando o papel foi criado por OUTRO usuário (PostgreSQL 16+ exige ADMIN OPTION)
  RAISE EXCEPTION 'O papel ecosaude_tenant já existe e "%" não pode assumi-lo. Peça ao administrador do banco: GRANT ecosaude_tenant TO "%" WITH ADMIN OPTION;', current_user, current_user;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ecosaude_tenant;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_users, professionals, contacts, contact_identities, conversations, messages, appointments, waitlist_entries, slot_offers, slot_offer_candidates, tasks, quick_replies, return_protocols, nps_responses, crm_events, channel_connections TO ecosaude_tenant;
--> statement-breakpoint
-- Dados da própria clínica (nome etc.): só leitura
GRANT SELECT ON clinics TO ecosaude_tenant;
--> statement-breakpoint
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinics
  USING (id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE clinic_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinic_users
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON professionals
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contacts
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contact_identities
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON conversations
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON messages
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON appointments
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON waitlist_entries
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE slot_offers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON slot_offers
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE slot_offer_candidates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON slot_offer_candidates
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tasks
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quick_replies
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE return_protocols ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON return_protocols
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON nps_responses
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE crm_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_events
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON channel_connections
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
-- 2) AGENDA SEM CONFLITO, garantida pelo banco:
--    o mesmo profissional não pode ter duas consultas no mesmo horário
--    (consultas canceladas liberam o horário).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'cancelado');
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_valid_range CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE nps_responses ADD CONSTRAINT nps_score_range CHECK (score BETWEEN 0 AND 10);
--> statement-breakpoint
ALTER TABLE return_protocols ADD CONSTRAINT return_days_range CHECK (days_after BETWEEN 7 AND 730);
