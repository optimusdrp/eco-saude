"use server";

import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { UserError } from "@/lib/server";
import { attemptDraft, planDraft, recordDraftOutcome, saveDraft, type DraftOutput } from "../ai/draft";
import type { ScheduleSuggestion } from "@/lib/events";
import { attemptSchedule, planSchedule, saveSchedule } from "../ai/schedule";
import { attemptSummary, planSummary, rateSummary, saveSummary, type SummaryView } from "../ai/summary";
import { runCrm } from "../run";

/**
 * "Sugerir resposta" na conversa. Exige a mesma permissão de responder.
 * Devolve SEMPRE um rascunho (da IA ou do plano B): a recepção nunca fica sem resposta
 * por causa da IA. O envio continua sendo feito pelo atendente, no botão Enviar.
 */
export async function draftReplyAction(input: { conversationId: string; regenerate?: boolean }): Promise<{ ok: true; draft: DraftOutput } | { ok: false; message: string }> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx) return { ok: false, message: "Você não tem permissão para responder conversas." };
  const id = z.uuid().safeParse(input.conversationId);
  if (!id.success) return { ok: false, message: "Conversa inválida." };
  try {
    const plan = await runCrm(ctx, (tx, scope) => planDraft(tx, scope, id.data, { regenerate: input.regenerate }));
    if (plan.cached) return { ok: true, draft: plan.cached };
    // Fora da transação: a IA pode levar alguns segundos
    const attempt = await attemptDraft(plan);
    const draft = await runCrm(ctx, (tx, scope) => saveDraft(tx, scope, plan, attempt));
    return { ok: true, draft };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    console.error("[rascunho IA]", error);
    return { ok: false, message: "Não foi possível sugerir agora. Escreva a resposta normalmente." };
  }
}

/** O atendente descartou o rascunho (conta na métrica de qualidade). */
export async function discardDraftAction(draftId: string): Promise<void> {
  const ctx = await authorizeCrm("conversas.responder");
  if (!ctx || !z.uuid().safeParse(draftId).success) return;
  await runCrm(ctx, (tx) => recordDraftOutcome(tx, draftId, "descartado"));
}

/**
 * "Resumir" a conversa (para quem assume no meio). Basta poder VER a conversa:
 * o resumo não envia nada ao paciente.
 * Devolve SEMPRE um resumo (da IA ou do plano B por regras).
 */
export async function summarizeAction(input: { conversationId: string; regenerate?: boolean }): Promise<{ ok: true; summary: SummaryView } | { ok: false; message: string }> {
  const ctx = await authorizeCrm("conversas.ver");
  if (!ctx) return { ok: false, message: "Você não tem permissão para ver conversas." };
  const id = z.uuid().safeParse(input.conversationId);
  if (!id.success) return { ok: false, message: "Conversa inválida." };
  try {
    const plan = await runCrm(ctx, (tx, scope) => planSummary(tx, scope, id.data, { regenerate: input.regenerate }));
    if (plan.cached) return { ok: true, summary: plan.cached };
    // Fora da transação: a IA pode levar alguns segundos
    const attempt = await attemptSummary(plan);
    const summary = await runCrm(ctx, (tx, scope) => saveSummary(tx, scope, plan, attempt));
    return { ok: true, summary };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    console.error("[resumo IA]", error);
    return { ok: false, message: "Não foi possível resumir agora. Leia as últimas mensagens da conversa." };
  }
}

/**
 * "Agendar pelo pedido": entende o que o paciente pediu e devolve os horários livres
 * reais que batem com o pedido. Exige poder marcar consultas. Nada é marcado aqui:
 * a tela abre o agendamento preenchido e a recepção confirma.
 */
