import { detectFileType } from "@ecosaude/core/crm";
import { eq, schema, withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { getStorage } from "@/modules/crm/files/storage";

/**
 * GET /api/anexos/<id>
 * Entrega um anexo da conversa. Nunca existe link público para arquivo de paciente:
 *  - exige login e a permissão de ver conversas;
 *  - o banco (isolamento por clínica) só acha anexos da clínica da sessão;
 *  - o tipo enviado ao navegador é o REAL (conferido pelo conteúdo), com "nosniff";
 *  - imagem, áudio, vídeo e PDF abrem no navegador; o resto só baixa;
 *  - nada fica em cache compartilhado (private, no-store).
 * Aceita "Range" (pedaços do arquivo): o Safari precisa disso para tocar áudio e vídeo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext("conversas.ver");
  if (isResponse(ctx)) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Inválido." }, { status: 400 });

  const att = await withTenant(ctx.user.clinicId, async (tx) => (await tx.select().from(schema.messageAttachments).where(eq(schema.messageAttachments.id, id)))[0]);
  if (!att || att.status !== "pronto" || !att.storageKey) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });

  const bytes = await (await getStorage()).get(att.storageKey);
  if (!bytes) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  // Confere de novo pelo conteúdo (defesa extra caso o armazenamento tenha sido alterado)
  const type = detectFileType(bytes, att.mime, att.fileName);
  if (!type || type.mime !== att.mime) return NextResponse.json({ error: "Arquivo não confere." }, { status: 409 });

  const name = att.fileName ?? `anexo.${type.ext}`;
  const headers: Record<string, string> = {
    "Content-Type": type.mime,
    "Content-Disposition": `${type.inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    // Imagem, áudio e vídeo abertos sozinhos não executam nada (o PDF usa o leitor do navegador)
    ...(type.mime === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox" }),
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.byteLength;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new NextResponse(Buffer.from(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new NextResponse(Buffer.from(bytes), { headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
}
