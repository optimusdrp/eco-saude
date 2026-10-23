/**
 * PREPARA O BANCO DOS TESTES DE PONTA A PONTA
 *
 *   pnpm test:e2e:prepare            cria o banco (se faltar), migra e carrega a demonstração
 *   pnpm test:e2e:prepare --reset    apaga e recria do zero
 *
 * Usa E2E_DATABASE_URL (padrão: postgres://postgres:postgres@localhost:54320/ecosaude_e2e).
 * Por segurança, só aceita banco com nome terminando em _e2e ou _test.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.E2E_DATABASE_URL || "postgres://postgres:postgres@localhost:54320/ecosaude_e2e";
const target = new URL(url);
const name = target.pathname.replace(/^\//, "");
if (!/(_e2e|_test)$/.test(name)) {
  console.error(`Banco "${name}" recusado: os testes apagam dados. Use um nome terminando em _e2e ou _test.`);
  process.exit(1);
}
if (!/^[a-z0-9_]+$/.test(name)) {
  console.error(`Nome de banco inválido: "${name}".`);
  process.exit(1);
}

// Conecta no banco "postgres" do mesmo servidor para criar/apagar o de testes
const admin = new URL(url);
admin.pathname = "/postgres";
const server = new pg.Client({ connectionString: admin.toString() });
await server.connect();
const exists = (await server.query("select 1 from pg_database where datname = $1", [name])).rowCount > 0;
if (exists && process.argv.includes("--reset")) {
  console.log(`Apagando ${name}...`);
  await server.query(`drop database ${name} with (force)`);
}
if (!exists || process.argv.includes("--reset")) {
  console.log(`Criando ${name}...`);
  await server.query(`create database ${name}`);
}
await server.end();

// Migrações e dados de demonstração, com o banco de testes no lugar do DATABASE_URL
const root = fileURLToPath(new URL("../../../", import.meta.url));
const env = { ...process.env, DATABASE_URL: url };
const run = (args) => execFileSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
run(["--filter", "@ecosaude/db", "migrate"]);

const db = new pg.Client({ connectionString: url });
await db.connect();
const seeded = (await db.query("select 1 from clinics where trade_name = 'Clínica Exemplo'")).rowCount > 0;
await db.end();
if (seeded) console.log("Demonstração já carregada.");
else run(["--filter", "@ecosaude/db", "seed", "--", "--demo"]);
console.log(`Banco de testes pronto: ${name}`);
