"use server";

import { revalidatePath } from "next/cache";
import { authorizeCrm } from "@/lib/auth/dal";
import { NOT_ALLOWED, type ActionState } from "@/lib/server";
import { runServiceAudit } from "../ai/audit";

/**
 * QUALIDADE DO ATENDIMENTO
 *  - runAuditNowAction: adianta o próximo lote da amostra da semana (só a gestão).
 */
export async function runAuditNowAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("qualidade.ver");
  if (!ctx) return NOT_ALLOWED;
  try {
    const r = await runServiceAudit(ctx.user.clinicId, { force: true, actorId: ctx.user.id });
    if (!r) return { ok: false, message: "A auditoria está desligada em Ajustes > Inteligência artificial." };
    revalidatePath("/crm/qualidade");
    if (!r.audited) return { ok: true, message: "Nada novo para avaliar: a amostra da semana está completa ou não há conversas em que a equipe respondeu." };
    return { ok: true, message: `${r.audited} ${r.audited === 1 ? "conversa avaliada" : "conversas avaliadas"}${r.rules && r.reason ? ` (${r.rules} pelas regras: ${r.reason})` : ""}.` };
  } catch (error) {
    console.error("[auditoria]", error);
    return { ok: false, message: "Não foi possível avaliar agora." };
  }
}
