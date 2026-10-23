import "server-only";
import {
  addDaysIso,
  buildPromisePrompt,
  buildScheduleCalendar,
  checkPromises,
  firstName,
  mayHavePromise,
  PROMISE_RESPONSE_SCHEMA,
  promiseTitle,
  rulePromises,
  samePromise,
  todayIso,
  type Promise_,
  type PromiseContextMessage,
} from "@ecosaude/core/crm";
import { and, asc, desc, eq, isNull, lt, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";
import { logEvent } from "../journey";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * LEMBRAR O QUE FICOU PROMETIDO (fila + plano B)
 *
 *  1. Ao ENVIAR uma mensagem ou nota (ou ao RECEBER do paciente, se a clínica ligou
 *     "lembrar também o que o paciente ficou de fazer"): filtro barato
 *     (mayHavePromise). Sem jeito de compromisso, nada acontece (custo zero).
 *  2. Com IA disponível, a mensagem entra na fila (ai_promises "pendente") e é lida
 *     LOGO DEPOIS (after) ou na rotina de 10 min, FORA da transação.
 *     Sem IA (sem chave, conversa com sinal de urgência), as regras leem na hora.
 *  3. PLANO B: IA instável, lenta, resposta inválida ou certeza baixa = regras.
 *     Se as regras já acharam a promessa, ela vale na hora; se não acharam nada,
 *     falha passageira tenta de novo até 3 vezes (a IA pode achar o que a regra não vê).
 *  4. TAREFA: "Prometido a Rita: mandar o orçamento", para quem prometeu, no prazo
 *     dito (ou no prazo padrão). Sem repetir a mesma promessa ainda aberta.
 *  5. "Não era promessa" apaga a tarefa e conta como falso positivo (medição).
 * Nada é enviado ao paciente: são lembretes internos.
 */

const MAX_ATTEMPTS = 3;
type Cfg = Record<string, unknown> & { enabled: boolean };

interface Candidate {
  conversationId: string;
  messageId: string;
  text: string;
  /** Quem escreveu (null = paciente ou automação) */
  authorId: string | null;
  side: "clinica" | "paciente";
}

/**
 * PASSO 1 (na mesma transação do envio/entrada). Devolve true se a mensagem ficou
 * na fila da IA (quem chamou agenda o processamento com after()).
 */
export async function notePromiseCandidate(tx: Tx, c: Candidate): Promise<boolean> {
  const cfg = (await automationSettings(tx)).ia_promessas as Cfg | undefined;
  if (!cfg?.enabled) return false;
  if (c.side === "paciente" && cfg.lembrarPaciente !== true) return false;
  if (!mayHavePromise(c.text)) return false;

  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, c.conversationId), columns: { urgent: true } });
  const fallback = !aiConfigured() ? "IA não configurada no servidor" : conv?.urgent ? "conversa com sinal de urgência: fica no Tropi, sem IA" : null;
  if (!fallback) {
    await tx.insert(schema.aiPromises).values({ conversationId: c.conversationId, messageId: c.messageId, authorId: c.authorId, side: c.side });
    return true;
  }
  // Sem IA: as regras decidem já
  const promises = rulePromises(c.text, c.side, calendar());
  const taskIds = await createTasks(tx, cfg, c.conversationId, c.authorId, promises);
  await tx.insert(schema.aiPromises).values({
    conversationId: c.conversationId,
    messageId: c.messageId,
    authorId: c.authorId,
    side: c.side,
    status: "feita",
    source: "regras",
    fallbackReason: fallback,
    found: promises,
    taskIds,
    processedAt: new Date(),
  });
  return false;
}

const calendar = () => buildScheduleCalendar(todayIso(), 21);

