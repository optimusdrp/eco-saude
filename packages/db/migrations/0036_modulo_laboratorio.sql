ALTER TYPE "public"."module_id" ADD VALUE IF NOT EXISTS 'lab';
-- ====================== Tropi Laboratório no catálogo ======================
-- Novo valor no tipo dos módulos (catálogo, planos, contratações e interesses dos leads do site).
-- O módulo em si ainda não existe na plataforma (código pausado): a linha do catálogo é criada
-- pelo seed (pnpm db:seed), fora desta migração, porque o Postgres não deixa usar um valor novo
-- de enum na mesma transação em que ele foi criado.
