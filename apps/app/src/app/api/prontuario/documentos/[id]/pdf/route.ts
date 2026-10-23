import { clinicTimeZone } from "@ecosaude/core/crm";
import { DOCUMENT_KIND_LABEL } from "@ecosaude/core/pep";
import { eq, schema, withTenant } from "@ecosaude/db";
import { NextResponse } from "next/server";
import { authorizePep } from "@/lib/auth/dal";
import { appUrl } from "@/lib/email";
import { accessFor, audit } from "@/modules/pep/access";
import { renderDocumentPdf } from "@/modules/pep/pdf";

/**
 * GET /api/prontuario/documentos/<id>/pdf
 * PDF do documento emitido (sempre o conteúdo congelado na emissão). Cada impressão fica
 * registrada. Quem pode: quem abre o prontuário do paciente ou tem "Documentos emitidos".
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Quem lê o prontuário (com a regra de sigilo) ou quem recebeu "Documentos emitidos" (reimpressão)
  const ctx = (await authorizePep("prontuario.documentos")) ?? (await authorizePep("prontuario.ver"));
  if (!ctx) return NextResponse.json({ error: "Sem acesso." }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });

  const doc = await withTenant(ctx.user.clinicId, async (tx) => {
    const [d] = await tx.select().from(schema.pepDocuments).where(eq(schema.pepDocuments.id, id));
    if (!d) return null;
    if (!ctx.can("prontuario.documentos")) {
      const { access } = await accessFor(tx, ctx, d.contactId);
      if (access !== "liberado") return "negado" as const;
    }
    const [clinic] = await tx.select({ city: schema.clinics.city }).from(schema.clinics).where(eq(schema.clinics.id, ctx.user.clinicId));
    // Cidade da linha "local e data": a da unidade onde o atendimento aconteceu
    const [unit] = d.encounterId
      ? await tx.select({ city: schema.clinicUnits.city }).from(schema.pepEncounters).innerJoin(schema.clinicUnits, eq(schema.clinicUnits.id, schema.pepEncounters.unitId)).where(eq(schema.pepEncounters.id, d.encounterId))
      : [];
    await audit(tx, ctx, { action: "imprimir", contactId: d.contactId, encounterId: d.encounterId, documentId: d.id });
    return { ...d, city: unit?.city ?? clinic?.city ?? null };
  });
  if (!doc) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  if (doc === "negado") return NextResponse.json({ error: "Sem acesso a este prontuário." }, { status: 403 });

  const bytes = await renderDocumentPdf({
    kind: doc.kind,
    content: doc.content,
    header: doc.header,
    issuedAt: doc.issuedAt,
    timeZone: clinicTimeZone(),
    city: doc.city,
    // Endereço público (APP_URL); sem ele, o endereço pelo qual o sistema foi acessado
    verifyUrl: appUrl() ?? new URL(req.url).origin,
    code: doc.verificationCode,
    revoked: !!doc.revokedAt,
  });
  const name = `${DOCUMENT_KIND_LABEL[doc.kind]} ${doc.verificationCode}.pdf`.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      // Dado de saúde: nunca em cache compartilhado
      "Cache-Control": "private, no-store",
    },
  });
}
