import type { MetadataRoute } from "next";

/**
 * robots.txt gerado pelo Next.js.
 * Ambiente de testes: bloqueia buscadores. No lançamento, troque para
 * { userAgent: "*", allow: "/" }.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
