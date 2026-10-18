import "server-only";
import { messagingWindow } from "@ecosaude/channels";
import {
  buildLossPrompt,
  buildProfilePrompt,
  buildReturnPrompt,
  buildTagsPrompt,
  checkLoss,
  checkProfile,
  checkReturnMessage,
  checkTags,
  firstName,
  isPriceAsk,
  LOSS_SCHEMA,
  PROFILE_SCHEMA,
  RETURN_SCHEMA,
  ruleLossReason,
  ruleProfile,
  ruleTags,
  TAGS_SCHEMA,
  todayIso,
  utcToZoned,
  type LossVerdict,
  type ProfileSuggestion,
  type ReturnLimits,
  type TagSuggestion,
} from "@ecosaude/core/crm";
import { and, asc, db, desc, eq, inArray, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { automationSettings } from "../automation-settings";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * FILA DE TRABALHOS DA IA (cadastro, etiquetas, perda, retorno)
 *
 * Todos seguem o mesmo desenho:
 *   1. queueAiJob (dentro da transação que gerou o evento): só registra o pedido.
 *   2. processAiJobs (after() logo depois, e rotina de 10 min): lê os dados, chama a
 *      IA FORA da transação, confere e grava. Falha passageira tenta até 3 vezes.
 *   3. PLANO B em todos: as regras do CRM dão o resultado (ou, no retorno, vai o texto
 *      da clínica que já está na fila).
 * Sugestões de cadastro e etiquetas NÃO alteram a ficha: a equipe aplica.
 */

type Kind = "cadastro" | "etiquetas" | "perda" | "retorno";
const MAX_ATTEMPTS = 3;
const FEATURE: Record<Kind, string> = { cadastro: "ia_cadastro", etiquetas: "ia_etiquetas", perda: "ia_motivo_perda", retorno: "ia_retorno" };

/** Registra o pedido (sem repetir um pendente igual, exceto retorno, que é por mensagem). */
export async function queueAiJob(tx: Tx, kind: Kind, contactId: string, messageId?: string): Promise<boolean> {
  const cfg = (await automationSettings(tx))[FEATURE[kind]];
  if (!cfg?.enabled) return false;
  if (kind !== "retorno") {
    const [pending] = await tx
      .select({ id: schema.aiJobs.id })
      .from(schema.aiJobs)
      // Só junta com pedido AINDA NÃO INICIADO: um pedido já em andamento leu as mensagens
      // antes desta; juntar perderia o dado novo ("a Carla me indicou" chegando no meio).
      .where(and(eq(schema.aiJobs.kind, kind), eq(schema.aiJobs.contactId, contactId), eq(schema.aiJobs.status, "pendente"), eq(schema.aiJobs.attempts, 0)))
      .limit(1);
    if (pending) return true;
  }
  await tx.insert(schema.aiJobs).values({ kind, contactId, messageId: messageId ?? null });
  return true;
}

interface Outcome {
  source: "ia" | "regras";
  model?: string | null;
  reason?: string | null;
  /** Falha passageira: tentar de novo depois */
  retry?: boolean;
}

/** Chamada à IA com o tratamento padrão de erro. */
async function ask(system: string, user: string, schemaDef: object, task: "draft" | "classify" = "classify"): Promise<{ text: string; model: string } | { error: string; retry: boolean }> {
  if (!aiConfigured()) return { error: "IA não configurada no servidor", retry: false };
  try {
    const out = await generate({ system, user, schema: schemaDef, temperature: 0.2 }, { task });
    return { text: out.text, model: out.model };
  } catch (error) {
    return error instanceof AiError ? { error: error.reason, retry: error.retryable } : { error: "falha inesperada na IA", retry: false };
  }
}

/* ------------------------------ Mensagens ---------------------------------- */

async function patientTexts(tx: Tx, contactId: string, limit = 40): Promise<string[]> {
  const rows = await tx
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(eq(schema.conversations.contactId, contactId), eq(schema.messages.direction, "in")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => r.body);
}

/* -------------------------------- Cadastro --------------------------------- */

async function runCadastro(clinicId: string, contactId: string, attempts: number): Promise<Outcome> {
  const { contact, texts } = await withTenant(clinicId, async (tx) => ({
    contact: await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) }),
    texts: (await patientTexts(tx, contactId, 20)).filter((t) => t !== "[áudio]"),
  }));
  if (!contact || !texts.length) return { source: "regras", reason: "sem mensagens" };
  const rules = ruleProfile(texts);
  let ai: ProfileSuggestion[] | null = null;
  let outcome: Outcome = { source: "regras" };
  const { system, user } = buildProfilePrompt(texts, todayIso());
  const r = await ask(system, user, PROFILE_SCHEMA);
  if ("error" in r) {
    if (r.retry && attempts + 1 < MAX_ATTEMPTS) return { source: "regras", retry: true, reason: r.error };
    outcome = { source: "regras", reason: r.error };
  } else {
    const checked = checkProfile(r.text, texts);
    if (checked.ok) {
      ai = checked.suggestions;
      outcome = { source: "ia", model: r.model };
    } else outcome = { source: "regras", model: r.model, reason: checked.reason };
  }
  // E-mail sempre pela regra; os outros campos: IA quando ela achou, senão a regra
  const merged: (ProfileSuggestion & { source: "ia" | "regras" })[] = [];
  for (const field of ["email", "birthDate", "insurance", "referredBy"] as const) {
    const fromAi = field === "email" ? undefined : ai?.find((s) => s.field === field);
    const fromRule = rules.find((s) => s.field === field);
    const pick = fromAi ? { ...fromAi, source: "ia" as const } : fromRule ? { ...fromRule, source: "regras" as const } : null;
    if (pick) merged.push(pick);
  }
  const current: Record<string, string | null> = { email: contact.email, birthDate: contact.birthDate, insurance: contact.insurance, referredBy: contact.referredBy };
  const fresh = merged.filter((s) => (current[s.field] ?? "").toLowerCase() !== s.value.toLowerCase());
  if (fresh.length) {
    await withTenant(clinicId, (tx) =>
      tx
        .insert(schema.contactSuggestions)
        .values(fresh.map((s) => ({ contactId, kind: "campo", field: s.field, value: s.value, evidence: s.quote, source: s.source })))
        .onConflictDoNothing(),
    );
  }
  return outcome;
}

