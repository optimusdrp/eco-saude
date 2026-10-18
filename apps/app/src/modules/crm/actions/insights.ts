"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { eq, schema, sql } from "@ecosaude/db";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { queueAiJob } from "../ai/jobs";
import { askDuplicateOpinion, draftNextStep, planNextStep, type DuplicateOpinionView, type NextStepDraftView } from "../ai/insights";
import { runAiQueues } from "../ai/queue";
import { automationSettings } from "../automation-settings";
import { logEvent } from "../journey";
import { queueOutbound } from "../messaging";
import { runCrm } from "../run";

/**
 * AÇÕES DOS INSIGHTS COM IA
 *  - nextStepDraftAction / sendNextStepAction: rascunho do próximo passo e envio
 *    (agora ou no melhor horário do paciente). Quem envia é sempre a pessoa.
 *  - applySuggestionAction / dismissSuggestionAction: sugestões para a ficha e etiquetas.
 *  - analyzeContactAction: pede nova análise de cadastro e etiquetas.
 *  - duplicateOpinionAction: opinião da IA sobre um par de possíveis duplicados.
 */

export async function nextStepDraftAction(contactId: string): Promise<{ ok: true; draft: NextStepDraftView } | { ok: false; message: string }> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return { ok: false, message: "Você não tem permissão para responder." };
  if (!z.uuid().safeParse(contactId).success) return { ok: false, message: "Contato inválido." };
  try {
    const plan = await runCrm(ctx, (tx, scope) => planNextStep(tx, contactId, scope.clinicName));
    // IA fora da transação
    return { ok: true, draft: await draftNextStep(plan) };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    console.error("[próximo passo]", error);
    return { ok: false, message: "Não foi possível montar o rascunho agora." };
  }
}

export async function sendNextStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return NOT_ALLOWED;
  const p = z
    .object({ conversationId: z.uuid(), body: z.string().trim().min(1, "Escreva a mensagem.").max(4000), at: z.union([z.literal(""), z.iso.datetime()]) })
    .safeParse({ conversationId: field(form, "conversationId"), body: field(form, "body"), at: field(form, "at") });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    await runCrm(
      ctx,
      async (tx, scope) => {
        const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, p.data.conversationId) });
        if (!conv) throw new UserError("Conversa não encontrada.");
        const at = p.data.at ? new Date(p.data.at) : null;
        await queueOutbound(tx, { conversation: conv, body: p.data.body, authorId: scope.actorId, sendAfter: at && at.getTime() > Date.now() ? at : null, meta: { kind: "next_step" } });
      },
      { dispatch: true },
    );
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/crm/jornada");
  return { ok: true, message: p.data.at ? "Mensagem agendada para o melhor horário do paciente." : "Mensagem enviada." };
}

export async function applySuggestionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Sugestão inválida." };
  try {
    const msg = await runCrm(ctx, async (tx, scope) => {
      const [s] = await tx.select().from(schema.contactSuggestions).where(eq(schema.contactSuggestions.id, id.data));
      if (!s || s.status !== "pendente") throw new UserError("Sugestão já resolvida.");
      if (s.kind === "etiqueta") {
        await tx
          .update(schema.contacts)
          .set({ tags: sql`array(select distinct unnest(${schema.contacts.tags} || array[${s.value}]::text[]))`, version: sql`${schema.contacts.version} + 1` })
          .where(eq(schema.contacts.id, s.contactId));
      } else {
        const column = { email: "email", birthDate: "birthDate", insurance: "insurance", referredBy: "referredBy" }[s.field] as "email" | "birthDate" | "insurance" | "referredBy" | undefined;
        if (!column) throw new UserError("Campo desconhecido.");
        await tx
          .update(schema.contacts)
          .set({ [column]: s.value, version: sql`${schema.contacts.version} + 1` })
          .where(eq(schema.contacts.id, s.contactId));
      }
      await tx.update(schema.contactSuggestions).set({ status: "aplicada", decidedBy: scope.actorId, decidedAt: new Date() }).where(eq(schema.contactSuggestions.id, s.id));
      await logEvent(tx, {
        contactId: s.contactId,
        actorId: scope.actorId,
        type: "suggestion_applied",
        data: { tipo: s.kind, campo: s.field, valor: s.kind === "campo" && s.field === "email" ? "(e-mail)" : s.value },
      });
      return s.kind === "etiqueta" ? `Etiqueta “${s.value}” adicionada.` : "Ficha atualizada.";
    });
    revalidatePath("/crm/conversas");
    return { ok: true, message: msg };
  } catch (error) {
    return toActionError(error);
  }
}

