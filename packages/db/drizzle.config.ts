import { defineConfig } from "drizzle-kit";

/**
 * Configuração do drizzle-kit (gera e aplica migrações).
 * - schema: onde estão as tabelas em TypeScript.
 * - out: pasta das migrações SQL geradas (vão para o Git).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/schema-crm.ts", "./src/schema-pep.ts"],
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54320/ecosaude",
  },
  strict: true,
  verbose: true,
});
