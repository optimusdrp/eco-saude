import type { NextConfig } from "next";

/**
 * Ambiente da clínica (CRM hoje; ERP, Prontuário e BI depois, no mesmo app).
 * - transpilePackages: pacotes do monorepo em TypeScript puro
 * - serverExternalPackages: driver do PostgreSQL só no servidor
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@ecosaude/core", "@ecosaude/db", "@ecosaude/auth", "@ecosaude/channels"],
  serverExternalPackages: ["pg"],
  // Anexos nas conversas: até 16 MB por arquivo (+ margem do formulário).
  // O padrão do Next é 1 MB por envio de ação do servidor.
  experimental: { serverActions: { bodySizeLimit: "17mb" } },
  // "Pacientes" virou "Contatos" (leads e pacientes juntos): links antigos continuam funcionando
  async redirects() {
    return [
      { source: "/crm/pacientes", destination: "/crm/contatos", permanent: true },
      { source: "/crm/pacientes/:path*", destination: "/crm/contatos/:path*", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
