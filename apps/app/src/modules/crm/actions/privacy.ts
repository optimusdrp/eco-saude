"use server";

import { clinicTimeZone, confirmsName, PRIVACY_REFUSAL_REASONS, PRIVACY_REQUEST_CHANNELS } from "@ecosaude/core/crm";
import { and, eq, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { logEvent } from "../journey";
import { anonymizeContact, openRequestFor, registerPrivacyRequest } from "../privacy";
import { runCrm } from "../run";
import { processStorageDeletions } from "../files/attachments";

/**
 * AÇÕES DOS PEDIDOS DO TITULAR (LGPD)
 *  - registerPrivacyRequestAction: a RECEPÇÃO registra o pedido de exclusão (protocolo + prazo).
 *  - anonymizeContactAction: a GESTÃO executa. Exige identidade conferida e o nome digitado.
 *  - refusePrivacyRequestAction: a GESTÃO recusa, com motivo de uma lista fechada.
 * Separar quem registra de quem executa evita que uma pessoa sozinha apague um
 * paciente por engano (ou de má-fé).
 */

const revalidate = (contactId?: string) => {
  revalidatePath("/crm/contatos/privacidade");
  if (contactId) revalidatePath(`/crm/contatos/${contactId}`);
  revalidatePath("/crm/contatos");
};

export async function registerPrivacyRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.editar");
  if (!ctx) return NOT_ALLOWED;
  const p = z
    .object({ contactId: z.uuid(), channel: z.enum(PRIVACY_REQUEST_CHANNELS, { message: "Diga por onde o pedido chegou." }) })
    .safeParse({ contactId: field(form, "contactId"), channel: field(form, "channel") });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    const r = await runCrm(ctx, (tx, scope) =>
      registerPrivacyRequest(tx, { contactId: p.data.contactId, clinicId: scope.clinicId, kind: "exclusao", channel: p.data.channel, actorId: scope.actorId }),
    );
    revalidate(p.data.contactId);
    return { ok: true, message: `Pedido registrado: protocolo ${r.protocol}. Prazo para responder: ${r.dueAt.toLocaleDateString("pt-BR", { timeZone: clinicTimeZone() })}.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function anonymizeContactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.anonimizar");
  if (!ctx) return NOT_ALLOWED;
  const p = z
    .object({
      contactId: z.uuid(),
      confirmName: z.string().trim().min(1, "Digite o nome do paciente para confirmar."),
      identity: z.literal("on", { message: "Confirme que a identidade de quem pediu foi conferida." }),
      channel: z.enum(PRIVACY_REQUEST_CHANNELS).optional(),
    })
    .safeParse({ contactId: field(form, "contactId"), confirmName: field(form, "confirmName"), identity: field(form, "identity"), channel: field(form, "channel") || undefined });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    const protocol = await runCrm(
      ctx,
      async (tx, scope) => {
        const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, p.data.contactId), columns: { name: true, anonymizedAt: true } });
        if (!contact) throw new UserError("Contato não encontrado.");
        if (contact.anonymizedAt) throw new UserError("Os dados deste paciente já foram apagados.");
        if (!confirmsName(p.data.confirmName, contact.name)) throw new UserError("O nome digitado não confere. Digite o nome completo, como está na ficha.");
        // Usa o pedido em aberto; se a gestão atende direto, registra o pedido agora
        const req =
          (await openRequestFor(tx, p.data.contactId)) ??
          (await registerPrivacyRequest(tx, { contactId: p.data.contactId, clinicId: scope.clinicId, kind: "exclusao", channel: p.data.channel ?? "presencial", actorId: scope.actorId }));
        const result = await anonymizeContact(tx, p.data.contactId);
        await tx
          .update(schema.privacyRequests)
          .set({ status: "concluida", decidedBy: scope.actorId, decidedAt: new Date(), identityChecked: true, result })
          .where(and(eq(schema.privacyRequests.id, req.id), eq(schema.privacyRequests.status, "aberta")));
        // A linha do tempo da ficha anonimizada guarda só o fato e o protocolo
        await logEvent(tx, { contactId: p.data.contactId, actorId: scope.actorId, type: "data_anonymized", data: { protocolo: req.protocol } });
        return req.protocol;
      },
      { dispatch: false },
    );
    // Arquivos dos anexos: removidos do armazenamento já (a rotina repete se algo falhar)
    await processStorageDeletions(ctx.user.clinicId).catch((e) => console.error("[LGPD arquivos]", e));
    revalidate(p.data.contactId);
    return { ok: true, message: `Dados apagados. Protocolo ${protocol}. Informe o paciente pelo mesmo canal do pedido.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function refusePrivacyRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("pacientes.anonimizar");
  if (!ctx) return NOT_ALLOWED;
  const p = z
    .object({ requestId: z.uuid(), reason: z.enum(PRIVACY_REFUSAL_REASONS, { message: "Escolha o motivo da recusa." }) })
    .safeParse({ requestId: field(form, "requestId"), reason: field(form, "reason") });
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    const contactId = await runCrm(ctx, async (tx, scope) => {
      const [row] = await tx
        .update(schema.privacyRequests)
        .set({ status: "recusada", refusalReason: p.data.reason, decidedBy: scope.actorId, decidedAt: new Date() })
        .where(and(eq(schema.privacyRequests.id, p.data.requestId), eq(schema.privacyRequests.status, "aberta")))
        .returning({ contactId: schema.privacyRequests.contactId, protocol: schema.privacyRequests.protocol });
      if (!row) throw new UserError("Pedido não encontrado ou já decidido.");
      if (row.contactId) await logEvent(tx, { contactId: row.contactId, actorId: scope.actorId, type: "privacy_refused", data: { protocolo: row.protocol, motivo: p.data.reason } });
      return row.contactId;
    });
    revalidate(contactId ?? undefined);
    return { ok: true, message: "Pedido recusado. Explique o motivo ao paciente pelo mesmo canal do pedido." };
  } catch (error) {
    return toActionError(error);
  }
}
