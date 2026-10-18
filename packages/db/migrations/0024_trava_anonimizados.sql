-- LGPD: ficha anonimizada é DEFINITIVA. A trava fica no banco (não só na tela):
-- nenhum caminho do sistema (tela, rotina, automação, importação) consegue
-- regravar dado pessoal nela, nem criar consulta, tarefa, mensagem ou lista de espera.
-- Código de erro próprio (EC001) para a tela mostrar uma mensagem clara.
CREATE OR REPLACE FUNCTION ecosaude_guard_anonymized_contact() RETURNS trigger AS $$
BEGIN
  IF OLD.anonymized_at IS NOT NULL AND (
       NEW.anonymized_at IS NULL
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.phone IS NOT NULL OR NEW.email IS NOT NULL OR NEW.birth_date IS NOT NULL
    OR NEW.insurance IS NOT NULL OR NEW.referred_by IS NOT NULL OR NEW.lost_reason IS NOT NULL
    OR cardinality(NEW.tags) > 0 OR NEW.consent_marketing
  ) THEN
    RAISE EXCEPTION 'ficha anonimizada a pedido do titular' USING ERRCODE = 'EC001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contacts_guard_anonymized BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION ecosaude_guard_anonymized_contact();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ecosaude_guard_anonymized_child() RETURNS trigger AS $$
DECLARE cid uuid;
BEGIN
  IF TG_TABLE_NAME = 'messages' THEN
    -- Só mensagens novas da EQUIPE (saída ou nota); a anonimização em si é um UPDATE
    IF NEW.direction = 'in' THEN RETURN NEW; END IF;
    SELECT contact_id INTO cid FROM conversations WHERE id = NEW.conversation_id;
  ELSE
    cid := NEW.contact_id;
  END IF;
  IF cid IS NOT NULL AND EXISTS (SELECT 1 FROM contacts WHERE id = cid AND anonymized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ficha anonimizada a pedido do titular' USING ERRCODE = 'EC001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER appointments_guard_anonymized BEFORE INSERT ON appointments FOR EACH ROW EXECUTE FUNCTION ecosaude_guard_anonymized_child();
--> statement-breakpoint
CREATE TRIGGER tasks_guard_anonymized BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION ecosaude_guard_anonymized_child();
--> statement-breakpoint
CREATE TRIGGER waitlist_guard_anonymized BEFORE INSERT ON waitlist_entries FOR EACH ROW EXECUTE FUNCTION ecosaude_guard_anonymized_child();
--> statement-breakpoint
CREATE TRIGGER contact_identities_guard_anonymized BEFORE INSERT ON contact_identities FOR EACH ROW EXECUTE FUNCTION ecosaude_guard_anonymized_child();
--> statement-breakpoint
CREATE TRIGGER messages_guard_anonymized BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION ecosaude_guard_anonymized_child();
