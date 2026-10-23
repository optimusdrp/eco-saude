import { chromium, type FullConfig } from "@playwright/test";
import bcrypt from "bcryptjs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { closeDb, exec, value } from "./db";
import { E2E, type E2EUser } from "./env";

/**
 * Antes de todos os testes:
 *  1. confere que o banco de testes tem a demonstração (senão, explica como preparar);
 *  2. deixa os usuários de demonstração prontos para entrar (senha conhecida, sem troca
 *     obrigatória, sem 2 etapas, sem bloqueio por tentativas);
 *  3. entra com cada um e guarda a sessão em e2e/.auth/<usuario>.json (os testes reaproveitam).
 */
export const AUTH_DIR = path.resolve(__dirname, "../.auth");

export default async function globalSetup(config: FullConfig) {
  const clinic = await value("select id from clinics where trade_name = 'Clínica Exemplo'").catch((e: Error) => {
    throw new Error(`Banco de testes inacessível (${e.message}). Rode: pnpm test:e2e:prepare`);
  });
  if (!clinic) throw new Error("O banco de testes não tem a demonstração. Rode: pnpm test:e2e:prepare");

  const hash = await bcrypt.hash(E2E.password, 10);
  await exec(
    `update clinic_users set password_hash = $1, must_change_password = false, totp_enabled = false, totp_secret_enc = null,
            locked_until = null, failed_logins = 0
      where email = any($2)`,
    [hash, Object.values(E2E.users)],
  );
  // O limitador de tentativas de login não pode atrapalhar execuções seguidas
  await exec("delete from auth_throttle").catch(() => undefined);
  await closeDb();

  mkdirSync(AUTH_DIR, { recursive: true });
  const baseURL = config.projects[0]?.use.baseURL ?? E2E.baseUrl;
  const launch = config.projects[0]?.use.launchOptions ?? {};
  const browser = await chromium.launch(launch);
  try {
    for (const user of Object.keys(E2E.users) as E2EUser[]) {
      const ctx = await browser.newContext({ baseURL, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
      const page = await ctx.newPage();
      await page.goto("/login");
      await page.fill("#email", E2E.users[user]);
      await page.fill("#password", E2E.password);
      await page.click("main form button[type=submit]");
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
      await ctx.storageState({ path: path.join(AUTH_DIR, `${user}.json`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
