/**
 * Roda uma vez quando o servidor do Tropi sobe (convenção do Next.js).
 * Liga o despachante do ritmo do WhatsApp do celular (modules/crm/pacing-ticker.ts).
 * Só no servidor Node: não no Edge nem durante o build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startPacingTicker } = await import("./modules/crm/pacing-ticker");
  startPacingTicker();
}
