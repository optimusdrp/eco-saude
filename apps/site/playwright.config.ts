import { defineConfig, devices } from "@playwright/test";

/**
 * TESTES DE PONTA A PONTA DA LANDING PAGE (apps/site).
 *
 * Não usam banco: conferem só a página (módulos, Laboratório, "Em breve", formulário e
 * ausência de rolagem lateral no celular). O envio do formulário NÃO é testado aqui
 * (ele grava o lead no banco; a validação é coberta pelos testes do @ecosaude/core).
 *
 * Passo a passo:
 *   1. pnpm --filter @ecosaude/site build
 *   2. pnpm test:e2e:site      (sobe o site na porta 3300 e roda tudo)
 */
const PORT = Number(process.env.SITE_E2E_PORT ?? 3300);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "pt-BR", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } },
    { name: "celular", use: { ...devices["Pixel 7"], launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } },
  ],
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
