-- Conversa guarda para qual identificador responder (paciente com mais de um número).
ALTER TABLE "conversations" ADD COLUMN "reply_to" text;