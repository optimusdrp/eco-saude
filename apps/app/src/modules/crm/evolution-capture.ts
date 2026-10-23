import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureName, createEvolutionAnonymizer } from "@ecosaude/channels";

/**
 * MODO GRAVAÇÃO DO PILOTO (Evolution real)
 *
 * Com EVOLUTION_CAPTURE_DIR definido, cada webhook da Evolution que passou na conferência do
 * cabeçalho secreto é gravado nessa pasta, JÁ SEM DADOS PESSOAIS (ver
 * packages/channels/src/evolution-capture.ts). Depois do piloto:
 *   pnpm --filter @ecosaude/channels fixtures:evolution <pasta>
 * leva as capturas para as fixtures dos testes.
 *
 * Só para o piloto: deixe a variável vazia em produção. Falha ao gravar nunca atrapalha o webhook.
 */
const anonymizer = createEvolutionAnonymizer();
let seq = 0;

export async function captureEvolutionWebhook(body: unknown): Promise<void> {
  const dir = process.env.EVOLUTION_CAPTURE_DIR;
  if (!dir) return;
  try {
    await mkdir(dir, { recursive: true });
    const clean = anonymizer.anonymize(body);
    seq += 1;
    // Ordem de chegada no nome: o roteiro do piloto confere a sequência dos eventos
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${String(seq).padStart(4, "0")}-${captureName(clean)}.json`;
    await writeFile(join(dir, name), JSON.stringify(clean, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error("[evolution captura]", (error as Error).message);
  }
}
