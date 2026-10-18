import type { NextConfig } from "next";

/**
 * Configuração do Next.js.
 * - reactStrictMode: ajuda a detectar efeitos colaterais em desenvolvimento.
 * - poweredByHeader: remove o cabeçalho "X-Powered-By" (não expõe a stack).
 * - headers: cabeçalhos de segurança básicos aplicados a todas as rotas.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pacotes do monorepo em TypeScript puro: o Next compila
  transpilePackages: ["@ecosaude/core", "@ecosaude/db"],
  // Driver do PostgreSQL roda só no servidor
  serverExternalPackages: ["pg"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