export async function suggestScheduleAction(input: { conversationId: string }): Promise<{ ok: true; suggestion: ScheduleSuggestion } | { ok: false; message: string }> {
  const ctx = await authorizeCrm("agenda.editar");
  if (!ctx) return { ok: false, message: "Você não tem permissão para marcar consultas." };
  const id = z.uuid().safeParse(input.conversationId);
  if (!id.success) return { ok: false, message: "Conversa inválida." };
  try {
    const plan = await runCrm(ctx, (tx, scope) => planSchedule(tx, scope, id.data));
    // Fora da transação: a IA pode levar alguns segundos
    const attempt = await attemptSchedule(plan);
    const suggestion = await runCrm(ctx, (tx, scope) => saveSchedule(tx, scope, plan, attempt));
    return { ok: true, suggestion };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, message: error.message };
    console.error("[agendar IA]", error);
    return { ok: false, message: "Não foi possível ler o pedido agora. Use “Agendar” e escolha o horário." };
  }
}

/** "Ajudou" / "Não ajudou" no resumo. */
export async function rateSummaryAction(summaryId: string, helpful: boolean): Promise<void> {
  const ctx = await authorizeCrm("conversas.ver");
  if (!ctx || !z.uuid().safeParse(summaryId).success) return;
  await runCrm(ctx, (tx) => rateSummary(tx, summaryId, helpful === true));
}

/**
 * "Testar a IA" (Ajustes > Inteligência artificial): uma pergunta FICTÍCIA, sem dado de paciente,
 * para conferir chave, modelo e tempo de resposta.
 */
export async function testAiAction(): Promise<{ ok: boolean; message: string }> {
  const ctx = await authorizeCrm("config.ia");
  if (!ctx) return { ok: false, message: "Você não tem permissão." };
  const { buildDraftPrompt, checkDraft, DRAFT_RESPONSE_SCHEMA } = await import("@ecosaude/core/crm");
  const { aiConfigured, aiStatus, AiError, generate } = await import("../ai/provider");
  if (!aiConfigured())
    return {
      ok: false,
      message: aiStatus().keyWithoutPaidTier
        ? "A chave existe, mas falta GEMINI_PAID_TIER=sim no servidor (confirmação de conta paga). As sugestões continuam por regras."
        : "Sem chave do Gemini no servidor (GEMINI_API_KEY). As sugestões continuam por regras.",
    };
  const sample = {
    clinicName: ctx.user.clinicName,
    tone: "acolhedor" as const,
    patientFirstName: "Maria",
    stage: "Em conversa",
    tags: [],
    optedOut: false,
    nextAppointment: null,
    lastVisit: null,
    freeSlots: ["qui, 23/10 às 14:30", "sex, 24/10 às 09:00"],
    slotsProfessional: "Dra. Exemplo",
    quickReplies: [],
    messages: [{ from: "paciente" as const, text: "Oi, queria marcar uma consulta", when: "agora" }],
    windowOpen: true,
  };
  try {
    const { system, user } = buildDraftPrompt(sample);
    const out = await generate({ system, user, schema: DRAFT_RESPONSE_SCHEMA });
    const checked = checkDraft(out.text, sample);
    if (!checked.ok) return { ok: false, message: `A IA respondeu (${out.model}, ${out.latencyMs} ms), mas a resposta foi recusada: ${checked.reason}.` };
    return { ok: true, message: `Funcionando: ${out.model} respondeu em ${(out.latencyMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s. Exemplo: “${checked.result.text}”` };
  } catch (error) {
    return { ok: false, message: `Não funcionou: ${error instanceof AiError ? error.reason : "falha inesperada"}. As sugestões continuam por regras (plano B).` };
  }
}

/**
 * "Treinar agora" (Ajustes > Inteligência artificial): treina os modelos da clínica
 * (risco de falta e encaixe) com os dados atuais. Roda no servidor, nada sai do sistema.
 */
export async function trainNowAction(): Promise<{ ok: boolean; message: string }> {
  const ctx = await authorizeCrm("config.ia");
  if (!ctx) return { ok: false, message: "Você não tem permissão." };
  const { trainClinicModels } = await import("../ml/models");
  const r = await trainClinicModels(ctx.user.clinicId, { force: true });
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/configuracoes/ia");
  if (!r) return { ok: false, message: "Não foi possível treinar agora." };
  return { ok: true, message: `Risco de falta: ${r.risco}. Encaixe: ${r.encaixe}.` };
}
