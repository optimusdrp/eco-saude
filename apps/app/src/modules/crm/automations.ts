import "server-only";
import { messagingWindow } from "@ecosaude/channels";
import { addDaysIso, fillTemplate, JOURNEY_STAGES, matchesFilter, RULE_TRIGGER_KEYS, todayIso, type JourneyStage, type RuleAction, type RuleCondition } from "@ecosaude/core/crm";
import { and, eq, gt, inArray, isNotNull, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { logEvent, setStage } from "./journey";
import { bestChannel, ensureConversation, queueOutbound, templateVars } from "./messaging";

/**
 * MOTOR DAS REGRAS DA CLÍNICA ("Quando → Se → Então")
 *
 *  1. triggerAutomations: chamado por logEvent (e pela entrada de mensagens).
 *     Procura regras LIGADAS com aquele gatilho, confere o filtro do evento
 *     (etapa, status, palavras, nota, canal) e coloca na fila automation_runs
 *     com a hora de executar (agora + espera).
 *  2. runDueAutomations: executa o que venceu. Roda logo depois de cada ação
 *     da equipe (runCrm), na entrada de mensagens e na rotina a cada 10 min.
 *     As CONDIÇÕES ("não tem consulta", "não respondeu") são conferidas na hora
 *     de executar, porque a situação pode ter mudado durante a espera.
 *
 * SEM LAÇO INFINITO: o que uma regra faz (mudar etapa, criar tarefa...) gera
 * eventos na trilha, mas esses eventos NÃO disparam outras regras.
 * Cada execução roda num ponto de salvamento: se uma falhar, as outras seguem.
 */

/** Transações (ou pontos de salvamento) que estão executando uma regra. */
const runningRule = new WeakSet<object>();

const TRIGGERS = new Set<string>(RULE_TRIGGER_KEYS);

export async function triggerAutomations(tx: Tx, e: { type: string; contactId?: string | null; data?: Record<string, unknown> | null }): Promise<void> {
  if (!TRIGGERS.has(e.type) || !e.contactId || runningRule.has(tx)) return;
  const rules = await tx
    .select({ id: schema.automationRules.id, filter: schema.automationRules.filter, delay: schema.automationRules.delayMinutes })
    .from(schema.automationRules)
    .where(and(eq(schema.automationRules.trigger, e.type), eq(schema.automationRules.enabled, true)));
  const data = e.data ?? {};
  let matching = rules.filter((r) => matchesFilter(r.filter, data));
  if (!matching.length) return;
  // Já existe uma execução ESPERANDO desta regra para este contato (ex.: o paciente
  // perguntou "valor" três vezes antes dos 2 dias): não enfileira de novo.
  const waiting = await tx
    .select({ ruleId: schema.automationRuns.ruleId })
    .from(schema.automationRuns)
    .where(
      and(
        eq(schema.automationRuns.contactId, e.contactId),
        eq(schema.automationRuns.status, "pendente"),
        inArray(
          schema.automationRuns.ruleId,
          matching.map((r) => r.id),
        ),
      ),
    );
  if (waiting.length) matching = matching.filter((r) => !waiting.some((w) => w.ruleId === r.id));
  if (!matching.length) return;
  const now = Date.now();
  await tx.insert(schema.automationRuns).values(matching.map((r) => ({ ruleId: r.id, contactId: e.contactId!, event: data, runAt: new Date(now + r.delay * 60_000) })));
}

/** Algo vencido na fila? (consulta barata, antes de abrir a execução) */
export async function hasDueAutomations(tx: Tx): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from automation_runs where status = 'pendente' and run_at <= clock_timestamp() limit 1`);
  return rows.rows.length > 0;
}

/**
 * Executa as regras vencidas de uma clínica. Devolve quantas rodaram.
 * FOR UPDATE SKIP LOCKED: duas execuções ao mesmo tempo nunca pegam a mesma linha.
 */
export async function runDueAutomations(scope: { clinicId: string; clinicName: string }, limit = 25): Promise<number> {
  return withTenant(scope.clinicId, async (tx) => {
    const due = await tx.execute<{ id: string }>(sql`
      select id from automation_runs
       where status = 'pendente' and run_at <= clock_timestamp()
       order by run_at
       limit ${limit}
       for update skip locked`);
    let done = 0;
    for (const { id } of due.rows) {
      try {
        await tx.transaction(async (sp) => {
          runningRule.add(sp);
          await executeRun(sp, scope.clinicName, id);
        });
        done++;
      } catch (error) {
        await tx
          .update(schema.automationRuns)
          .set({ status: "falhou", result: (error as Error).message.slice(0, 300), doneAt: new Date() })
          .where(eq(schema.automationRuns.id, id));
      }
    }
    return done;
  });
}

async function finish(tx: Tx, runId: string, status: "feita" | "ignorada", result: string) {
  await tx
    .update(schema.automationRuns)
    .set({ status, result: result.slice(0, 300), doneAt: new Date() })
    .where(eq(schema.automationRuns.id, runId));
}

async function executeRun(tx: Tx, clinicName: string, runId: string): Promise<void> {
  const [run] = await tx.select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runId));
  if (!run) return;
  const [rule] = await tx.select().from(schema.automationRules).where(eq(schema.automationRules.id, run.ruleId));
  if (!rule || !rule.enabled) return finish(tx, runId, "ignorada", "A regra foi desligada antes da hora de executar.");
  const contact = run.contactId ? await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, run.contactId) }) : undefined;
  if (!contact) return finish(tx, runId, "ignorada", "Contato não existe mais.");
  if (contact.anonymizedAt) return finish(tx, runId, "ignorada", "Dados apagados a pedido do paciente (LGPD).");

  if (rule.oncePerContact) {
    const [before] = await tx
      .select({ id: schema.automationRuns.id })
      .from(schema.automationRuns)
      .where(and(eq(schema.automationRuns.ruleId, rule.id), eq(schema.automationRuns.contactId, contact.id), eq(schema.automationRuns.status, "feita")))
      .limit(1);
    if (before) return finish(tx, runId, "ignorada", "Já executada antes para este contato.");
  }

  for (const c of rule.conditions) {
    const failed = await conditionFails(tx, c, contact, run.createdAt);
    if (failed) return finish(tx, runId, "ignorada", `Condição não atendida: ${failed}.`);
  }

  // Próxima consulta (para as variáveis {{data}}, {{hora}}, {{profissional}})
  const next = await tx.query.appointments.findFirst({
    where: and(eq(schema.appointments.contactId, contact.id), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])),
    with: { professional: { columns: { name: true } } },
    orderBy: (a, { asc }) => asc(a.startsAt),
  });
  const vars = templateVars(contact, clinicName, next ? { startsAt: next.startsAt, professionalName: next.professional.name } : undefined);

  const results: string[] = [];
  for (const action of rule.actions) results.push(await executeAction(tx, action, contact, vars, rule.name));

  await tx
    .update(schema.automationRules)
    .set({ runs: sql`${schema.automationRules.runs} + 1`, lastRunAt: new Date() })
    .where(eq(schema.automationRules.id, rule.id));
  await logEvent(tx, { contactId: contact.id, type: "automation_run", data: { regra: rule.name, regraId: rule.id, resultado: results.join("; ") } });
  await finish(tx, runId, "feita", results.join("; "));
}

type Contact = typeof schema.contacts.$inferSelect;

/** Devolve o motivo quando a condição NÃO é atendida (null = atendida). */
async function conditionFails(tx: Tx, c: RuleCondition, contact: Contact, since: Date): Promise<string | null> {
  const future = async () => {
    const [a] = await tx
      .select({ id: schema.appointments.id })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.contactId, contact.id), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])))
      .limit(1);
    return !!a;
  };
  const messagesSince = async (direction: "in" | "out") => {
    const [m] = await tx
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(
        and(
          eq(schema.conversations.contactId, contact.id),
          eq(schema.messages.direction, direction),
          gt(schema.messages.createdAt, since),
          // Resposta da equipe = mensagem com autor (as automáticas não contam)
          direction === "out" ? isNotNull(schema.messages.authorId) : undefined,
        ),
      )
      .limit(1);
    return !!m;
  };
  switch (c.type) {
    case "stage_in":
      return contact.stage === c.value ? null : "o contato está em outra etapa";
    case "has_tag":
      return c.value && contact.tags.includes(c.value) ? null : `não tem a etiqueta “${c.value ?? ""}”`;
    case "not_tag":
      return c.value && contact.tags.includes(c.value) ? `já tem a etiqueta “${c.value}”` : null;
    case "no_future_appointment":
      return (await future()) ? "já tem consulta marcada" : null;
    case "has_future_appointment":
      return (await future()) ? null : "não tem consulta marcada";
    case "patient_silent":
      return (await messagesSince("in")) ? "o paciente respondeu" : null;
    case "team_silent":
      return (await messagesSince("out")) ? "a equipe já respondeu" : null;
    default:
      return null;
  }
}

/** Executa uma ação e devolve o resumo em português (vai para o histórico). */
async function executeAction(tx: Tx, a: RuleAction, contact: Contact, vars: ReturnType<typeof templateVars>, ruleName: string): Promise<string> {
  const text = (t?: string) => fillTemplate(t ?? "", vars);
  switch (a.type) {
    case "send_message": {
      if (contact.optedOutAt) return "mensagem não enviada (o paciente pediu SAIR)";
      const body = text(a.text);
      if (!body) return "mensagem vazia";
      const channel = await bestChannel(tx, contact.id);
      if (!channel) return "mensagem não enviada (sem canal para alcançar o paciente)";
      const conv = await ensureConversation(tx, contact.id, channel);
      // Fora da janela de 24h só sai como modelo aprovado (regra da Meta)
      if (!a.approved && !messagingWindow(channel, conv.lastInboundAt).open) return "mensagem não enviada (fora da janela de 24h; marque “modelo aprovado”)";
      await queueOutbound(tx, { conversation: conv, body, authorId: null, templateKey: a.approved ? "regra" : null, meta: { kind: "automation", automation: "regra", regra: ruleName } });
      return "mensagem enviada";
    }
    case "create_task": {
      const assigneeId = await resolveAssignee(tx, a.assignee, contact);
      await tx.insert(schema.tasks).values({
        contactId: contact.id,
        title: text(a.text).slice(0, 200) || `Acompanhar ${contact.name}`,
        dueDate: addDaysIso(todayIso(), Math.max(0, Math.min(60, a.dueInDays ?? 0))),
        assigneeId,
        kind: "regra",
      });
      return "tarefa criada";
    }
    case "move_stage": {
      if (!a.stage || !JOURNEY_STAGES.includes(a.stage as JourneyStage)) return "etapa inválida";
      const moved = await setStage(tx, contact.id, a.stage as JourneyStage, { actorId: null, auto: true, reason: a.stage === "perdido" ? `Regra: ${ruleName}` : null });
      return moved ? "etapa alterada" : "já estava na etapa";
    }
    case "add_tag":
    case "remove_tag": {
      const tag = (a.tag ?? "").trim().toLowerCase().slice(0, 40);
      if (!tag) return "etiqueta vazia";
      await tx
        .update(schema.contacts)
        .set({
          tags: a.type === "add_tag" ? sql`array(select distinct unnest(${schema.contacts.tags} || array[${tag}]::text[]))` : sql`array_remove(${schema.contacts.tags}, ${tag})`,
        })
        .where(eq(schema.contacts.id, contact.id));
      return a.type === "add_tag" ? `etiqueta “${tag}”` : `etiqueta “${tag}” retirada`;
    }
    case "set_owner": {
      const ownerId = await resolveAssignee(tx, a.assignee, contact);
      if (!ownerId) return "responsável não encontrado";
      await tx.update(schema.contacts).set({ ownerId }).where(eq(schema.contacts.id, contact.id));
      return "responsável definido";
    }
    case "reopen_conversation":
    case "internal_note": {
      const [conv] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.contactId, contact.id))
        .orderBy(sql`${schema.conversations.lastMessageAt} desc nulls last`)
        .limit(1);
      if (!conv) return "sem conversa";
      if (a.type === "internal_note") {
        await tx
          .insert(schema.messages)
          .values({ conversationId: conv.id, channel: conv.channel, direction: "note", body: `${text(a.text)} (regra: ${ruleName})`, status: "entregue", authorId: null });
        return "nota na conversa";
      }
      await tx
        .update(schema.conversations)
        .set({ status: "aberta", awaitingReplySince: sql`coalesce(${schema.conversations.awaitingReplySince}, now())`, snoozedUntil: null })
        .where(eq(schema.conversations.id, conv.id));
      return "conversa devolvida para a equipe";
    }
    default:
      return "ação desconhecida";
  }
}

/** "owner" = responsável do contato; um id = aquela pessoa (se ativa); senão, ninguém. */
async function resolveAssignee(tx: Tx, assignee: string | undefined, contact: Contact): Promise<string | null> {
  const id = assignee === "owner" ? contact.ownerId : assignee;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [u] = await tx
    .select({ id: schema.clinicUsers.id })
    .from(schema.clinicUsers)
    .where(and(eq(schema.clinicUsers.id, id), eq(schema.clinicUsers.active, true)));
  return u?.id ?? null;
}
