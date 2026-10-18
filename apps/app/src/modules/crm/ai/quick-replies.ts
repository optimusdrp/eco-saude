import "server-only";
import {
  buildQuickReplyPrompt,
  checkQuickReplies,
  clusterRepeated,
  QUICK_REPLY_SCHEMA,
  ruleProposal,
  similarToExisting,
  usableAsShortcut,
  type QuickReplyProposal,
  type RepeatCluster,
} from "@ecosaude/core/crm";
import { and, db, desc, eq, gt, isNotNull, schema, sql, withTenant } from "@ecosaude/db";
import { logEvent } from "../journey";
import { automationSettings } from "../automation-settings";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * RESPOSTAS RÁPIDAS SUGERIDAS (servidor)
 *
 *  1. Lê as mensagens que a EQUIPE escreveu (não as automáticas) nos últimos 90 dias.
 *  2. Agrupa as repetições (estatística, sem IA) e tira o que já é atalho,
 *     o que foi descartado e o que tem dado pessoal ou orientação de saúde.
 *  3. A IA redige a versão final (fora da transação). Plano B: a variação mais usada.
 *  4. Grava como SUGESTÃO pendente: só vira atalho com "Criar atalho".
 *
 * Roda uma vez por semana pela rotina, ou na hora pelo botão "Procurar agora".
 */

const DAYS = 90;
const MAX_SUGGESTIONS = 8;
export const MINING_EVENT = "quick_replies_mined";

export interface MiningResult {
  found: number;
  saved: number;
  source: "ia" | "regras" | null;
  reason: string | null;
}

/** Roda se estiver ligado e (force ou passou 1 semana da última busca). */
export async function mineQuickReplies(clinicId: string, opts: { force?: boolean; actorId?: string | null } = {}): Promise<MiningResult | null> {
  const plan = await withTenant(clinicId, async (tx) => {
    const cfg = (await automationSettings(tx)).ia_respostas_sugeridas;
    if (!cfg?.enabled) return null;
    if (!opts.force) {
      const [last] = await tx.select({ at: schema.crmEvents.createdAt }).from(schema.crmEvents).where(eq(schema.crmEvents.type, MINING_EVENT)).orderBy(desc(schema.crmEvents.createdAt)).limit(1);
      if (last && last.at.getTime() > Date.now() - 7 * 86_400_000) return null;
    }
    // Só o que a equipe digitou: mensagens com autor (automações não têm autor)
    const msgs = await tx
      .select({ body: schema.messages.body, conversationId: schema.messages.conversationId, authorId: schema.messages.authorId, contactName: schema.contacts.name })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .where(and(eq(schema.messages.direction, "out"), isNotNull(schema.messages.authorId), gt(schema.messages.createdAt, new Date(Date.now() - DAYS * 86_400_000))))
      .orderBy(desc(schema.messages.createdAt))
      .limit(5000);
    const existing = await tx.select({ shortcut: schema.quickReplies.shortcut, body: schema.quickReplies.body }).from(schema.quickReplies);
    const decided = await tx
      .select({ key: schema.quickReplySuggestions.key, status: schema.quickReplySuggestions.status, shortcut: schema.quickReplySuggestions.shortcut })
      .from(schema.quickReplySuggestions);
    return {
      msgs,
      existing,
      decided,
      minCount: typeof cfg.minRepeticoes === "number" ? cfg.minRepeticoes : 5,
      minConversations: typeof cfg.minConversas === "number" ? cfg.minConversas : 3,
    };
  });
  if (!plan) return null;

  const clinic = await db.query.clinics.findFirst({ where: (c, { eq: e }) => e(c.id, clinicId), columns: { tradeName: true } });
  const skip = new Set(plan.decided.filter((d) => d.status !== "pendente").map((d) => d.key));
  const clusters: RepeatCluster[] = clusterRepeated(plan.msgs, clinic?.tradeName, { minCount: plan.minCount, minConversations: plan.minConversations })
    .filter((c) => !skip.has(c.key))
    .filter((c) => c.variants.every((v) => usableAsShortcut(v.text)))
    .filter(
      (c) =>
        !similarToExisting(
          c.variants[0]!.text,
          plan.existing.map((e) => e.body),
        ),
    )
    .slice(0, MAX_SUGGESTIONS);

  const taken = [...plan.existing.map((e) => e.shortcut), ...plan.decided.filter((d) => d.status === "pendente").map((d) => d.shortcut)];
  let proposals: QuickReplyProposal[] = [];
  let source: MiningResult["source"] = null;
  let reason: string | null = null;
  let model: string | null = null;
  if (clusters.length) {
    const rules = () => {
      const used = [...taken];
      return clusters.map((c) => {
        const p = ruleProposal(c, used);
        used.push(p.shortcut);
        return p;
      });
    };
    if (!aiConfigured()) {
      proposals = rules();
      reason = "IA não configurada no servidor";
    } else {
      try {
        const { system, user } = buildQuickReplyPrompt(clusters);
        const out = await generate({ system, user, schema: QUICK_REPLY_SCHEMA, temperature: 0.2 });
        model = out.model;
        const checked = checkQuickReplies(out.text, clusters, taken);
        if (checked.ok) {
          proposals = checked.proposals;
          if (checked.rejected) reason = `${checked.rejected} texto(s) da IA recusado(s) na conferência`;
        } else {
          proposals = rules();
          reason = checked.reason;
        }
      } catch (error) {
        proposals = rules();
        reason = error instanceof AiError ? error.reason : "falha inesperada na IA";
      }
    }
    source = proposals.some((p) => p.source === "ia") ? "ia" : "regras";
  }

  const saved = await withTenant(clinicId, async (tx) => {
    let n = 0;
    for (const p of proposals) {
      const rows = await tx
        .insert(schema.quickReplySuggestions)
        .values({
          key: p.key,
          shortcut: p.shortcut,
          title: p.title,
          body: p.body,
          count: p.count,
          conversations: p.conversations,
          source: p.source,
          model: p.source === "ia" ? model : null,
          fallbackReason: p.source === "regras" ? reason : null,
        })
        // Já sugerida e ainda pendente: atualiza os números e o texto
        .onConflictDoUpdate({
          target: [schema.quickReplySuggestions.clinicId, schema.quickReplySuggestions.key],
          set: { count: p.count, conversations: p.conversations, body: p.body, title: p.title, source: p.source },
          setWhere: sql`${schema.quickReplySuggestions.status} = 'pendente'`,
        })
        .returning({ id: schema.quickReplySuggestions.id });
      n += rows.length;
    }
    await logEvent(tx, { actorId: opts.actorId ?? null, type: MINING_EVENT, data: { grupos: clusters.length, sugestoes: n, origem: source ?? "-", motivo: reason } });
    return n;
  });
  return { found: clusters.length, saved, source, reason };
}
