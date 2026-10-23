import { detectFileType } from "@ecosaude/core/crm";
import { and, eq, schema, withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { readMediaToken } from "@/modules/crm/channels";
import { getStorage } from "@/modules/crm/files/storage";

/**
 * GET /api/midia/<token>
 * Link TEMPORÁRIO de um anexo que a clínica ENVIOU (o Instagram só aceita anexo por link).
 *  - o token é assinado (HMAC) e expira em 15 minutos;
 *  - só abre anexo de mensagem de SAÍDA: arquivo que o paciente mandou nunca sai por aqui;
 *  - sem cache compartilhado e sem "adivinhar" o tipo (nosniff).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = readMediaToken(token);
  if (!t || !/^[0-9a-f-]{36}$/i.test(t.attachmentId)) return new NextResponse("Link inválido ou expirado.", { status: 404 });

  const att = await withTenant(t.clinicId, async (tx) => {
    const [row] = await tx
      .select({ storageKey: schema.messageAttachments.storageKey, mime: schema.messageAttachments.mime, fileName: schema.messageAttachments.fileName, status: schema.messageAttachments.status })
      .from(schema.messageAttachments)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.messageAttachments.messageId))
      .where(and(eq(schema.messageAttachments.id, t.attachmentId), eq(schema.messages.direction, "out")));
    return row;
  });
  if (!att || att.status !== "pronto" || !att.storageKey) return new NextResponse("Link inválido ou expirado.", { status: 404 });
  const bytes = await (await getStorage()).get(att.storageKey);
  if (!bytes) return new NextResponse("Link inválido ou expirado.", { status: 404 });
  const type = detectFileType(bytes, att.mime, att.fileName);
  if (!type) return new NextResponse("Link inválido ou expirado.", { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": type.mime,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