/* -------------------------------- Etiquetas -------------------------------- */

async function runEtiquetas(clinicId: string, contactId: string, attempts: number): Promise<Outcome> {
  const data = await withTenant(clinicId, async (tx) => {
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) });
    if (!contact) return null;
    const texts = await patientTexts(tx, contactId, 100);
    const visits = await tx
      .select({ status: schema.appointments.status, startsAt: schema.appointments.startsAt })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.contactId, contactId), inArray(schema.appointments.status, ["compareceu", "faltou"])));
    // Indicações: cadastros cujo "indicado por" traz o nome completo (2 primeiras palavras) deste paciente
    const key = contact.name.trim().split(/\s+/).slice(0, 2).join(" ");
    const [ref] = key.includes(" ")
      ? await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.contacts)
          .where(sql`${schema.contacts.referredBy} ilike ${`%${key}%`} and ${schema.contacts.id} <> ${contactId}`)
      : [{ n: 0 }];
    return { contact, texts, visits, referrals: ref?.n ?? 0 };
  });
  if (!data) return { source: "regras", reason: "contato não encontrado" };
  const texts = data.texts.filter((t) => t !== "[áudio]");
  const attendedVisits = data.visits.filter((v) => v.status === "compareceu");
  const stats = {
    textIn: texts.length,
    audioIn: data.texts.length - texts.length,
    priceAsks: texts.filter(isPriceAsk).length,
    referrals: data.referrals,
    attended: attendedVisits.length,
    noShows: data.visits.length - attendedVisits.length,
    morningVisits: attendedVisits.filter((v) => utcToZoned(v.startsAt).minutes < 12 * 60).length,
    afternoonVisits: attendedVisits.filter((v) => utcToZoned(v.startsAt).minutes >= 12 * 60).length,
    avgWords: texts.length ? texts.reduce((s, t) => s + t.split(/\s+/).filter(Boolean).length, 0) / texts.length : 0,
  };
  const out: (TagSuggestion & { source: "ia" | "regras" })[] = ruleTags(stats, data.contact.tags).map((t) => ({ ...t, source: "regras" }));
  let outcome: Outcome = { source: "regras" };
  if (texts.length >= 3) {
    const { system, user } = buildTagsPrompt(texts);
    const r = await ask(system, user, TAGS_SCHEMA);
    if ("error" in r) {
      if (r.retry && attempts + 1 < MAX_ATTEMPTS) return { source: "regras", retry: true, reason: r.error };
      outcome = { source: "regras", reason: r.error };
    } else {
      const checked = checkTags(r.text, texts, data.contact.tags);
      if (checked.ok) {
        for (const t of checked.tags) if (!out.some((o) => o.tag === t.tag)) out.push({ ...t, source: "ia" });
        outcome = { source: "ia", model: r.model };
      } else outcome = { source: "regras", model: r.model, reason: checked.reason };
    }
  }
  if (out.length) {
    await withTenant(clinicId, (tx) =>
      tx
        .insert(schema.contactSuggestions)
        .values(out.map((t) => ({ contactId, kind: "etiqueta", field: t.tag, value: t.tag, evidence: t.evidence, source: t.source })))
        .onConflictDoNothing(),
    );
  }
  return outcome;
}

