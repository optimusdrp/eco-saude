import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";
import type { E2EUser } from "./env";

/**
 * Fixture "as": abre o sistema já logado como uma pessoa da demonstração.
 *
 *   const pg = await as("beatriz");                       // computador (1440 x 1000)
 *   const cel = await as("beatriz", { width: 390, height: 844 });  // celular
 *
 * Cada chamada abre um contexto novo (cookies separados). Erros de JavaScript da página
 * fazem o teste falhar no fim: tela que "funciona" com erro no console também é defeito.
 */
type AsFn = (user: E2EUser | "anonimo", viewport?: { width: number; height: number }) => Promise<Page>;

export const test = base.extend<{ as: AsFn }>({
  as: async ({ browser }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    const errors: string[] = [];
    await use(async (user, viewport) => {
      const ctx = await browser.newContext({
        storageState: user === "anonimo" ? undefined : path.resolve(__dirname, "../.auth", `${user}.json`),
        viewport: viewport ?? { width: 1440, height: 1000 },
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
      });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[${user}] ${e.message}`));
      return page;
    });
    for (const c of contexts) await c.close();
    expect(errors, "erros de JavaScript nas páginas").toEqual([]);
  },
});

export { expect };

/** Sem rolagem horizontal (responsividade no celular) */
export async function expectNoHorizontalScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, "a página não pode rolar para o lado").toBeLessThanOrEqual(width);
}
