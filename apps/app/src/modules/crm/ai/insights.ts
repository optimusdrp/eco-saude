import "server-only";
import { messagingWindow } from "@ecosaude/channels";
import {
  buildDuplicatePrompt,
  buildNextStepPrompt,
  checkDuplicate,
  checkNextDraft,
  daysBetween,
  DUPLICATE_SCHEMA,
  firstName,
  formatWhen,
  LOSS_CATEGORIES,
  LOSS_LABEL,
  NEXT_STEP_SCHEMA,
  nextStep,
  ruleDuplicateVerdict,
  ruleNextDraft,
  type DuplicateOpinion,
  type DuplicateSignals,
  type LossCategory,
  type NextStepKind,
} from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, inArray, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { automationSettings } from "../automation-settings";
import { bestTimesFor } from "../ml/best-time";
import { aiConfigured, AiError, generate } from "./provider";

/**
 * INSIGHTS DE RELACIONAMENTO (dados do servidor)
 *  - lossReport: motivos de perda organizados dos últimos 90 dias (Jornada).
 *  - nextStepDraft: o próximo passo de UM contato + rascunho (IA ou regras).
 *  - duplicateOpinions: opinião sobre pares de duplicados (cache; IA só nos difíceis).
 *  - suggestionsFor: sugestões pendentes para a ficha e etiquetas.
 */

/* ----------------------------- Motivos da perda ---------------------------- */

export interface LossGroup {
  category: LossCategory;
  label: string;
  n: number;
  /** Até 2 trechos recentes (o que os pacientes disseram) */
  quotes: string[];
}

export async function lossReport(tx: Tx): Promise<{ total: number; groups: LossGroup[] }> {
  const rows = await tx
    .select({ category: schema.lossReasons.category, quote: schema.lossReasons.quote, contactId: schema.lossReasons.contactId, lostAt: schema.lossReasons.lostAt })
    .from(schema.lossReasons)
    .where(sql`${schema.lossReasons.lostAt} > now() - interval '90 days'`)
    .orderBy(desc(schema.lossReasons.createdAt));
  // Uma linha por contato (a mais recente)
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.contactId)) latest.set(r.contactId, r);
  const list = [...latest.values()];
  const groups = LOSS_CATEGORIES.map((c) => {
    const of = list.filter((r) => r.category === c);
    return {
      category: c,
      label: LOSS_LABEL[c],
      n: of.length,
      quotes: of
        .map((r) => r.quote)
        .filter((q): q is string => !!q)
        .slice(0, 2),
    };
  })
    .filter((g) => g.n > 0)
    .sort((a, b) => b.n - a.n);
  return { total: list.length, groups };
}

/* ------------------------------ Próximo passo ------------------------------ */

export interface NextStepDraftView {
  kind: NextStepKind;
  title: string;
  text: string;
  source: "ia" | "regras";
  reason: string | null;
  conversationId: string | null;
  /** A mensagem livre pode sair agora (janela de 24h aberta) */
  windowOpen: boolean;
  /** Melhor horário deste paciente (Ajustes > IA), se ligado */
  best: { label: string; when: string; at: string } | null;
}

