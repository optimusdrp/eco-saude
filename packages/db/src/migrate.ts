/**
 * Aplica as migrações pendentes no banco.
 * Uso: pnpm db:migrate  (lê DATABASE_URL do arquivo .env da raiz)
 *
 * O drizzle guarda quais migrações já rodaram na tabela
 * "drizzle.__drizzle_migrations", então rodar duas vezes é seguro.
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { explainDbError } from "./diagnose";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida. Copie .env.example para .env.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
try {
  // fileURLToPath converte o endereço do arquivo em caminho do sistema operacional.
  // (Usar ".pathname" quebra no Windows: gera "/C:/..." e codifica acentos como "%C3%BA".)
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("Migrações aplicadas.");
} catch (error) {
  console.error("Falha ao migrar.\n");
  console.error(explainDbError(error, url));
  process.exitCode = 1;
} finally {
  await pool.end();
}