/** Cria as tarefas (sem repetir promessa igual ainda aberta). Devolve os ids criados. */
async function createTasks(tx: Tx, cfg: Cfg, conversationId: string, authorId: string | null, promises: Promise_[]): Promise<string[]> {
  if (!promises.length) return [];
  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId), with: { contact: { columns: { id: true, name: true } } } });
  if (!conv) return [];
  const open = await tx
    .select({ title: schema.tasks.title })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.contactId, conv.contactId), eq(schema.tasks.kind, "promessa"), isNull(schema.tasks.doneAt)));
  const days = typeof cfg.prazoPadrao === "number" ? cfg.prazoPadrao : 1;
  const ids: string[] = [];
  for (const p of promises) {
    if (open.some((o) => samePromise(o.title, p.what))) continue;
    const title = promiseTitle(p, firstName(conv.contact.name));
    const dueDate = p.due ?? addDaysIso(todayIso(), days);
    // Promessa da clínica: para quem prometeu. Do paciente: para o responsável da conversa (quem cobra)
    const assigneeId = p.who === "clinica" ? (authorId ?? conv.assigneeId) : (conv.assigneeId ?? authorId);
    const [t] = await tx.insert(schema.tasks).values({ contactId: conv.contactId, title, dueDate, kind: "promessa", assigneeId, createdBy: authorId }).returning({ id: schema.tasks.id });
    ids.push(t!.id);
    open.push({ title });
    await logEvent(tx, { contactId: conv.contactId, actorId: authorId, type: "promise_task", data: { tarefa: title, prazo: dueDate } });
  }
  return ids;
}

/** PASSOS 2 a 4: lê a fila de uma clínica. */
export async function processPendingPromises(clinicId: string, limit = 20): Promise<{ ai: number; rules: number; tasks: number }> {
  const { jobs, cfg } = await withTenant(clinicId, async (tx) => {
    const cfg = (await automationSettings(tx)).ia_promessas as Cfg | undefined;
    const rows = await tx.select().from(schema.aiPromises).where(eq(schema.aiPromises.status, "pendente")).orderBy(asc(schema.aiPromises.createdAt)).limit(limit);
    const jobs: { row: typeof rows[number]; text: string; context: PromiseContextMessage[] }[] = [];
    for (const row of rows) {
      const msg = row.messageId ? await tx.query.messages.findFirst({ where: eq(schema.messages.id, row.messageId) }) : null;
      if (!msg) {
        await tx.update(schema.aiPromises).set({ status: "feita", processedAt: new Date(), fallbackReason: "mensagem apagada" }).where(eq(schema.aiPromises.id, row.id));
        continue;
      }
      const prev = await tx
        .select({ direction: schema.messages.direction, body: schema.messages.body })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, row.conversationId), lt(schema.messages.createdAt, msg.createdAt)))
        .orderBy(desc(schema.messages.createdAt))
        .limit(4);
      jobs.push({ row, text: msg.body, context: prev.reverse().map((m) => ({ from: m.direction === "in" ? "paciente" : m.direction === "note" ? "nota" : "clinica", text: m.body })) });
    }
    return { jobs, cfg };
  });

  let ai = 0;
  let rules = 0;
  let tasks = 0;
  const cal = calendar();
  for (const { row, text, context } of jobs) {
    const side = row.side === "paciente" ? "paciente" : "clinica";
    let result: { promises: Promise_[]; source: "ia" | "regras"; confidence: number | null; reason: string | null } | null = null;
    let retry = false;
    let meta: { model: string | null; latencyMs: number | null } = { model: null, latencyMs: null };
    if (!cfg?.enabled) result = { promises: [], source: "regras", confidence: null, reason: "desligada em Ajustes" };
    else if (!aiConfigured()) result = { promises: rulePromises(text, side, cal), source: "regras", confidence: null, reason: "IA não configurada no servidor" };
    else {
      try {
        const { system, user } = buildPromisePrompt({ message: text, who: side, context, calendar: cal });
        const out = await generate({ system, user, schema: PROMISE_RESPONSE_SCHEMA, temperature: 0 }, { task: "classify" });
        meta = { model: out.model, latencyMs: out.latencyMs };
        const checked = checkPromises(out.text, cal);
        const min = typeof cfg.confiancaMinima === "number" ? cfg.confiancaMinima : 70;
        if (!checked.ok) result = { promises: rulePromises(text, side, cal), source: "regras", confidence: null, reason: checked.reason };
        else if (checked.confidence < min) result = { promises: rulePromises(text, side, cal), source: "regras", confidence: checked.confidence, reason: `certeza da IA abaixo do mínimo (${checked.confidence}%)` };
        // Sem "lembrar o paciente", a IA pode achar promessa do paciente numa mensagem da clínica: fica de fora
        else result = { promises: checked.promises.filter((p) => p.who === "clinica" || cfg.lembrarPaciente === true), source: "ia", confidence: checked.confidence, reason: null };
      } catch (error) {
        const reason = error instanceof AiError ? error.reason : "falha inesperada na IA";
        // As regras já acharam a promessa: vale NA HORA (ninguém fica esperando a IA voltar).
        // Só tenta de novo quando as regras não acharam nada e a IA poderia achar.
        const byRules = rulePromises(text, side, cal);
        retry = error instanceof AiError && error.retryable && row.attempts + 1 < MAX_ATTEMPTS && byRules.length === 0;
        if (!retry) result = { promises: byRules, source: "regras", confidence: null, reason };
      }
    }

    await withTenant(clinicId, async (tx) => {
      if (retry || !result) {
        await tx.update(schema.aiPromises).set({ attempts: sql`${schema.aiPromises.attempts} + 1` }).where(eq(schema.aiPromises.id, row.id));
        return;
      }
      // Marca como feita ANTES de criar as tarefas: duas rotinas ao mesmo tempo não duplicam
      const claimed = await tx
        .update(schema.aiPromises)
        .set({ status: "feita", processedAt: new Date() })
        .where(and(eq(schema.aiPromises.id, row.id), eq(schema.aiPromises.status, "pendente")))
        .returning({ id: schema.aiPromises.id });
      if (!claimed.length) return;
      const taskIds = cfg?.enabled ? await createTasks(tx, cfg, row.conversationId, row.authorId, result.promises) : [];
      await tx
        .update(schema.aiPromises)
        .set({ source: result.source, confidence: result.confidence, model: meta.model, latencyMs: meta.latencyMs, fallbackReason: result.reason, found: result.promises, taskIds })
        .where(eq(schema.aiPromises.id, row.id));
      tasks += taskIds.length;
      if (result.source === "ia") ai++;
      else rules++;
    });
  }
  return { ai, rules, tasks };
}

