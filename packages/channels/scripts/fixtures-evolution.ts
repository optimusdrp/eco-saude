/**
 * Leva as capturas do piloto (EVOLUTION_CAPTURE_DIR) para as fixtures dos testes.
 *
 *   pnpm --filter @ecosaude/channels fixtures:evolution /caminho/das/capturas
 *
 * Para cada arquivo: anonimiza de novo (segurança extra), confere que não sobrou dado pessoal
 * (se sobrou, NÃO copia e mostra o motivo) e guarda até 2 exemplos de cada tipo
 * (evento + tipo de mensagem + quem mandou) em src/fixtures/evolution/piloto-*.json.
 * Depois rode `pnpm --filter @ecosaude/channels test`: todos passam pela mesma conferência.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureName, createEvolutionAnonymizer, findPersonalData } from "../src/evolution-capture";

const from = process.argv[2];
if (!from || !existsSync(from)) {
  console.error("Uso: pnpm --filter @ecosaude/channels fixtures:evolution <pasta das capturas>");
  process.exit(1);
}
const to = resolve(fileURLToPath(new URL(".", import.meta.url)), "../src/fixtures/evolution");
const anonymizer = createEvolutionAnonymizer();
const perKind = new Map<string, number>();
let copied = 0;
let refused = 0;

for (const file of readdirSync(from).filter((f) => f.endsWith(".json")).sort()) {
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(join(from, file), "utf8"));
  } catch {
    console.warn(`ignorado (não é JSON): ${file}`);
    continue;
  }
  const clean = anonymizer.anonymize(body);
  const problems = findPersonalData(clean);
  if (problems.length) {
    refused++;
    console.warn(`NÃO copiado ${file}:\n  - ${problems.join("\n  - ")}`);
    continue;
  }
  const kind = captureName(clean);
  const n = (perKind.get(kind) ?? 0) + 1;
  perKind.set(kind, n);
  if (n > 2) continue;
  const name = `piloto-${kind}${n > 1 ? `-${n}` : ""}.json`;
  writeFileSync(join(to, name), JSON.stringify(clean, null, 2) + "\n");
  copied++;
  console.log(`ok ${name}`);
}
console.log(`\n${copied} fixture(s) gravada(s) em ${to}; ${refused} recusada(s). Agora rode os testes do pacote.`);
