import type { NextConfig } from "next";

/**
 * Backoffice (uso interno).
 * - transpilePackages: os pacotes do monorepo são TypeScript puro; o Next compila.
 * - serverExternalPackages: "pg" roda só no servidor, sem passar pelo bundler.
 * - headers: proteções extras, já que é uma área administrativa.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Nunca indexar o backoffice em buscadores
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@ecosaude/core", "@ecosaude/db", "@ecosaude/auth"],
  serverExternalPackages: ["pg"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