/** "Não era promessa": apaga a tarefa (se ainda aberta) e conta como falso positivo. */
export async function undoPromiseTask(tx: Tx, actorId: string | null, taskId: string): Promise<boolean> {
  const [t] = await tx
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.kind, "promessa"), isNull(schema.tasks.doneAt)))
    .returning({ title: schema.tasks.title, contactId: schema.tasks.contactId });
  if (!t) return false;
  await tx
    .update(schema.aiPromises)
    .set({ undone: sql`${schema.aiPromises.undone} + 1` })
    .where(sql`${schema.aiPromises.taskIds} @> ${JSON.stringify([taskId])}::jsonb`);
  if (t.contactId) await logEvent(tx, { contactId: t.contactId, actorId, type: "promise_undone", data: { tarefa: t.title } });
  return true;
}

export interface PromiseView {
  id: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  /** Quem vai cumprir (primeiro nome) */
  assignee: string | null;
  source: "ia" | "regras" | null;
}

/** Promessas em aberto deste paciente e se há mensagem desta conversa na fila. */
export async function promisesForThread(tx: Tx, conversationId: string, contactId: string): Promise<{ items: PromiseView[]; pending: boolean }> {
  const rows = await tx.query.tasks.findMany({
    where: and(eq(schema.tasks.contactId, contactId), eq(schema.tasks.kind, "promessa"), isNull(schema.tasks.doneAt)),
    with: { assignee: { columns: { name: true } } },
    orderBy: asc(schema.tasks.dueDate),
    limit: 10,
  });
  const logs = await tx
    .select({ status: schema.aiPromises.status, source: schema.aiPromises.source, taskIds: schema.aiPromises.taskIds })
    .from(schema.aiPromises)
    .where(eq(schema.aiPromises.conversationId, conversationId))
    .orderBy(desc(schema.aiPromises.createdAt))
    .limit(40);
  const today = todayIso();
  return {
    pending: logs.some((l) => l.status === "pendente"),
    items: rows.map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      overdue: t.dueDate < today,
      assignee: t.assignee ? firstName(t.assignee.name) : null,
      source: (logs.find((l) => l.taskIds.includes(t.id))?.source as "ia" | "regras" | undefined) ?? null,
    })),
  };
}
