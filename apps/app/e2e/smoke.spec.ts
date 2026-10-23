import { expect, expectNoHorizontalScroll, test } from "./support/fixtures";

/**
 * FUMAÇA: o básico de pé. Rápido, roda primeiro e falha cedo se o app nem sobe direito.
 */
test("sem sessão: telas internas mandam para o login; login e verificação pública abrem no celular", async ({ as }) => {
  const pg = await as("anonimo", { width: 390, height: 844 });
  await pg.goto("/hoje");
  await expect(pg).toHaveURL(/\/login/);
  await expect(pg.locator("#email")).toBeVisible();
  await expectNoHorizontalScroll(pg);
  await pg.goto("/documento");
  await expect(pg.locator("#codigo")).toBeVisible();
  await expectNoHorizontalScroll(pg);
});

test("cada perfil cai na sua tela inicial e as principais telas abrem sem erro", async ({ as }) => {
  const r = await as("recepcao");
  await r.goto("/");
  await expect(r).toHaveURL(/\/hoje$/);
  for (const path of ["/crm/agenda", "/crm/contatos", "/crm/conversas"]) {
    const res = await r.goto(path);
    expect(res?.status(), path).toBeLessThan(400);
    await expect(r.locator("main")).toBeVisible();
  }
  const b = await as("beatriz");
  await b.goto("/");
  await expect(b).toHaveURL(/\/consultorio$/);
});
