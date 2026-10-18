import { withTenant } from "@ecosaude/db";
import { NextResponse } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { logEvent } from "@/modules/crm/journey";
import { exportPatientData } from "@/modules/crm/patient";
import { registerPrivacyRequest } from "@/modules/crm/privacy";

/**
 * GET /api/contatos/<id>/exportar
 * LGPD, art. 18 (acesso e portabilidade): baixa um JSON com os dados do
 * paciente. A exportação fica registrada na linha do tempo (quem e quando).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext("contatos.exportar_ficha");
  if (isResponse(ctx)) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Inválido." }, { status: 400 });

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const d = await exportPatientData(tx, id);
    if (!d) return null;
    // Ficha já anonimizada: não há o que entregar (e não gera protocolo novo)
    const anonymized = await tx.query.contacts.findFirst({ where: (c, { eq }) => eq(c.id, id), columns: { anonymizedAt: true } });
    if (anonymized?.anonymizedAt) return { ...d, protocolo: null };
    // Fica registrado como pedido de ACESSO atendido (protocolo), além da linha do tempo
    const req = await registerPrivacyRequest(tx, { contactId: id, clinicId: ctx.user.clinicId, kind: "acesso", channel: "outro", actorId: ctx.user.id, identityChecked: true, done: true });
    await logEvent(tx, { contactId: id, actorId: ctx.user.id, type: "data_export", data: { protocolo: req.protocol } });
    return { ...d, protocolo: req.protocol };
  });
  if (!data) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  const slug = data.titular.nome
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dados-${slug}.json"`,
      "cache-control": "no-store",
    },
  });
}
