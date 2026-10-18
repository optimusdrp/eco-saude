import "server-only";
import { buildBriefPrompt, BRIEF_RESPONSE_SCHEMA, checkBrief, ruleBrief, todayIso, type DayFacts } from "@ecosaude/core/crm";
import { eq, schema, sql, withTenant } from "@ecosaude/db";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { automationSettings } from "../automation-settings";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * RESUMO DA MANHÃ (painel Hoje)
 *
 * A página NUNCA espera a IA:
 *  - mesmos números de antes (hash igual) -> o texto guardado;
 *  - números mudaram -> mostra NA HORA a frase das regras (sempre certa) e pede
 *    à IA uma versão melhor DEPOIS da resposta (after). Na próxima atualização
 *    (o Hoje se atualiza a cada 30 s) aparece a da IA.
 *  - Texto da IA velho (números mudaram) nunca é mostrado: número certo vale mais
 *    que frase bonita.
 *  - No máximo uma chamada a cada 10 min por clínica (custo).
 * Para a IA vão só contagens e nomes de profissionais (nenhum dado de paciente).
 */

const THROTTLE_MIN = 10;

export interface BriefView {
  text: string;
  source: "ia" | "regras";
  /** A IA está escrevendo uma versão nova */
  pending: boolean;
}

const hashOf = (f: DayFacts) => createHash("sha1").update(JSON.stringify(f)).digest("hex").slice(0, 16);

export async function dayBrief(clinicId: string, facts: DayFacts): Promise<BriefView | null> {
  const today = todayIso();
  const hash = hashOf(facts);
  const { enabled, row } = await withTenant(clinicId, async (tx) => {
    const cfg = (await automationSettings(tx)).ia_resumo_dia;
    const [row] = await tx.select().from(schema.dayBriefs).where(eq(schema.dayBriefs.date, today)).limit(1);
    return { enabled: !!cfg?.enabled, row };
  });
  if (!enabled) return null;
  const rules: BriefView = { text: ruleBrief(facts), source: "regras", pending: false };
  if (row && row.factsHash === hash) return { text: row.text, source: row.source as "ia" | "regras", pending: false };
  if (!aiConfigured()) return rules;
  // Já pediu há pouco: segura (a frase das regras está certa enquanto isso)
  if (row && Date.now() - row.createdAt.getTime() < THROTTLE_MIN * 60_000) return rules;

  after(() => writeBrief(clinicId, today, hash, facts).catch((e) => console.error("[resumo do dia IA]", e)));
  return { ...rules, pending: true };
}

async function writeBrief(clinicId: string, date: string, hash: string, facts: DayFacts) {
  // Marca o pedido antes (evita duas chamadas ao mesmo tempo de abas diferentes)
  const claimed = await withTenant(clinicId, (tx) =>
    tx
      .insert(schema.dayBriefs)
      .values({ date, factsHash: hash, text: ruleBrief(facts), source: "regras", fallbackReason: "a IA está escrevendo" })
      .onConflictDoUpdate({
        target: [schema.dayBriefs.clinicId, schema.dayBriefs.date],
        set: { factsHash: hash, text: ruleBrief(facts), source: "regras", fallbackReason: "a IA está escrevendo", createdAt: new Date() },
        where: sql`${schema.dayBriefs.createdAt} < now() - make_interval(mins => ${THROTTLE_MIN})`,
      })
      .returning({ date: schema.dayBriefs.date }),
  );
  if (!claimed.length) return;

  let text = ruleBrief(facts);
  let source: "ia" | "regras" = "regras";
  let reason: string | null = null;
  let model: string | null = null;
  let latencyMs: number | null = null;
  try {
    const { system, user } = buildBriefPrompt(facts);
    const out = await generate({ system, user, schema: BRIEF_RESPONSE_SCHEMA, temperature: 0.3 });
    model = out.model;
    latencyMs = out.latencyMs;
    const checked = checkBrief(out.text, facts);
    if (checked.ok) {
      text = checked.text;
      source = "ia";
    } else reason = checked.reason;
  } catch (error) {
    reason = error instanceof AiError ? error.reason : "falha inesperada na IA";
  }
  await withTenant(clinicId, (tx) => tx.update(schema.dayBriefs).set({ text, source, fallbackReason: reason, model, latencyMs }).where(eq(schema.dayBriefs.date, date)));
}
