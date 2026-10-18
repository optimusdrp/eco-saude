import "server-only";
import { setTimeZoneResolver } from "@ecosaude/core/crm";
import { currentClinicTimeZone } from "@ecosaude/db";
import { cache } from "react";

/**
 * FUSO DA CLÍNICA EM TODA A REQUISIÇÃO (telas, ações e rotas de API)
 *
 * Três camadas, nesta ordem:
 *  1. Contexto do servidor (AsyncLocalStorage em @ecosaude/db): transações da clínica
 *     e rotinas (cron, webhooks, filas de IA), inclusive quando uma rotina passa por
 *     várias clínicas na mesma requisição.
 *  2. A REQUISIÇÃO do Next.js: a autenticação liga o fuso ao objeto da requisição.
 *     Vale para ações e rotas de API também FORA da transação (ex.: o texto
 *     "hoje às 09:00" montado depois de buscar os horários livres).
 *  3. A RENDERIZAÇÃO (cache do React): componentes filhos da página.
 *
 * Por que a camada 2: no Next.js o contexto aberto DENTRO da autenticação não volta
 * para quem a chamou (testado). Em Node puro voltaria; no Next, não.
 *
 * A camada 2 usa o armazenamento interno de requisição do Next (o mesmo que
 * headers() e cookies() usam). Se uma versão futura mudar esse caminho, o import
 * falha de forma segura: valem as camadas 1 e 3, e o teste de fuso (README) acusa.
 */
type Store = object;
let nextRequestStore: (() => Store | undefined) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("next/dist/server/app-render/work-async-storage.external") as { workAsyncStorage?: { getStore(): Store | undefined } };
  if (mod.workAsyncStorage) nextRequestStore = () => mod.workAsyncStorage!.getStore();
} catch {
  nextRequestStore = null;
}

const byRequest = new WeakMap<Store, string>();
const renderBox = cache((): { tz?: string } => ({}));

function requestTimeZone(): string | undefined {
  const s = nextRequestStore?.();
  return s ? byRequest.get(s) : undefined;
}

setTimeZoneResolver(() => currentClinicTimeZone() ?? requestTimeZone() ?? renderBox().tz);

/** Chamado pela autenticação: o fuso vale para toda esta requisição. */
export function rememberRequestTimeZone(tz: string): void {
  const s = nextRequestStore?.();
  if (s) byRequest.set(s, tz);
  renderBox().tz = tz;
}