export async function planNextStep(tx: Tx, contactId: string, clinicName: string) {
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) });
  if (!contact) throw new UserError("Contato não encontrado.");
  const auto = await automationSettings(tx);
  const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.contactId, contactId), orderBy: (c, { desc }) => [desc(c.lastMessageAt)] });
  const msgs = conv
    ? await tx
        .select({ direction: schema.messages.direction, body: schema.messages.body, at: schema.messages.createdAt })
        .from(schema.messages)
        .where(and(eq(schema.messages.conversationId, conv.id), inArray(schema.messages.direction, ["in", "out"])))
        .orderBy(desc(schema.messages.createdAt))
        .limit(10)
    : [];
  const next = await tx.query.appointments.findFirst({
    where: and(eq(schema.appointments.contactId, contactId), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])),
    orderBy: asc(schema.appointments.startsAt),
  });
  const now = new Date();
  const last = msgs[0];
  const step = nextStep(
    {
      stage: contact.stage,
      firstName: firstName(contact.name),
      waiting: !!conv?.awaitingReplySince && conv.status === "aberta",
      waitingHours: conv?.awaitingReplySince ? (now.getTime() - conv.awaitingReplySince.getTime()) / 3_600_000 : 0,
      lastFrom: last ? (last.direction === "in" ? "paciente" : "clinica") : null,
      daysSinceLast: last ? daysBetween(last.at, now) : null,
      next: next ? { inHours: (next.startsAt.getTime() - now.getTime()) / 3_600_000, confirmed: next.status === "confirmado" } : null,
      askedPrice: msgs.some((m) => m.direction === "in" && /quanto (custa|fica)|valor|pre[cç]o|or[cç]amento/i.test(m.body)),
      daysSinceVisit: contact.lastVisitAt ? daysBetween(contact.lastVisitAt, now) : null,
      daysInStage: daysBetween(contact.stageChangedAt, now),
      canMarket: contact.consentMarketing && !contact.optedOutAt,
    },
    Number(auto.ia_proximo_passo?.diasSemResposta) || 2,
  );
  if (!step) throw new UserError("Nada pendente para este contato agora.");
  const best = (await bestTimesFor(tx, [contactId])).get(contactId);
  return {
    step,
    contact,
    conv,
    clinicName,
    messages: msgs.reverse().map((m) => ({ from: m.direction === "in" ? ("paciente" as const) : ("clinica" as const), text: m.body })),
    aiOn: !!auto.ia_proximo_passo?.enabled,
    best: best ? { label: best.label, when: formatWhen(best.at, now), at: best.at.toISOString() } : null,
  };
}

/** Rascunho (IA fora de transação; plano B = texto pronto das regras) */
export async function draftNextStep(plan: Awaited<ReturnType<typeof planNextStep>>): Promise<NextStepDraftView> {
  const name = firstName(plan.contact.name);
  const base: NextStepDraftView = {
    kind: plan.step.kind,
    title: plan.step.title,
    text: ruleNextDraft(plan.step.kind, name, plan.clinicName),
    source: "regras",
    reason: null,
    conversationId: plan.conv?.id ?? null,
    windowOpen: plan.conv ? messagingWindow(plan.conv.channel, plan.conv.lastInboundAt).open : false,
    best: plan.best,
  };
  if (!plan.aiOn) return { ...base, reason: "IA desligada em Ajustes" };
  if (!aiConfigured()) return { ...base, reason: "IA não configurada no servidor" };
  if (plan.conv?.urgent) return { ...base, reason: "conversa com sinal de urgência: responda pessoalmente" };
  try {
    const { system, user } = buildNextStepPrompt({ kind: plan.step.kind, title: plan.step.title, firstName: name, clinicName: plan.clinicName, messages: plan.messages });
    const out = await generate({ system, user, schema: NEXT_STEP_SCHEMA, temperature: 0.4 });
    const checked = checkNextDraft(out.text, plan.messages.map((m) => m.text).join(" "));
    return checked.ok ? { ...base, text: checked.text, source: "ia" } : { ...base, reason: checked.reason };
  } catch (error) {
    return { ...base, reason: error instanceof AiError ? error.reason : "falha inesperada na IA" };
  }
}

/* -------------------------------- Duplicados ------------------------------- */

export interface DuplicateOpinionView extends DuplicateOpinion {
  source: "ia" | "regras";
}

type PairIn = {
  a: { id: string; name: string; email: string | null; phone: string | null; birthDate: string | null };
  b: { id: string; name: string; email: string | null; phone: string | null; birthDate: string | null };
};