export async function dismissSuggestionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Sugestão inválida." };
  await runCrm(ctx, (tx, scope) =>
    tx.update(schema.contactSuggestions).set({ status: "descartada", decidedBy: scope.actorId, decidedAt: new Date() }).where(eq(schema.contactSuggestions.id, id.data)),
  );
  revalidatePath("/crm/conversas");
  return { ok: true, message: "Sugestão descartada." };
}

/** "Analisar agora": cadastro e etiquetas deste paciente (a IA roda logo depois). */
export async function analyzeContactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "contactId"));
  if (!id.success) return { ok: false, message: "Contato inválido." };
  const queued = await runCrm(ctx, async (tx) => {
    const a = await queueAiJob(tx, "cadastro", id.data);
    const b = await queueAiJob(tx, "etiquetas", id.data);
    return a || b;
  });
  if (!queued) return { ok: false, message: "Ligue “Preencher o cadastro” ou “Etiquetas sugeridas” em Ajustes > Inteligência artificial." };
  after(() => runAiQueues(ctx.user.clinicId).then(() => undefined));
  return { ok: true, message: "Analisando as conversas deste paciente..." };
}

export async function duplicateOpinionAction(a: string, b: string): Promise<{ ok: true; opinion: DuplicateOpinionView } | { ok: false; message: string }> {
  const ctx = await authorizeCrm("contatos.mesclar");
  if (!ctx) return { ok: false, message: "Você não tem permissão." };
  if (!z.uuid().safeParse(a).success || !z.uuid().safeParse(b).success) return { ok: false, message: "Par inválido." };
  const [x, y] = a < b ? [a, b] : [b, a];
  try {
    const pair = await runCrm(ctx, async (tx) => {
      // Funcionalidade desligada em Ajustes > IA: não consulta
      if (!(await automationSettings(tx)).ia_duplicados?.enabled) throw new UserError("A opinião da IA sobre duplicados está desligada em Ajustes > Inteligência artificial.");
      const cols = { id: true, name: true, email: true, phone: true, birthDate: true } as const;
      const ca = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, x), columns: cols });
      const cb = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, y), columns: cols });
      if (!ca || !cb) throw new UserError("Cadastro não encontrado.");
      return { a: ca, b: cb };
    });
    // IA fora da transação
    const r = await askDuplicateOpinion(pair);
    await runCrm(ctx, (tx) =>
      tx
        .insert(schema.duplicateReviews)
        .values({ contactA: x, contactB: y, verdict: r.opinion.verdict, reason: r.opinion.reason, source: r.opinion.source, confidence: r.confidence, model: r.model, fallbackReason: r.reason })
        .onConflictDoUpdate({
          target: [schema.duplicateReviews.clinicId, schema.duplicateReviews.contactA, schema.duplicateReviews.contactB],
          set: { verdict: r.opinion.verdict, reason: r.opinion.reason, source: r.opinion.source, confidence: r.confidence, model: r.model, fallbackReason: r.reason, createdAt: new Date() },
        }),
    );
    revalidatePath("/crm/contatos/duplicados");
    return { ok: true, opinion: r.reason && r.opinion.source === "regras" ? { ...r.opinion, reason: `${r.opinion.reason} (sem IA: ${r.reason})` } : r.opinion };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    console.error("[duplicados IA]", error);
    return { ok: false, message: "Não foi possível consultar agora." };
  }
}