/* ---------------------------------- Perda ---------------------------------- */

async function runPerda(clinicId: string, contactId: string, attempts: number): Promise<Outcome> {
  const data = await withTenant(clinicId, async (tx) => {
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) });
    if (!contact || contact.stage !== "perdido") return null;
    const msgs = await tx
      .select({ direction: schema.messages.direction, body: schema.messages.body, at: schema.messages.createdAt })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(and(eq(schema.conversations.contactId, contactId), inArray(schema.messages.direction, ["in", "out"])))
      .orderBy(desc(schema.messages.createdAt))
      .limit(15);
    return { contact, msgs: msgs.reverse() };
  });
  if (!data) return { source: "regras", reason: "não está mais em Perdido" };
  const messages = data.msgs.map((m) => ({ from: m.direction === "in" ? ("paciente" as const) : ("clinica" as const), text: m.body }));
  const lastIn = [...data.msgs].reverse().find((m) => m.direction === "in");
  const input = {
    patientTexts: messages.filter((m) => m.from === "paciente").map((m) => m.text),
    staffReason: data.contact.lostReason,
    lastFromClinic: data.msgs[data.msgs.length - 1]?.direction === "out",
    daysSilent: lastIn ? Math.floor((Date.now() - lastIn.at.getTime()) / 86_400_000) : null,
  };
  let verdict: LossVerdict = ruleLossReason(input);
  let outcome: Outcome = { source: "regras" };
  let confidence: number | null = null;
  if (messages.length || input.staffReason) {
    const { system, user } = buildLossPrompt({ ...input, messages });
    const r = await ask(system, user, LOSS_SCHEMA);
    if ("error" in r) {
      if (r.retry && attempts + 1 < MAX_ATTEMPTS) return { source: "regras", retry: true, reason: r.error };
      outcome = { source: "regras", reason: r.error };
    } else {
      const source = [input.staffReason ?? "", ...messages.map((m) => m.text)].join(" \n ");
      const checked = checkLoss(r.text, source);
      if (checked.ok && checked.confidence >= 60) {
        verdict = checked.verdict;
        confidence = checked.confidence;
        outcome = { source: "ia", model: r.model };
      } else outcome = { source: "regras", model: r.model, reason: checked.ok ? `certeza da IA baixa (${checked.confidence}%)` : checked.reason };
    }
  }
  await withTenant(clinicId, (tx) =>
    tx.insert(schema.lossReasons).values({ contactId, category: verdict.category, quote: verdict.quote, source: outcome.source, confidence, lostAt: data.contact.stageChangedAt }),
  );
  return outcome;
}

/* --------------------------------- Retorno --------------------------------- */

