import "server-only";
import { ChannelError, getAdapter, messagingWindow, type OutboundMedia } from "@ecosaude/channels";
import { connectionCredentials, signedMediaUrl } from "./channels";
import { getStorage } from "./files/storage";
import { attachmentLabel, firstName, PHONE_SOURCE, formatDayShort, formatTime, type AttachmentKind, type Channel, type TemplateVariables } from "@ecosaude/core/crm";
import { and, desc, eq, inArray, ne, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { onAgentReply } from "./journey";
import { claimPacedWhatsApp, isPacedConnection, whatsappConnection } from "./pacing";

/**
 * Conversas e envio de mensagens.
 *
 * Toda mensagem da clínica entra numa FILA (status "fila") dentro da mesma
 * transação da ação que a gerou, e só depois é despachada para o canal.
 * Vantagens: nada se perde se o canal estiver fora do ar (a rotina tenta de
 * novo) e é o mesmo modelo que o modo offline vai usar.
 */

export type ConversationRow = typeof schema.conversations.$inferSelect;
export type ContactRow = typeof schema.contacts.$inferSelect;

/* ----------------------------- Conversas e canais -------------------------- */

/** Conversa da pessoa naquele canal (cria se ainda não existir). */
export async function ensureConversation(tx: Tx, contactId: string, channel: Channel): Promise<ConversationRow> {
  await tx.insert(schema.conversations).values({ contactId, channel, status: "aguardando_paciente" }).onConflictDoNothing();
  const [conv] = await tx
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.contactId, contactId), eq(schema.conversations.channel, channel)));
  if (!conv) throw new Error("Falha ao abrir a conversa.");
  return conv;
}

/** Identificador do paciente no canal (para onde enviar). */
export async function recipientFor(tx: Tx, contactId: string, channel: Channel, replyTo?: string | null): Promise<string | null> {
  const identities = await tx
    .select({ externalId: schema.contactIdentities.externalId })
    .from(schema.contactIdentities)
    .where(and(eq(schema.contactIdentities.contactId, contactId), eq(schema.contactIdentities.channel, channel)))
    .orderBy(desc(schema.contactIdentities.createdAt));
  // 1. Responder para quem escreveu por último, se esse número/@ ainda é do paciente
  if (replyTo && identities.some((i) => i.externalId === replyTo)) return replyTo;
  // 2. WhatsApp: o celular ATUAL do cadastro (o paciente pode ter trocado de número)
  if (channel === "whatsapp") {
    const [c] = await tx.select({ phone: schema.contacts.phone }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
    if (c?.phone) return c.phone;
  }
  // 3. A identidade mais recente no canal
  return identities[0]?.externalId ?? null;
}

/**
 * Melhor canal para falar com a pessoa: o preferido, se houver como alcançá-la nele;
 * senão, o de uma conversa já existente; senão, WhatsApp pelo telefone.
 */
export async function bestChannel(tx: Tx, contactId: string): Promise<Channel | null> {
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId), with: { identities: true } });
  if (!contact) return null;
  const reachable = new Set<Channel>(contact.identities.map((i) => i.channel));
  if (contact.phone) reachable.add("whatsapp");
  if (contact.preferredChannel && reachable.has(contact.preferredChannel)) return contact.preferredChannel;
  const [recent] = await tx
    .select({ channel: schema.conversations.channel })
    .from(schema.conversations)
    .where(eq(schema.conversations.contactId, contactId))
    .orderBy(sql`${schema.conversations.lastMessageAt} desc nulls last`)
    .limit(1);
  if (recent && reachable.has(recent.channel)) return recent.channel;
  return [...reachable][0] ?? null;
}

/** Variáveis de modelo para um contato (e opcionalmente uma consulta). */
export function templateVars(
  contact: { name: string },
  clinicName: string,
  appt?: { startsAt: Date; professionalName: string },
  /** Local da consulta (placeVars em units.ts): unidade, endereço e consultório */
  place?: { local?: string; endereco?: string; consultorio?: string },
): TemplateVariables {
  return {
    nome: contact.name,
    primeiro_nome: firstName(contact.name),
    clinica: clinicName,
    data: appt ? formatDayShort(appt.startsAt) : undefined,
    hora: appt ? formatTime(appt.startsAt) : undefined,
    profissional: appt?.professionalName,
    ...place,
  };
}

