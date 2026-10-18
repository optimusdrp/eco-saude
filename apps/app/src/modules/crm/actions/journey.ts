"use server";

import { JOURNEY_STAGE_LABEL, JOURNEY_STAGES } from "@ecosaude/core/crm";
import { eq, inArray, schema, sql } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { logEvent, setStage } from "../journey";
import { runAiQueues } from "../ai/queue";
import { runCrm } from "../run";

/**
 * Ações em lote do quadro da JORNADA:
 *  - mover vários contatos de etapa de uma vez (Perdido exige motivo)
 *  - definir o responsável (dono) de vários contatos
 * Tudo numa transação: ou todos mudam, ou nenhum.
 */

const ids = z.array(z.uuid()).min(1, "Escolha ao menos um contato.").max(300);

export async function bulkMoveStageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("jornada.editar");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({ ids, stage: z.enum(JOURNEY_STAGES), lostReason: z.string().trim().max(300).optional() })
    .safeParse({ ids: form.getAll("id"), stage: field(form, "stage"), lostReason: field(form, "lostReason") || undefined });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { stage, lostReason } = parsed.data;
  if (stage === "perdido" && !lostReason) return { ok: false, errors: { lostReason: "Conte o motivo da perda." } };

  let moved = 0;
  try {
    await runCrm(ctx, async (tx, scope) => {
      for (const id of parsed.data.ids) {
        if (await setStage(tx, id, stage, { actorId: scope.actorId, auto: false, reason: lostReason })) moved++;
      }
    });
  } catch (error) {
    return toActionError(error);
  }
  // Perdido: o motivo é organizado pela IA logo depois desta resposta
  if (stage === "perdido" && moved) after(() => runAiQueues(ctx.user.clinicId).then(() => undefined));
  revalidatePath("/crm/jornada");
  return { ok: true, message: moved ? `${moved} ${moved === 1 ? "contato movido" : "contatos movidos"} para ${JOURNEY_STAGE_LABEL[stage]}.` : "Nenhum contato precisou mudar." };
}

export async function assignOwnerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("jornada.responsavel");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z.object({ ids, ownerId: z.union([z.uuid(), z.literal("")]) }).safeParse({ ids: form.getAll("id"), ownerId: field(form, "ownerId") ?? "" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const ownerId = parsed.data.ownerId || null;
  let ownerName: string | null = null;
  try {
    await runCrm(ctx, async (tx, scope) => {
      if (ownerId) {
        // RLS: só encontra usuários desta clínica
        const [u] = await tx.select({ name: schema.clinicUsers.name, active: schema.clinicUsers.active }).from(schema.clinicUsers).where(eq(schema.clinicUsers.id, ownerId));
        if (!u?.active) throw new UserError("Usuário não encontrado ou desativado.");
        ownerName = u.name;
      }
      await tx
        .update(schema.contacts)
        .set({ ownerId, version: sql`${schema.contacts.version} + 1` })
        .where(inArray(schema.contacts.id, parsed.data.ids));
      for (const id of parsed.data.ids) await logEvent(tx, { contactId: id, actorId: scope.actorId, type: "owner_changed", data: { para: ownerName } });
    });
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/crm/jornada");
  const n = parsed.data.ids.length;
  return { ok: true, message: ownerName ? `${n} ${n === 1 ? "contato agora é" : "contatos agora são"} de ${ownerName}.` : `${n} ${n === 1 ? "contato ficou" : "contatos ficaram"} sem responsável.` };
}