async function runRetorno(clinicId: string, contactId: string, messageId: string | null, attempts: number): Promise<Outcome> {
  if (!messageId) return { source: "regras", reason: "sem mensagem" };
  const data = await withTenant(clinicId, async (tx) => {
    const cfg = (await automationSettings(tx)).ia_retorno;
    const msg = await tx.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    if (!msg || msg.status !== "fila") return null;
    const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, msg.conversationId), with: { contact: true } });
    const visits = await tx.query.appointments.findMany({
      where: and(eq(schema.appointments.contactId, contactId), eq(schema.appointments.status, "compareceu")),
      with: { professional: { columns: { name: true } } },
      orderBy: desc(schema.appointments.startsAt),
      limit: 20,
    });
    return { cfg, msg, conv, visits };
  });
  // Nome da clínica: tabela da plataforma (fora do isolamento por clínica), consulta direta pelo id
  const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.id, clinicId), columns: { tradeName: true } });
  if (!data || !data.conv) return { source: "regras", reason: "mensagem já enviada ou removida" };
  // Regra da Meta: fora da janela de 24h só sai o modelo APROVADO, com o texto exato
  const sendAt = data.msg.sendAfter ?? new Date();
  const w = messagingWindow(data.conv.channel, data.conv.lastInboundAt, sendAt);
  if (!w.open) return { source: "regras", reason: "fora da janela de 24h do canal: vai o modelo aprovado" };

  const limits: ReturnLimits = {
    maxChars: typeof data.cfg?.maxCaracteres === "number" ? data.cfg.maxCaracteres : 320,
    tone: data.cfg?.tom === "objetivo" || data.cfg?.tom === "formal" ? data.cfg.tom : "acolhedor",
    mentionProcedure: data.cfg?.citarProcedimento !== false,
  };
  const last = data.visits[0];
  const ctx = {
    clinicName: clinic?.tradeName ?? "a clínica",
    firstName: firstName(data.conv.contact.name),
    baseText: data.msg.body,
    lastProcedure: last?.service ?? null,
    monthsSinceVisit: last ? Math.max(1, Math.round((Date.now() - last.startsAt.getTime()) / (30 * 86_400_000))) : 0,
    visits: data.visits.length,
    professional: last?.professional.name ?? null,
  };
  const { system, user } = buildReturnPrompt(ctx, limits);
  const r = await ask(system, user, RETURN_SCHEMA, "draft");
  if ("error" in r) return r.retry && attempts + 1 < MAX_ATTEMPTS ? { source: "regras", retry: true, reason: r.error } : { source: "regras", reason: r.error };
  const checked = checkReturnMessage(r.text, ctx, limits);
  if (!checked.ok) return { source: "regras", model: r.model, reason: checked.reason };
  // Só troca se a mensagem ainda não saiu (o envio pode ter acontecido no meio)
  const updated = await withTenant(clinicId, (tx) =>
    tx
      .update(schema.messages)
      .set({ body: checked.text, meta: sql`coalesce(${schema.messages.meta}, '{}'::jsonb) || ${JSON.stringify({ personalizedBy: "ia", originalBody: data.msg.body })}::jsonb` })
      .where(and(eq(schema.messages.id, messageId), eq(schema.messages.status, "fila")))
      .returning({ id: schema.messages.id }),
  );
  return updated.length ? { source: "ia", model: r.model } : { source: "regras", reason: "a mensagem já tinha saído" };
}

/* ------------------------------- Processador ------------------------------- */

export async function processAiJobs(clinicId: string, limit = 20): Promise<{ done: number; ai: number }> {
  const jobs = await withTenant(clinicId, (tx) => tx.select().from(schema.aiJobs).where(eq(schema.aiJobs.status, "pendente")).orderBy(asc(schema.aiJobs.createdAt)).limit(limit));
  let done = 0;
  let ai = 0;
  for (const job of jobs) {
    // Marca como em andamento (evita duas rotinas no mesmo pedido)
    const claimed = await withTenant(clinicId, (tx) =>
      tx
        .update(schema.aiJobs)
        .set({ attempts: sql`${schema.aiJobs.attempts} + 1` })
        .where(and(eq(schema.aiJobs.id, job.id), eq(schema.aiJobs.status, "pendente"), eq(schema.aiJobs.attempts, job.attempts)))
        .returning({ id: schema.aiJobs.id }),
    );
    if (!claimed.length) continue;
    let out: Outcome;
    try {
      out =
        job.kind === "cadastro"
          ? await runCadastro(clinicId, job.contactId, job.attempts)
          : job.kind === "etiquetas"
            ? await runEtiquetas(clinicId, job.contactId, job.attempts)
            : job.kind === "perda"
              ? await runPerda(clinicId, job.contactId, job.attempts)
              : await runRetorno(clinicId, job.contactId, job.messageId, job.attempts);
    } catch (error) {
      console.error("[trabalho IA]", job.kind, error);
      out = { source: "regras", reason: "falha inesperada" };
    }
    if (out.retry) continue; // fica pendente para a próxima rodada
    await withTenant(clinicId, (tx) =>
      tx
        .update(schema.aiJobs)
        .set({ status: "feita", source: out.source, model: out.model ?? null, fallbackReason: out.reason ?? null, processedAt: new Date() })
        .where(eq(schema.aiJobs.id, job.id)),
    );
    done++;
    if (out.source === "ia") ai++;
  }
  return { done, ai };
}
