import "server-only";
import { withClinicTimeZone } from "@ecosaude/db";
import { classifyPendingIntents } from "./intent";
import { processAiJobs } from "./jobs";
import { processPendingPromises } from "./promises";
import { classifyPendingSentiments } from "./sentiment";

/**
 * Filas da IA que rodam DEPOIS da entrada da mensagem (after() do webhook e do
 * simulador e do envio) e na rotina de 10 minutos: intenção, sentimento, promessas
 * e os trabalhos de cadastro, etiquetas, motivo da perda e retorno personalizado.
 * Uma falha numa fila não impede a outra.
 */
export async function runAiQueues(clinicId: string, limit = 20) {
  // Roda depois da resposta (after) ou pela rotina: abre o fuso da clínica aqui mesmo
  return withClinicTimeZone(clinicId, () => runAiQueuesInner(clinicId, limit));
}

async function runAiQueuesInner(clinicId: string, limit: number) {
  const intents = await classifyPendingIntents(clinicId, limit).catch((e) => (console.error("[intenção IA]", e), { ai: 0, rules: 0 }));
  const sentiments = await classifyPendingSentiments(clinicId, limit).catch((e) => (console.error("[sentimento IA]", e), { ai: 0, rules: 0, alerts: 0 }));
  const promises = await processPendingPromises(clinicId, limit).catch((e) => (console.error("[promessas IA]", e), { ai: 0, rules: 0, tasks: 0 }));
  const jobs = await processAiJobs(clinicId, limit).catch((e) => (console.error("[trabalhos IA]", e), { done: 0, ai: 0 }));
  return { intents, sentiments, promises, jobs };
}