const signalsOf = (p: PairIn): DuplicateSignals => {
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-8);
  return {
    nameA: p.a.name,
    nameB: p.b.name,
    sameEmail: !!p.a.email && p.a.email.trim().toLowerCase() === p.b.email?.trim().toLowerCase(),
    samePhone: !!p.a.phone && digits(p.a.phone).length === 8 && digits(p.a.phone) === digits(p.b.phone),
    sameBirth: p.a.birthDate && p.b.birthDate ? p.a.birthDate === p.b.birthDate : null,
  };
};

/** Opiniões guardadas (sem chamar a IA). Pares sem opinião recebem a das regras. */
export async function duplicateOpinions(tx: Tx, pairs: PairIn[]): Promise<Map<string, DuplicateOpinionView>> {
  const out = new Map<string, DuplicateOpinionView>();
  if (!pairs.length) return out;
  const saved = await tx
    .select()
    .from(schema.duplicateReviews)
    .where(
      inArray(
        schema.duplicateReviews.contactA,
        pairs.map((p) => p.a.id),
      ),
    );
  for (const p of pairs) {
    const key = `${p.a.id}|${p.b.id}`;
    const s = saved.find((r) => r.contactA === p.a.id && r.contactB === p.b.id);
    out.set(key, s ? { verdict: s.verdict as DuplicateOpinion["verdict"], reason: s.reason, source: s.source as "ia" | "regras" } : { ...ruleDuplicateVerdict(signalsOf(p)), source: "regras" });
  }
  return out;
}

/** Pede a opinião da IA para um par (sob demanda). Plano B: as regras. */
export async function askDuplicateOpinion(p: PairIn): Promise<{ opinion: DuplicateOpinionView; confidence: number | null; model: string | null; reason: string | null }> {
  const sig = signalsOf(p);
  const rules = { ...ruleDuplicateVerdict(sig), source: "regras" as const };
  if (!aiConfigured()) return { opinion: rules, confidence: null, model: null, reason: "IA não configurada no servidor" };
  try {
    const { system, user } = buildDuplicatePrompt(sig);
    const out = await generate({ system, user, schema: DUPLICATE_SCHEMA, temperature: 0 }, { task: "classify" });
    const checked = checkDuplicate(out.text, sig);
    if (!checked.ok) return { opinion: rules, confidence: null, model: out.model, reason: checked.reason };
    if (checked.confidence < 60) return { opinion: rules, confidence: checked.confidence, model: out.model, reason: `certeza da IA baixa (${checked.confidence}%)` };
    return { opinion: { ...checked.opinion, source: "ia" }, confidence: checked.confidence, model: out.model, reason: null };
  } catch (error) {
    return { opinion: rules, confidence: null, model: null, reason: error instanceof AiError ? error.reason : "falha inesperada na IA" };
  }
}

/* ---------------------------- Sugestões da ficha --------------------------- */

export interface SuggestionView {
  id: string;
  kind: "campo" | "etiqueta";
  field: string;
  value: string;
  evidence: string | null;
  source: "ia" | "regras";
}

export async function suggestionsFor(tx: Tx, contactId: string): Promise<{ items: SuggestionView[]; pending: boolean }> {
  const rows = await tx
    .select()
    .from(schema.contactSuggestions)
    .where(and(eq(schema.contactSuggestions.contactId, contactId), eq(schema.contactSuggestions.status, "pendente")))
    .orderBy(asc(schema.contactSuggestions.createdAt))
    .limit(12);
  const [job] = await tx
    .select({ id: schema.aiJobs.id })
    .from(schema.aiJobs)
    .where(and(eq(schema.aiJobs.contactId, contactId), eq(schema.aiJobs.status, "pendente"), inArray(schema.aiJobs.kind, ["cadastro", "etiquetas"])))
    .limit(1);
  return { items: rows.map((r) => ({ id: r.id, kind: r.kind as "campo" | "etiqueta", field: r.field, value: r.value, evidence: r.evidence, source: r.source as "ia" | "regras" })), pending: !!job };
}