/* ---------------------------------- Envio ---------------------------------- */

export interface QueueOptions {
  conversation: Pick<ConversationRow, "id" | "channel" | "contactId" | "lastInboundAt">;
  body: string;
  /** null = mensagem automática */
  authorId: string | null;
  /** Modelo aprovado: liberado fora da janela de 24h */
  templateKey?: string | null;
  clientId?: string;
  meta?: Record<string, unknown>;
  /** Enviar só a partir deste momento (melhor horário do paciente). Omitido = já */
  sendAfter?: Date | null;
  /** Anexo já conferido e guardado (storeFile). Vai junto na mesma mensagem. */
  attachment?: { id: string; kind: string; mime: string; fileName: string; sizeBytes: number; sha256: string; storageKey: string } | null;
}

/**
 * Coloca uma mensagem da clínica na fila de envio.
 * Bloqueia mensagem livre fora da janela de 24h (regra da Meta): o atendente
 * vê o aviso e escolhe um modelo aprovado. Assim a simulação já se comporta
 * como a integração real vai se comportar.
 */
export async function queueOutbound(tx: Tx, opts: QueueOptions) {
  const { conversation } = opts;
  if (!opts.templateKey && !messagingWindow(conversation.channel, conversation.lastInboundAt).open) {
    throw new UserError("Fora da janela de 24h deste canal: a Meta só permite modelos aprovados. Use uma resposta rápida marcada como modelo.");
  }

  const [message] = await tx
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      channel: conversation.channel,
      direction: "out",
      body: opts.body,
      status: "fila",
      authorId: opts.authorId,
      clientId: opts.clientId ?? null,
      templateKey: opts.templateKey ?? null,
      meta: opts.meta ?? null,
      sendAfter: opts.sendAfter ?? null,
    })
    .onConflictDoNothing()
    .returning();

  // Mesmo clientId já enviado (ex.: clique duplo, reenvio offline): não duplica
  if (!message) return null;
  if (opts.attachment) {
    const a = opts.attachment;
    await tx.insert(schema.messageAttachments).values({
      id: a.id,
      messageId: message.id,
      kind: a.kind,
      mime: a.mime,
      fileName: a.fileName,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      storageKey: a.storageKey,
      status: "pronto",
      readyAt: new Date(),
    });
  }

  const human = opts.authorId !== null;
  await tx
    .update(schema.conversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: opts.body.slice(0, 140),
      ...(human ? { awaitingReplySince: null, unreadCount: 0, status: "aguardando_paciente" as const, intent: null, snoozedUntil: null } : {}),
    })
    .where(eq(schema.conversations.id, conversation.id));
  await tx.update(schema.contacts).set({ lastInteractionAt: new Date() }).where(eq(schema.contacts.id, conversation.contactId));
  if (human) await onAgentReply(tx, conversation.contactId, opts.authorId);
  return message;
}

/** Nota interna: fica no histórico da conversa, nunca é enviada ao paciente. */
export async function addInternalNote(tx: Tx, conversation: Pick<ConversationRow, "id" | "channel">, body: string, authorId: string, clientId?: string) {
  const [note] = await tx
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      channel: conversation.channel,
      direction: "note",
      body,
      status: "entregue",
      authorId,
      clientId: clientId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return note ?? null;
}

/* -------------------------------- Despacho --------------------------------- */

const HELD_MESSAGE = "Canal desconectado: a mensagem sai quando a conexão voltar.";

/**
 * Envia as mensagens em fila de uma clínica pelo adaptador de cada canal.
 *
 * 1. "Reserva" as mensagens (FOR UPDATE SKIP LOCKED): dois despachos ao mesmo
 *    tempo nunca enviam a mesma mensagem.
 * 2. Envia FORA da transação (rede lenta não prende o banco).
 * 3. Grava o resultado: enviada/entregue, ou volta para a fila (erro temporário),
 *    ou falhou (erro definitivo, ex.: credencial ausente).
 */
