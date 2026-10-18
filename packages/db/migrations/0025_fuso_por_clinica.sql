ALTER TABLE "clinics" ADD COLUMN "time_zone" text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
-- Só fusos do Brasil (mesma lista de packages/core/src/crm/timezones.ts)
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_time_zone_br" CHECK ("time_zone" IN (
  'America/Noronha', 'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Maceio',
  'America/Belem', 'America/Santarem', 'America/Araguaina', 'America/Campo_Grande', 'America/Cuiaba', 'America/Manaus',
  'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Eirunepe'
));
--> statement-breakpoint
-- Clínicas já cadastradas: fuso pelo estado (quem está em Brasília continua igual)
UPDATE "clinics" SET "time_zone" = CASE upper(trim("state"))
  WHEN 'BA' THEN 'America/Bahia'
  WHEN 'CE' THEN 'America/Fortaleza' WHEN 'MA' THEN 'America/Fortaleza' WHEN 'PI' THEN 'America/Fortaleza' WHEN 'RN' THEN 'America/Fortaleza' WHEN 'PB' THEN 'America/Fortaleza'
  WHEN 'PE' THEN 'America/Recife'
  WHEN 'AL' THEN 'America/Maceio' WHEN 'SE' THEN 'America/Maceio'
  WHEN 'PA' THEN 'America/Belem' WHEN 'AP' THEN 'America/Belem'
  WHEN 'TO' THEN 'America/Araguaina'
  WHEN 'MS' THEN 'America/Campo_Grande'
  WHEN 'MT' THEN 'America/Cuiaba'
  WHEN 'AM' THEN 'America/Manaus'
  WHEN 'RO' THEN 'America/Porto_Velho'
  WHEN 'RR' THEN 'America/Boa_Vista'
  WHEN 'AC' THEN 'America/Rio_Branco'
  ELSE 'America/Sao_Paulo' END;
