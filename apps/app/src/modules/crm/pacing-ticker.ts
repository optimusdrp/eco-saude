import { dispatchQueued } from "./messaging";
import { pacedDueClinics } from "./pacing";

/**
 * DESPACHANTE DO SERVIDOR (ritmo do WhatsApp do celular)
 *
 * A cada PACING_TICK_MS (padrão 3 s), procura clínicas com mensagem automática esperando e
 * com a vez já liberada, e chama o despacho delas. É leve: na maioria das rodadas a consulta
 * não acha nada. Ligado em instrumentation.ts quando o servidor do Tropi sobe.
 *
 * Seguro com vários servidores: a vez é reservada no banco (claimPacedWhatsApp), então dois
 * despachantes ao mesmo tempo nunca furam o intervalo. DISPATCH_TICKER=off desliga (a rotina
 * agendada de 10 minutos continua mandando, só que bem mais devagar).
 */
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function pacingTick(): Promise<number> {
  if (running) return 0; // rodada anterior ainda em andamento (Evolution lenta): não acumula
  running = true;
  let sent = 0;
  try {
    for (const clinicId of await pacedDueClinics()) {
      const r = await dispatchQueued(clinicId).catch((e) => {
        console.error("[ritmo whatsapp]", (e as Error).message);
        return { sent: 0, failed: 0 };
      });
      sent += r.sent;
    }
  } catch (e) {
    console.error("[ritmo whatsapp]", (e as Error).message);
  } finally {
    running = false;
  }
  return sent;
}

export function startPacingTicker(): void {
  if (timer || process.env.DISPATCH_TICKER === "off") return;
  const every = Math.max(500, Number(process.env.PACING_TICK_MS ?? 3000));
  timer = setInterval(() => void pacingTick(), every);
  // Não segura o processo aberto (encerramento limpo do servidor)
  timer.unref?.();
}