export async function dispatchQueued(clinicId: string, limit = 50): Promise<{ sent: number; failed: number }> {
  const claimed = await withTenant(clinicId, async (tx) => {
    // WhatsApp do celular: as AUTOMÁTICAS não entram no lote; saem uma por vez, no ritmo
    // (claimPacedWhatsApp). As digitadas pela equipe e os outros canais seguem no lote.
    const wa = await whatsappConnection(tx);
    const paced = isPacedConnection(wa);
    const rows = await tx.execute<{
      id: string;
      channel: Channel;
      body: string;
      conversation_id: string;
      meta: Record<string, unknown> | null;
      template_key: string | null;
      send_after: Date | null;
    }>(sql`
      update messages m set status = 'enviada', sent_at = now()
       where m.id in (
         select id from messages
          where status = 'fila' and direction = 'out'
            -- Agendada para o melhor horário do paciente: espera a hora
            and (send_after is null or send_after <= now())
            ${paced ? sql`and not (channel = 'whatsapp' and author_id is null)` : sql``}
          order by created_at
          limit ${limit}
          for update skip locked)
      returning m.id, m.channel, m.body, m.conversation_id, m.meta, m.template_key, m.send_after`);
    if (paced) {
      const next = await claimPacedWhatsApp(tx, wa!);
      if (next) rows.rows.push(next);
    }
    const modes = await tx
      .select({
        channel: schema.channelConnections.channel,
        mode: schema.channelConnections.mode,
        active: schema.channelConnections.active,
        account: schema.channelConnections.externalAccountId,
        kind: schema.channelConnections.kind,
        credentialsEnc: schema.channelConnections.credentialsEnc,
        state: schema.channelConnections.connectionState,
      })
      .from(schema.channelConnections);
    const modeOf = new Map(modes.map((m) => [m.channel, m]));
    // Anexos das mensagens reservadas (um por mensagem)
    const ids = rows.rows.map((r) => r.id);
    const atts = ids.length
      ? await tx
          .select({
            messageId: schema.messageAttachments.messageId,
            id: schema.messageAttachments.id,
            kind: schema.messageAttachments.kind,
            mime: schema.messageAttachments.mime,
            fileName: schema.messageAttachments.fileName,
            storageKey: schema.messageAttachments.storageKey,
          })
          .from(schema.messageAttachments)
          .where(and(inArray(schema.messageAttachments.messageId, ids), eq(schema.messageAttachments.status, "pronto")))
      : [];
    const attOf = new Map(atts.map((a) => [a.messageId, a]));
    const out = [];
    for (const r of rows.rows) {
      const [conv] = await tx
        .select({ contactId: schema.conversations.contactId, replyTo: schema.conversations.replyTo, lastInboundAt: schema.conversations.lastInboundAt })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, r.conversation_id));
      const to = conv ? await recipientFor(tx, conv.contactId, r.channel, conv.replyTo) : null;
      const conn = modeOf.get(r.channel);
      // Texto reescrito pela IA (retorno personalizado) só sai com a janela de 24h ABERTA
      // na hora real do envio. Fechou no meio-tempo: volta ao texto aprovado (modelo).
      let body = r.body;
      const original = typeof r.meta?.originalBody === "string" ? r.meta.originalBody : null;
      if (r.meta?.personalizedBy && original && !messagingWindow(r.channel, conv?.lastInboundAt ?? null).open) {
        body = original;
        await tx
          .update(schema.messages)
          .set({
            body,
            meta: sql`(coalesce(${schema.messages.meta}, '{}'::jsonb) - 'personalizedBy') || ${JSON.stringify({ revertedReason: "janela de 24h fechou antes do envio: foi o modelo aprovado" })}::jsonb`,
          })
          .where(eq(schema.messages.id, r.id));
      }
      // Texto livre AGENDADO (melhor horário) que encontra a janela fechada: não sai.
      const blocked = !original && !r.template_key && !!r.send_after && !messagingWindow(r.channel, conv?.lastInboundAt ?? null).open;
      out.push({ ...r, body, blocked, attachment: attOf.get(r.id) ?? null, to, mode: conn?.mode ?? "simulacao", active: conn?.active ?? true, account: conn?.account ?? null, conn: conn ?? null });
    }
    return out;
  });

  let sent = 0;
  let failed = 0;
  for (const msg of claimed) {
    let update: Partial<typeof schema.messages.$inferInsert>;
    try {
      if (msg.blocked) throw new ChannelError("A janela de 24h do canal fechou antes do horário agendado: use um modelo aprovado.", false);
      if (!msg.to) throw new ChannelError("Paciente sem identificador neste canal.", false);
      if (!msg.active) throw new ChannelError("Canal desativado nas configurações.", false);
      // Celular desconectado (WhatsApp por QR code): a mensagem ESPERA na fila e sai quando reconectar
      if (msg.mode === "real" && (msg.conn?.state === "desconectado" || msg.conn?.state === "conectando")) throw new ChannelError(HELD_MESSAGE, true);
      // Credenciais DA CLÍNICA (token da página, bot, instância da Evolution), com o ambiente como reserva
      const adapter = getAdapter(msg.channel, msg.mode, connectionCredentials(msg.conn ? { channel: msg.channel, kind: msg.conn.kind, externalAccountId: msg.conn.account, credentialsEnc: msg.conn.credentialsEnc } : null, msg.channel));
      // Anexo: lê do armazenamento privado e manda junto (o texto vira legenda quando o canal aceita)
      let media: OutboundMedia | undefined;
      if (msg.attachment?.storageKey) {
        const bytes = await (await getStorage()).get(msg.attachment.storageKey);
        if (!bytes) throw new ChannelError("O arquivo do anexo não foi encontrado no armazenamento.", false);
        media = { kind: msg.attachment.kind as AttachmentKind, mime: msg.attachment.mime ?? "application/octet-stream", fileName: msg.attachment.fileName ?? "anexo", bytes };
        // Instagram: o anexo vai por link temporário e assinado (o arquivo continua privado)
        if (msg.channel === "instagram" && msg.mode === "real") {
          const url = signedMediaUrl(clinicId, msg.attachment.id);
          if (url) media.publicUrl = url;
        }
      }
      const label = media ? attachmentLabel(media.kind, media.fileName) : null;
      const result = await adapter.send({ to: msg.to, text: media && msg.body === label ? "" : msg.body, ...(media ? { media } : {}) });
      // Na simulação não existe confirmação de entrega do provedor: já marcamos como entregue
      update = { status: msg.mode === "simulacao" ? "entregue" : "enviada", externalId: result.externalMessageId, error: null };
      sent++;
    } catch (error) {
      const retryable = error instanceof ChannelError ? error.retryable : true;
      // Segurada por desconexão: volta "sem tentativa" (sent_at vazio), para o despachante do
      // servidor mandar assim que reconectar, mesmo se este despacho correu junto com a reconexão
      const held = (error as Error).message === HELD_MESSAGE;
      update = { status: retryable ? "fila" : "falhou", error: (error as Error).message.slice(0, 300), ...(held ? { sentAt: null } : {}) };
      failed++;
    }
    await withTenant(clinicId, async (tx) => {
      // Corrida com o celular: a Evolution pode ter devolvido ESTA mensagem como "enviada pelo
      // celular" antes de o ID externo ser gravado aqui. Nesse caso o eco é a mesma mensagem:
      // sai o eco e fica a do Tropi (com autor, modelo e anexo).
      if (update.externalId) {
        await tx
          .delete(schema.messages)
          .where(
            and(
              eq(schema.messages.channel, msg.channel),
              eq(schema.messages.externalId, update.externalId),
              ne(schema.messages.id, msg.id),
              sql`${schema.messages.meta}->>'source' = ${PHONE_SOURCE}`,
            ),
          );
      }
      await tx.update(schema.messages).set(update).where(eq(schema.messages.id, msg.id));
    });
  }
  return { sent, failed };
}

/** Atualiza status vindos do provedor (entregue, lida, falhou) pelo ID externo. */
export async function applyStatusUpdate(tx: Tx, channel: Channel, externalId: string, status: "enviada" | "entregue" | "lida" | "falhou", error?: string) {
  // Status só avança (lida não volta para entregue)
  const order = ["fila", "enviada", "entregue", "lida"];
  await tx
    .update(schema.messages)
    .set({ status, error: error ?? null })
    .where(
      and(
        eq(schema.messages.channel, channel),
        eq(schema.messages.externalId, externalId),
        // Só mensagens ENVIADAS pela clínica: o provedor também avisa "lida" das mensagens do
        // paciente (e a Evolution, na API oficial, não diz de quem é o status)
        eq(schema.messages.direction, "out"),
        status === "falhou" ? sql`true` : inArray(schema.messages.status, order.slice(0, order.indexOf(status)) as ("fila" | "enviada" | "entregue")[]),
      ),
    );
}
