/**
 * Configuração dos testes de ponta a ponta (lida das variáveis de ambiente).
 *
 *  E2E_DATABASE_URL  banco de testes (padrão: o do docker-compose, base "ecosaude_e2e")
 *  E2E_PORT          porta do app nos testes (padrão 3100, para não brigar com o "pnpm dev" na 3002)
 *  E2E_BASE_URL      app já no ar (pula o servidor do Playwright)
 */
const port = Number(process.env.E2E_PORT || 3100);

export const E2E = {
  port,
  baseUrl: process.env.E2E_BASE_URL || `http://localhost:${port}`,
  databaseUrl: process.env.E2E_DATABASE_URL || "postgres://postgres:postgres@localhost:54320/ecosaude_e2e",
  /** Senha que o preparo grava para os usuários de demonstração */
  password: "Tropi-E2E-2026x",
  users: {
    gestor: "gestor@clinicaexemplo.com.br",
    recepcao: "recepcao@clinicaexemplo.com.br",
    beatriz: "beatriz@clinicaexemplo.com.br",
  },
} as const;

export type E2EUser = keyof typeof E2E.users;

/** Trava de segurança: só aceita banco com "_e2e" ou "_test" no nome */
export function assertTestDatabase(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/(_e2e|_test)$/.test(name)) {
    throw new Error(`Os testes apagam dados. Use um banco só para testes (nome terminando em _e2e ou _test). Recebido: "${name}".`);
  }
  return name;
}
