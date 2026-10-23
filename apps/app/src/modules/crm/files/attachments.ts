import "server-only";
import { createHash } from "node:crypto";
import { ChannelError, getAdapter, type MediaRef } from "@ecosaude/channels";
import { attachmentLabel, detectFileType, formatBytes, MAX_ATTACHMENT_BYTES, REJECTED_FILE_MESSAGE, safeFileName, type AttachmentKind } from "@ecosaude/core/crm";
import { and, asc, eq, inArray, lt, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { connectionCredentials } from "../channels";
import { attachmentKey, getStorage } from "./storage";

/**
 * ANEXOS: conferir, guardar, baixar do provedor e remover
 *
 *  - storeFile: confere o tipo PELO CONTEÚDO, o tamanho e grava no armazenamento privado.
 *    Arquivo recusado NÃO é guardado.
 *  - processPendingAttachments: baixa os anexos que chegaram pelo webhook. Roda depois da
 *    resposta ao provedor (o webhook não espera o download) e pela rotina, com até
 *    MAX_ATTEMPTS tentativas (os links da Meta expiram rápido; depois disso, "falhou").
 *  - processStorageDeletions: remove do armazenamento os arquivos cujas fichas foram apagadas.
 *  - Anexos NUNCA vão para a IA.
 */

const MAX_ATTEMPTS = 5;

export interface StoredFile {
  mime: string;
  kind: AttachmentKind;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  inline: boolean;
}

export type StoreResult = { ok: true; file: StoredFile } | { ok: false; reason: string };

/** Confere e guarda um arquivo. Nada é gravado se o tipo ou o tamanho não forem aceitos. */
export async function storeFile(clinicId: string, attachmentId: string, bytes: Uint8Array, declaredMime?: string | null, fileName?: string | null): Promise<StoreResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "Arquivo vazio." };
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, reason: `Arquivo com ${formatBytes(bytes.byteLength)}: o limite é ${formatBytes(MAX_ATTACHMENT_BYTES)}.` };
  const type = detectFileType(bytes, declaredMime, fileName);
  if (!type) return { ok: false, reason: REJECTED_FILE_MESSAGE };
  const storageKey = attachmentKey(clinicId, attachmentId);
  await (await getStorage()).put(storageKey, bytes, type.mime);
  return {
    ok: true,
    file: {
      mime: type.mime,
      kind: type.kind,
      fileName: safeFileName(fileName, type.ext),
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storageKey,
      inline: type.inline,
    },
  };
}

/* ------------------------------ Recebimento --------------------------------- */

