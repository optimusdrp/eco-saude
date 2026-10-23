"use server";

import { randomUUID } from "node:crypto";
import { parseWebhook, samplePayload } from "@ecosaude/channels";
import { formatBytes, MAX_ATTACHMENT_BYTES, type AttachmentKind } from "@ecosaude/core/crm";
import { simulatorMessageSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { and, eq, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { authorizeCrm } from "@/lib/auth/dal";
import { field, formValues, NOT_ALLOWED, type ActionState } from "@/lib/server";
import { after } from "next/server";
import { runAiQueues } from "../ai/queue";
import { ingestInbound } from "../ingest";
import { runCrm } from "../run";
import { processPendingAttachments } from "../files/attachments";
import { getStorage, simulatorKey, storageStatus } from "../files/storage";

/**
 * SIMULADOR: envia uma mensagem "como se fosse o paciente".
 *
 * Importante: a mensagem simulada é montada no FORMATO OFICIAL do provedor
 * (o mesmo JSON que a Meta/Telegram enviam ao webhook) e passa pelo MESMO
 * leitor (parseWebhook) e pela MESMA entrada (ingestInbound) da integração
 * real. Quando o canal real for ligado, só muda quem chama esse caminho.
 */
export async function simulateInboundAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("conversas.ver");
  if (!ctx) return NOT_ALLOWED;

  const parsed = simulatorMessageSchema.safeParse({
    channel: field(form, "channel"),
    externalId: field(form, "externalId"),
    name: field(form, "name") || undefined,
    text: field(form, "text"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { channel, name, text } = parsed.data;

  // Arquivo OPCIONAL: o simulador o guarda como se estivesse "no provedor". Daí para frente
  // é o caminho real: o webhook traz só a referência, o Tropi baixa depois e confere o tipo
  // pelo conteúdo (um .exe renomeado para .pdf é recusado aqui também).
  const upload = form.get("file");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  if (!text && !file) return { ok: false, errors: { text: "Escreva a mensagem ou anexe um arquivo." }, values: formValues(form) };
  // WhatsApp identifica pelo telefone (só números)
  const externalId = channel === "whatsapp" ? parsed.data.externalId.replace(/\D/g, "") : parsed.data.externalId.replace(/^@/, "");
  if (channel === "whatsapp" && externalId.length < 12) {
    return { ok: false, errors: { externalId: "Use o telefone com DDI e DDD, ex.: 5551999990000." }, values: formValues(form) };
  }

  let media: { kind: AttachmentKind; key: string; mime: string; fileName: string } | undefined;
  if (file) {
    const st = storageStatus();
    if (!st.ok) return { ok: false, message: `Anexos indisponíveis: ${st.reason}`, values: formValues(form) };
    if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, message: `Arquivo com ${formatBytes(file.size)}: o limite é ${formatBytes(MAX_ATTACHMENT_BYTES)}.`, values: formValues(form) };
    const key = simulatorKey(ctx.user.clinicId, randomUUID());
    const mime = file.type || "application/octet-stream";
    await (await getStorage()).put(key, new Uint8Array(await file.arrayBuffer()), mime);
    // O tipo DECLARADO (como o provedor faria); o real é conferido no download
    const kind: AttachmentKind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : "document";
    media = { kind, key, mime, fileName: file.name.slice(0, 200) };
  }
  const result = await runCrm(
    ctx,
    async (tx, scope) => {
      const [conn] = await tx
        .select()
        .from(schema.channelConnections)
        .where(and(eq(schema.channelConnections.channel, channel), eq(schema.channelConnections.mode, "simulacao")));
      if (!conn) return null;
      const accountId = conn.externalAccountId ?? `sim-${channel}`;
      const payload = samplePayload(channel, { accountId, from: externalId, name, text, media });
      const { messages } = parseWebhook(channel, payload, accountId);
      const message = messages[0];
      if (!message) return null;
      return ingestInbound(tx, { ...scope, actorId: null }, message);
    },
    { dispatch: true },
  );

  if (!result) {
    if (media)
      await getStorage()
        .then((st) => st.delete(media.key))
        .catch(() => undefined);
    return { ok: false, message: "Este canal não está em modo simulação.", values: formValues(form) };
  }
  // Igual ao webhook real: anexo baixado e a IA revisando a intenção DEPOIS de responder
  if (media) after(() => processPendingAttachments(ctx.user.clinicId).then(() => undefined));
  after(() => runAiQueues(ctx.user.clinicId).then(() => undefined));
  revalidatePath("/crm/conversas");
  revalidatePath(`/crm/conversas/${result.conversationId}`);
  revalidatePath("/hoje");
  revalidatePath("/crm/agenda");
  revalidatePath("/crm/jornada");
  return {
    ok: true,
    message: result.automation ? `Mensagem recebida e tratada automaticamente (${result.automation.replace("_", " ")}).` : "Mensagem recebida pela clínica.",
    data: { conversationId: result.conversationId, automation: result.automation },
  };
}
