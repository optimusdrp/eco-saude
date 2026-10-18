/**
 * Testa a conexão com o banco e mostra com QUAL servidor você está falando.
 * Uso: pnpm db:check
 *
 * Útil para descobrir se o projeto está conectando no PostgreSQL do Docker
 * ou em outro PostgreSQL instalado no computador.
 */
import { Pool } from "pg";
import { explainDbError, safeUrl } from "./diagnose";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida. Copie .env.example para .env na raiz do projeto.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
try {
  const { rows } = await pool.query<{ version: string; db: string; user: string }>(
    "select version() as version, current_database() as db, current_user as user",
  );
  const info = rows[0]!;
  // A imagem Docker é Alpine Linux; um PostgreSQL instalado no Windows mostra "Visual C++"
  const isDocker = /linux|alpine|musl/i.test(info.version);

  console.log("Conexão OK");
  console.log(`  Endereço: ${safeUrl(url)}`);
  console.log(`  Banco:    ${info.db} (usuário ${info.user})`);
  console.log(`  Servidor: ${info.version.split(",")[0]}`);
  console.log(
    isDocker
      ? "  Origem:   PostgreSQL do Docker deste projeto"
      : "  Origem:   NÃO parece ser o Docker deste projeto (talvez um PostgreSQL instalado no computador)",
  );
} catch (error) {
  console.error(explainDbError(error, url));
  process.exitCode = 1;
} finally {
  await pool.end();
}