/** Grava as fichas "pendente" dos anexos de uma mensagem que acabou de chegar. */
export async function queueInboundAttachments(
  tx: Tx,
  messageId: string,
  attachments: { kind: AttachmentKind; ref: MediaRef; mime?: string; fileName?: string; sizeBytes?: number }[],
): Promise<number> {
  if (!attachments.length) return 0;
  const rows = attachments.slice(0, 10).map((a) => {
    // Grande demais (quando o provedor informa): nem tenta baixar
    const tooBig = (a.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES;
    return {
      messageId,
      kind: a.kind,
      mime: a.mime ?? null,
      fileName: a.fileName ? safeFileName(a.fileName, a.fileName.split(".").pop()?.slice(0, 5) || "bin") : null,
      status: tooBig ? "recusado" : "pendente",
      error: tooBig ? `Arquivo maior que ${formatBytes(MAX_ATTACHMENT_BYTES)}.` : null,
      sourceRef: tooBig ? null : (a.ref as unknown as Record<string, string>),
    };
  });
  await tx.insert(schema.messageAttachments).values(rows);
  return rows.length;
}

/** Baixa e guarda os anexos pendentes da clínica (fora de transação: rede pode demorar). */
export async function processPendingAttachments(clinicId: string, limit = 20): Promise<{ ready: number; failed: number }> {
  const pending = await withTenant(clinicId, (tx) =>
    tx
      .select({
        id: schema.messageAttachments.id,
        kind: schema.messageAttachments.kind,
        mime: schema.messageAttachments.mime,
        fileName: schema.messageAttachments.fileName,
        ref: schema.messageAttachments.sourceRef,
        attempts: schema.messageAttachments.attempts,
        channel: schema.messages.channel,
      })
      .from(schema.messageAttachments)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.messageAttachments.messageId))
      .where(and(eq(schema.messageAttachments.status, "pendente"), lt(schema.messageAttachments.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(schema.messageAttachments.createdAt))
      .limit(limit),
  );
  let ready = 0;
  let failed = 0;
  for (const a of pending) {
    // "Reserva" a ficha (duas rotinas ao mesmo tempo não baixam o mesmo arquivo)
    const claimed = await withTenant(clinicId, (tx) =>
      tx
        .update(schema.messageAttachments)
        .set({ attempts: sql`${schema.messageAttachments.attempts} + 1` })
        .where(and(eq(schema.messageAttachments.id, a.id), eq(schema.messageAttachments.status, "pendente"), eq(schema.messageAttachments.attempts, a.attempts)))
        .returning({ id: schema.messageAttachments.id }),
    );
    if (!claimed.length) continue;
    const ref = a.ref as unknown as MediaRef | null;
    let update: Partial<typeof schema.messageAttachments.$inferInsert>;
    try {
      if (!ref) throw new ChannelError("Anexo sem referência.", false);
      const storage = await getStorage();
      let bytes: Uint8Array | null;
      let mime = a.mime;
      if (ref.provider === "simulado") {
        // O simulador já guardou o arquivo: "baixa" de lá (mesmo caminho do real)
        bytes = await storage.get(ref.key);
        if (!bytes) throw new ChannelError("Arquivo do simulador não encontrado.", false);
      } else {
        const [conn] = await withTenant(clinicId, (tx) => tx.select().from(schema.channelConnections).where(eq(schema.channelConnections.channel, a.channel)));
        const adapter = getAdapter(a.channel, conn?.mode ?? "simulacao", connectionCredentials(conn ?? null, a.channel));
        if (!adapter.downloadMedia) throw new ChannelError("Este canal não baixa arquivos.", false);
        const d = await adapter.downloadMedia(ref, MAX_ATTACHMENT_BYTES);
        bytes = d.bytes;
        mime = d.mime ?? mime;
      }
      const stored = await storeFile(clinicId, a.id, bytes, mime, a.fileName);
      if (ref.provider === "simulado") await storage.delete(ref.key).catch(() => undefined);
      update = stored.ok
        ? {
            status: "pronto",
            mime: stored.file.mime,
            kind: stored.file.kind,
            fileName: stored.file.fileName,
            sizeBytes: stored.file.sizeBytes,
            sha256: stored.file.sha256,
            storageKey: stored.file.storageKey,
            sourceRef: null,
            error: null,
            readyAt: new Date(),
          }
        : { status: "recusado", sourceRef: null, error: stored.reason };
      if (stored.ok) ready++;
      else failed++;
    } catch (error) {
      const retry = error instanceof ChannelError ? error.retryable : true;
      const last = a.attempts + 1 >= MAX_ATTEMPTS;
      update = retry && !last ? { error: (error as Error).message.slice(0, 300) } : { status: "falhou", sourceRef: null, error: (error as Error).message.slice(0, 300) };
      if (!retry || last) failed++;
    }
    await withTenant(clinicId, (tx) => tx.update(schema.messageAttachments).set(update).where(eq(schema.messageAttachments.id, a.id)));
  }
  return { ready, failed };
}

/* -------------------------------- Remoção ----------------------------------- */

/** Remove do armazenamento os arquivos cujas fichas foram apagadas (gatilho do banco). */
export async function processStorageDeletions(clinicId: string, limit = 100): Promise<number> {
  const rows = await withTenant(clinicId, (tx) =>
    tx.select().from(schema.storageDeletions).where(lt(schema.storageDeletions.attempts, 10)).orderBy(asc(schema.storageDeletions.createdAt)).limit(limit),
  );
  if (!rows.length) return 0;
  const storage = await getStorage();
  let done = 0;
  for (const r of rows) {
    try {
      await storage.delete(r.storageKey);
      await withTenant(clinicId, (tx) => tx.delete(schema.storageDeletions).where(eq(schema.storageDeletions.id, r.id)));
      done++;
    } catch (error) {
      await withTenant(clinicId, (tx) =>
        tx
          .update(schema.storageDeletions)
          .set({ attempts: sql`${schema.storageDeletions.attempts} + 1`, error: (error as Error).message.slice(0, 300) })
          .where(eq(schema.storageDeletions.id, r.id)),
      );
    }
  }
  return done;
}

/* ---------------------------------- Tela ------------------------------------ */

export interface AttachmentView {
  id: string;
  kind: AttachmentKind;
  mime: string | null;
  fileName: string | null;
  size: string | null;
  status: "pendente" | "pronto" | "falhou" | "recusado";
  error: string | null;
  /** Rota autenticada (nunca link público) */
  url: string;
  label: string;
  /** Abre no navegador (imagem, áudio, vídeo, PDF) ou só baixa (Word, HEIC...) */
  preview: boolean;
}

/** Tipos que o navegador mostra direto */
const PREVIEW = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "audio/ogg", "audio/mpeg", "audio/wav", "audio/aac", "audio/mp4", "video/mp4", "application/pdf"]);

export async function attachmentsByMessage(tx: Tx, messageIds: string[]): Promise<Map<string, AttachmentView[]>> {
  const out = new Map<string, AttachmentView[]>();
  if (!messageIds.length) return out;
  const rows = await tx.select().from(schema.messageAttachments).where(inArray(schema.messageAttachments.messageId, messageIds)).orderBy(asc(schema.messageAttachments.createdAt));
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    list.push({
      id: r.id,
      kind: r.kind as AttachmentKind,
      mime: r.mime,
      fileName: r.fileName,
      size: r.sizeBytes ? formatBytes(r.sizeBytes) : null,
      status: r.status as AttachmentView["status"],
      error: r.error,
      url: `/api/anexos/${r.id}`,
      label: attachmentLabel(r.kind as AttachmentKind, r.fileName),
      preview: !!r.mime && PREVIEW.has(r.mime),
    });
    out.set(r.messageId, list);
  }
  return out;
}
