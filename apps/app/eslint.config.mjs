// ESLint (flat config) com as regras oficiais do Next.js + TypeScript.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  // Testes de ponta a ponta: o "use" das fixtures do Playwright não é hook do React
  { files: ["e2e/**/*.ts"], rules: { "react-hooks/rules-of-hooks": "off" } },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "e2e/test-results/**", "e2e/playwright-report/**", "e2e/.auth/**"] },
];
export default config;
