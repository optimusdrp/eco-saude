import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E } from "./e2e/support/env";
import { FAKE_EVOLUTION_KEY, FAKE_EVOLUTION_PORT } from "./e2e/support/fake-evolution";

/**
 * TESTES DE PONTA A PONTA (Playwright) do ambiente da clínica.
 *
 * Rodam contra um BANCO PRÓPRIO DE TESTES (E2E_DATABASE_URL, padrão "ecosaude_e2e"), porque
 * apagam e recriam dados (atendimentos, triagens, consultórios). Nunca apontam para o banco
 * de desenvolvimento nem de produção: o preparo recusa banco sem "_e2e" ou "_test" no nome.
 *
 * Passo a passo (local):
 *   1. pnpm db:up                         (PostgreSQL do docker-compose)
 *   2. pnpm test:e2e:prepare              (cria o banco de testes, migra e carrega a demonstração)
 *   3. pnpm --filter @ecosaude/app build  (os testes usam o app de produção: mais rápido e estável)
 *   4. pnpm test:e2e                      (sobe o app na porta 3100 e roda tudo)
 *      pnpm test:e2e --ui                 (modo visual para investigar uma falha)
 *
 * Os testes rodam um por vez (workers: 1): compartilham o mesmo banco.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { outputFolder: "e2e/playwright-report", open: "never" }]] : [["list"], ["html", { outputFolder: "e2e/playwright-report", open: "never" }]],
  globalSetup: "./e2e/support/global-setup.ts",
  use: {
    baseURL: E2E.baseUrl,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        // Ambientes com o Chromium já instalado em outro lugar (ex.: imagem com navegador pronto)
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  // Sobe o app (já compilado) apontando para o banco de testes. Com E2E_BASE_URL, usa um app já no ar.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next start --port ${E2E.port}`,
        url: `${E2E.baseUrl}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          DATABASE_URL: E2E.databaseUrl,
          APP_URL: E2E.baseUrl,
          CRON_SECRET: "e2e-cron",
          STORAGE_DRIVER: "local",
          META_APP_SECRET: "e2e-meta-secret",
          META_VERIFY_TOKEN: "e2e-verify",
          EVOLUTION_WEBHOOK_SECRET: "e2e-evolution-secret",
          // Evolution de mentira (e2e/support/fake-evolution.ts), ligada pelo teste evolution-piloto
          EVOLUTION_API_URL: `http://127.0.0.1:${FAKE_EVOLUTION_PORT}`,
          EVOLUTION_API_KEY: FAKE_EVOLUTION_KEY,
          EVOLUTION_PAIRING_RETRY_MS: "50",
          // Despachante do ritmo do WhatsApp mais frequente nos testes (padrão: 3 s)
          PACING_TICK_MS: "500",
          // APP_URL dos testes é http (o app recusa em produção); a Evolution chama por este endereço
          EVOLUTION_WEBHOOK_BASE_URL: E2E.baseUrl,
          // Modo gravação do piloto: o teste confere que grava SEM dados pessoais
          EVOLUTION_CAPTURE_DIR: path.resolve(__dirname, "e2e/.capturas-evolution"),
          TOTP_ENCRYPTION_KEY: process.env.TOTP_ENCRYPTION_KEY ?? "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
          LGPD_HASH_SECRET: process.env.LGPD_HASH_SECRET ?? "e2e-lgpd-secret",
          PORT: String(E2E.port),
        },
      },
});
