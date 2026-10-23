import { clinicTimeZone } from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, inArray, schema, withTenant } from "@ecosaude/db";
import { NextResponse } from "next/server";
import { authorizePep } from "@/lib/auth/dal";
import { renderRecordCopy } from "@/modules/pep/pdf";
import { loadPatient } from "@/modules/pep/records";

/**
 * GET /api/prontuario/pacientes/<id>/copia
 * Cópia integral do prontuário (pedido do titular: LGPD art. 18 e Código de Ética Médica).
 * Exige a permissão "Entregar cópia do prontuário" E o registro do pedido feito na tela
 * nos últimos 10 minutos (o motivo fica no histórico de acessos). Só registros finalizados.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorizePep("prontuario.exportar");
  if (!ctx) return NextResponse.json({ error: "Sem acesso." }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Paciente inválido." }, { status: 400 });

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const [req] = await tx
      .select({ id: schema.pepAudit.id })
      .from(schema.pepAudit)
      .where(and(eq(schema.pepAudit.userId, ctx.user.id), eq(schema.pepAudit.contactId, id), eq(schema.pepAudit.action, "exportar"), gt(schema.pepAudit.at, new Date(Date.now() - 10 * 60_000))))
      .limit(1);
    if (!req) return "sem_pedido" as const;
    const patient = await loadPatient(tx, id);
    if (!patient) return null;
    const [clinic] = await tx.select().from(schema.clinics).where(eq(schema.clinics.id, ctx.user.clinicId));
    const encounters = await tx
      .select({ e: schema.pepEncounters, professional: schema.professionals.name })
      .from(schema.pepEncounters)
      .innerJoin(schema.professionals, eq(schema.professionals.id, schema.pepEncounters.professionalId))
      .where(and(eq(schema.pepEncounters.contactId, id), eq(schema.pepEncounters.status, "finalizado")))
      .orderBy(asc(schema.pepEncounters.startedAt));
    const ids = encounters.map((r) => r.e.id);
    const addenda = ids.length ? await tx.select().from(schema.pepAddenda).where(inArray(schema.pepAddenda.encounterId, ids)).orderBy(asc(schema.pepAddenda.createdAt)) : [];
    const documents = await tx.select().from(schema.pepDocuments).where(eq(schema.pepDocuments.contactId, id)).orderBy(desc(schema.pepDocuments.issuedAt));
    return { patient, clinic, encounters, addenda, documents };
  });
  if (data === "sem_pedido") return NextResponse.json({ error: "Registre o pedido de cópia na tela do prontuário antes de baixar." }, { status: 403 });
  if (!data) return NextResponse.json({ error: "Paciente não encontrado." }, { status: 404 });

  const { patient, clinic } = data;
  const cpf = patient.identity.cpf;
  const bytes = await renderRecordCopy({
    header: {
      clinic: { name: clinic?.tradeName ?? ctx.user.clinicName, document: clinic?.cnpj ? `CNPJ ${clinic.cnpj}` : null, address: [clinic?.city, clinic?.state].filter(Boolean).join(" - ") || null, phone: clinic?.phone ?? null },
      professional: { name: "" },
      patient: { name: patient.identity.name, cpf: cpf ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : null, birthDate: patient.identity.birthDate, age: patient.age },
    },
    timeZone: clinicTimeZone(),
    generatedAt: new Date(),
    generatedBy: ctx.user.name,
    summary: {
      allergies: patient.profile.allergies.map((a) => [a.name, a.reaction, a.severity].filter(Boolean).join(", ")),
      medications: patient.profile.medications.map((m) => [m.name, m.dose].filter(Boolean).join(" ")),
      problems: patient.profile.problems.map((p) => `${p.cid ? `${p.cid} ` : ""}${p.name}${p.active ? "" : " (resolvido)"}`),
      history: patient.profile.history,
    },
    encounters: data.encounters.map(({ e, professional }) => ({
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      professional,
      templateName: e.templateName,
      fields: e.templateFields,
      answers: e.answers,
      vitals: e.vitals as Record<string, number>,
      diagnoses: e.diagnoses,
      conduct: e.conduct,
      returnDays: e.returnDays,
      hash: e.hash,
      addenda: data.addenda.filter((a) => a.encounterId === e.id),
    })),
    documents: data.documents.map((d) => ({ kind: d.kind, issuedAt: d.issuedAt, code: d.verificationCode, revoked: !!d.revokedAt })),
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="prontuario-copia.pdf"`, "Cache-Control": "private, no-store" },
  });
}
