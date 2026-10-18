import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Monorepo: as variáveis de ambiente ficam num único arquivo .env na RAIZ.
 * O Next.js só lê o .env da pasta de cada app, então esta função procura o
 * .env subindo as pastas a partir de onde o processo rodou e o carrega.
 *
 * - Não sobrescreve variáveis já definidas (na Vercel/AWS elas vêm do painel).
 * - Roda uma vez só por processo.
 */
let loaded = false;

export function ensureEnv(): void {
  if (loaded) return;
  loaded = true;
  if (process.env.VERCEL) return; // em produção as variáveis vêm da plataforma
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const file = path.join(dir, ".env");
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
    dir = path.dirname(dir);
  }
}
