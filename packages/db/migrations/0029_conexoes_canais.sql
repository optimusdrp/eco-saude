ALTER TABLE "channel_connections" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "connection_state" text DEFAULT 'desconectado' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "state_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "credentials_enc" text;--> statement-breakpoint
-- Valores possíveis (as listas ficam em @ecosaude/core: CONNECTION_KINDS e CONNECTION_STATES)
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_kind_check
  CHECK (kind IS NULL OR kind IN ('evolution_qr','evolution_cloud','meta_cloud','instagram_login','facebook_login','page','bot'));
--> statement-breakpoint
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_state_check
  CHECK (connection_state IN ('desconectado','conectando','conectado','erro'));
--> statement-breakpoint
-- Quem já estava em modo real (configuração antiga, credencial no ambiente) segue funcionando
UPDATE channel_connections SET
  kind = CASE channel WHEN 'whatsapp' THEN 'meta_cloud' WHEN 'instagram' THEN 'facebook_login' WHEN 'facebook' THEN 'page' ELSE 'bot' END,
  connection_state = 'conectado', state_at = now()
WHERE mode = 'real';
