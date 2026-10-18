-- Migração escrita à mão (drizzle-kit generate --custom).
--
-- 1) Trilha de auditoria IMUTÁVEL
--    Bloqueia UPDATE, DELETE e TRUNCATE na tabela audit_log no próprio banco.
--    Mesmo um bug ou um acesso indevido pela aplicação não consegue apagar rastros.
CREATE OR REPLACE FUNCTION audit_log_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é somente inserção: % não permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_changes();
--> statement-breakpoint
-- 2) Preço nunca negativo e teste sempre com data de término
ALTER TABLE plans ADD CONSTRAINT plans_price_non_negative CHECK (price_monthly_cents >= 0);
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_trial_has_end
  CHECK (status <> 'teste' OR trial_ends_at IS NOT NULL);
