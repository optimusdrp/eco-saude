import { expect, test } from "@playwright/test";

/**
 * Landing page: oferta do ecossistema (5 módulos, Laboratório planejado) e promessas
 * ainda não entregues marcadas como "Em breve".
 */
test.describe("Landing page do Tropi", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("usa a marca Tropi e nunca o nome antigo", async ({ page }) => {
    await expect(page).toHaveTitle(/Tropi/);
    const texto = await page.locator("body").innerText();
    expect(texto).not.toMatch(/EcoSa[uú]de/i);
    const descricao = await page.locator('meta[name="description"]').getAttribute("content");
    expect(descricao).toContain("Laboratório");
    expect(descricao).not.toMatch(/internet cai/);
  });

  test("mostra os 5 módulos, com o Laboratório como planejado", async ({ page }) => {
    const eco = page.locator("#ecossistema");
    for (const nome of ["Atendimento", "Prontuário", "Gestão", "Indicadores", "Laboratório"]) {
      await expect(eco.getByText(`Tropi ${nome}`, { exact: true })).toBeVisible();
    }
    const lab = page.locator("#laboratorio");
    await expect(lab.getByRole("heading", { name: "Para laboratórios, o mesmo ecossistema" })).toBeVisible();
    await expect(lab.getByText("Em breve")).toBeVisible();
  });

  test("modo offline e painel de contingência aparecem como 'Em breve'", async ({ page }) => {
    await expect(page.locator("#offline").getByText("Em breve")).toBeVisible();
    const contingencia = page.locator("#diferenciais li", { hasText: "Painel de contingência" });
    await expect(contingencia.getByText("Em breve")).toBeVisible();
  });

  test("'Quero ser avisado' leva ao formulário com Laboratório marcado", async ({ page }) => {
    await page.locator("#laboratorio").getByRole("link", { name: "Quero ser avisado" }).click();
    const form = page.locator("#demonstracao");
    await expect(form.getByLabel("Clínica ou laboratório")).toBeVisible();
    await expect(form.getByRole("checkbox", { name: "Laboratório" })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: "Atendimento" })).toBeChecked();
    await expect(form.getByRole("checkbox")).toHaveCount(6); // 5 módulos + consentimento
  });

  test("não tem rolagem lateral", async ({ page }) => {
    const { conteudo, tela } = await page.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, tela: window.innerWidth }));
    expect(conteudo).toBeLessThanOrEqual(tela);
  });
});
