ALTER TABLE "channel_connections" ADD COLUMN "pacing" jsonb;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "pace_next_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "messages_sent_out_idx" ON "messages" USING btree ("clinic_id","channel","sent_at") WHERE "messages"."direction" = 'out' and "messages"."sent_at" is not null;-- ====================== Ritmo de envio do WhatsApp do celular ======================
-- Colunas novas em channel_connections: a tabela já tem RLS (tenant_isolation) e GRANT
-- por tabela para ecosaude_tenant (0005), que valem também para as colunas novas.
-- pacing: ritmo escolhido (vazio = sugestão "cauteloso"); pace_next_at: vez do próximo envio.
-- Índice parcial para contar as mensagens enviadas no último minuto e na última hora.
