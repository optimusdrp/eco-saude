import { clinicTimeZone, formatWhen } from "@ecosaude/core/crm";
import { desc, eq, schema, withTenant } from "@ecosaude/db";
import { ArrowLeft, ChevronDown, FilePen, Lock, MessageSquareText, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentLinks, EncounterContent } from "@/components/pep/EncounterView";
import { PatientSummary } from "@/components/pep/PatientSummary";
import { EmergencyAccessForm, ExportRecordButton, StartEncounterButton } from "@/components/pep/widgets";
import { Badge, EmptyState, Panel } from "@/components/ui/server";
import { requirePep } from "@/lib/auth/dal";
import { accessFor, auditOpen, EMERGENCY_HOURS, type RecordAccess } from "@/modules/pep/access";
import { activeTemplates, loadPatient, loadTimeline } from "@/modules/pep/records";

export const metadata: Metadata = { title: "Prontuário do paciente" };

/**
 * PRONTUÁRIO DO PACIENTE
 * Resumo (alergias, medicamentos, problemas) no topo e a linha do tempo clínica abaixo:
 * cada atendimento com seus adendos e documentos. Abrir esta tela fica registrado.
 */
export default async function PatientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requirePep();
  const canRead = ctx.can("prontuario.ver");
  const canExport = ctx.can("prontuario.exportar");
  // Acesso parcial (liberado pela gestão): cada parte mostra só o necessário para a função
  const partial = { summary: ctx.can("prontuario.resumo"), triage: ctx.can("prontuario.triagem"), docs: ctx.can("prontuario.documentos"), export: canExport };
  const hasPartial = partial.summary || partial.triage || partial.docs || partial.export;
  if (!canRead && !hasPartial) notFound();

  const result = await withTenant(ctx.user.clinicId, async (tx) => {
    const patient = await loadPatient(tx, id);
    if (!patient) return null;
    let access: RecordAccess = "negado";
    let viaEmergency = false;
    if (canRead) ({ access, viaEmergency } = await accessFor(tx, ctx, id));
    if (access === "liberado") {
      await auditOpen(tx, ctx, id);
      const timeline = await loadTimeline(tx, id);
      const templates = ctx.can("prontuario.atender") ? await activeTemplates(tx) : [];
      const [last] = timeline.encounters.filter((e) => e.status === "finalizado");
      const hasCrmContact = ctx.hasCrm ? !!(await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, id), columns: { id: true } })) : false;
      return { kind: "liberado" as const, patient, timeline, templates, viaEmergency, last, hasCrmContact };
    }
    if (!hasPartial) return { kind: access === "emergencia" ? ("emergencia" as const) : ("negado" as const), patient };

    // Visão parcial: registra a abertura com o que foi mostrado
    const scope = [partial.summary ? "resumo de segurança" : null, partial.triage ? "triagens" : null, partial.docs ? "documentos" : null].filter(Boolean).join(", ");
    if (scope) await auditOpen(tx, ctx, id, `acesso parcial: ${scope}`);
    const triages = partial.triage ? await tx.select().from(schema.pepTriages).where(eq(schema.pepTriages.contactId, id)).orderBy(desc(schema.pepTriages.createdAt)).limit(10) : [];
    const documents = partial.docs ? await tx.select().from(schema.pepDocuments).where(eq(schema.pepDocuments.contactId, id)).orderBy(desc(schema.pepDocuments.issuedAt)).limit(30) : [];
    return { kind: "parcial" as const, patient, triages, documents, emergency: access === "emergencia" };
  });
  if (!result) notFound();
  const { patient } = result;

  const back = (
    <Link href="/pacientes" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden />
      Pacientes
    </Link>
  );

  if (result.kind === "parcial") {
    return (
      <div className="mx-auto max-w-5xl">
        {back}
        <PatientSummary patient={patient} canEdit={false} limited={!partial.summary} />
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-fog px-3 py-2 text-sm text-ink-soft">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          Seu acesso mostra só parte da ficha. Anamnese, diagnósticos e evolução ficam com os profissionais de saúde que atendem o paciente (sigilo profissional e LGPD).
        </p>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-5">
            {partial.triage ? (
              <Panel title="Triagens" description="Pré-consultas registradas (as 10 mais recentes).">
                {result.triages.length ? (
                  <ul className="divide-y divide-line">
                    {result.triages.map((t) => (
                      <li key={t.id} className="py-3">
                        <p className="text-sm font-semibold">
                          {t.createdAt.toLocaleDateString("pt-BR", { timeZone: clinicTimeZone() })}, por {t.recordedByName}
                          {t.priority !== "normal" ? <Badge tone={t.priority === "urgente" ? "alert" : "warning"} className="ml-2">{t.priority === "urgente" ? "Urgente" : "Prioritário"}</Badge> : null}
                        </p>
                        {t.complaint ? <p>Queixa: {t.complaint}</p> : null}
                        <EncounterContent fields={[]} answers={{}} vitals={t.vitals} diagnoses={[]} conduct={null} returnDays={null} returnNote={null} age={patient.age} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="Nenhuma triagem registrada">A triagem é feita pelo Consultório, quando o paciente chega.</EmptyState>
                )}
              </Panel>
            ) : null}
            {partial.docs ? (
              <Panel title="Documentos emitidos" description="Para reimprimir e entregar ao paciente.">
                {result.documents.length ? <DocumentLinks documents={result.documents} /> : <p className="text-sm text-ink-soft">Nenhum documento emitido.</p>}
              </Panel>
            ) : null}
          </div>
          <aside className="flex flex-col gap-3">
            {partial.export ? <ExportRecordButton contactId={id} /> : null}
            {result.emergency ? (
              <section className="rounded-2xl bg-paper p-4 ring-1 ring-line">
                <h2 className="font-semibold">Prontuário completo</h2>
                <p className="mt-1 text-sm text-ink-soft">Pela regra de sigilo da clínica, você só abre prontuários de pacientes que atendeu. Numa necessidade, use o acesso de emergência (vale {EMERGENCY_HOURS} horas, fica registrado e aparece para a gestão).</p>
                <EmergencyAccessForm contactId={id} />
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    );
  }
  if (result.kind === "negado") {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <EmptyState title="Sem acesso a este prontuário">Pela regra de sigilo da clínica, só quem atendeu este paciente abre o prontuário dele.</EmptyState>
      </div>
    );
  }
  if (result.kind === "emergencia") {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <section className="rounded-2xl bg-paper p-5 ring-1 ring-line">
          <Lock className="size-8 text-pep" aria-hidden />
          <h1 className="mt-3 text-2xl font-bold">Prontuário de {patient.identity.name}</h1>
          <p className="mt-1 text-ink-soft">
            Pela regra de sigilo da clínica, você só abre prontuários de pacientes que atendeu. Em caso de necessidade, use o acesso de emergência: vale por {EMERGENCY_HOURS} horas, fica registrado com seu nome e aparece para a gestão.
          </p>
          <EmergencyAccessForm contactId={id} />
        </section>
      </div>
    );
  }

  if (result.kind !== "liberado") notFound();
  const { timeline, templates, viaEmergency, last, hasCrmContact } = result;
  const canAttend = ctx.can("prontuario.atender") && !patient.anonymized;
  const drafts = timeline.encounters.filter((e) => e.status === "rascunho");

  return (
    <div className="mx-auto max-w-5xl">
      {back}
      {viaEmergency ? (
        <p role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          Aberto com acesso de emergência (registrado).
        </p>
      ) : null}

      <PatientSummary patient={patient} canEdit={canAttend} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ---------------------------------- Linha do tempo ---------------------------------- */}
        <div className="order-2 lg:order-1">
          <h2 className="mb-3 text-lg font-bold">Atendimentos</h2>
          {timeline.encounters.length ? (
            <ol className="space-y-3">
              {timeline.encounters.map((e) => {
                const docs = timeline.documents.filter((d) => d.encounterId === e.id);
                const draft = e.status === "rascunho";
                return (
                  <li key={e.id}>
                    <details className="group rounded-2xl bg-paper ring-1 ring-line open:ring-pep/40" open={e.id === last?.id}>
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-4 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {e.startedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: clinicTimeZone() })}
                            {e.templateName ? <span className="font-normal text-ink-soft">, {e.templateName}</span> : null}
                          </span>
                          <span className="block truncate text-sm text-ink-soft">
                            {e.professional}
                            {e.specialty ? `, ${e.specialty}` : ""}
                            {e.diagnoses.length ? ` | ${e.diagnoses.map((d) => d.code).join(", ")}` : ""}
                          </span>
                        </span>
                        {draft ? <Badge tone="warning">Rascunho</Badge> : null}
                        {e.addenda.length ? <Badge>{e.addenda.length === 1 ? "1 adendo" : `${e.addenda.length} adendos`}</Badge> : null}
                        <ChevronDown className="size-5 text-ink-soft transition-transform group-open:rotate-180" aria-hidden />
                      </summary>
                      <div className="border-t border-line p-4">
                        {draft ? (
                          <p className="mb-3 text-sm text-ink-soft">Atendimento em andamento: ainda não faz parte do registro.</p>
                        ) : null}
                        <EncounterContent
                          fields={e.templateFields}
                          answers={e.answers}
                          vitals={e.vitals}
                          diagnoses={e.diagnoses}
                          conduct={e.conduct}
                          returnDays={e.returnDays}
                          returnNote={e.returnNote}
                          age={patient.age}
                        />
                        {e.addenda.length ? (
                          <ul className="mt-4 space-y-2">
                            {e.addenda.map((a) => (
                              <li key={a.id} className="rounded-xl bg-fog p-3">
                                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                                  <MessageSquareText className="size-3.5" aria-hidden />
                                  Adendo de {a.authorName}, {formatWhen(a.createdAt)}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap">{a.text}</p>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {docs.length ? (
                          <div className="mt-4">
                            <DocumentLinks documents={docs} />
                          </div>
                        ) : null}
                        <div className="mt-4">
                          <Link href={`/prontuario/atendimentos/${e.id}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-pep hover:underline">
                            <FilePen className="size-4" aria-hidden />
                            {draft ? "Continuar atendimento" : "Abrir (adendo e documentos)"}
                          </Link>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState title="Nenhum atendimento registrado">{canAttend ? "Use \"Novo atendimento\" para registrar o primeiro." : "Os atendimentos aparecem aqui quando forem registrados."}</EmptyState>
          )}
        </div>

        {/* --------------------------------- Ações --------------------------------- */}
        <aside className="order-1 flex flex-col gap-3 lg:order-2" aria-label="Ações do prontuário">
          {canAttend ? (
            drafts.length ? (
              <Link href={`/prontuario/atendimentos/${drafts[0]!.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sun px-4 text-sm font-semibold text-ink hover:bg-sun-strong">
                <FilePen className="size-4" aria-hidden />
                Continuar atendimento aberto
              </Link>
            ) : (
              <div className="rounded-2xl bg-paper p-4 ring-1 ring-line">
                <StartEncounterButton contactId={id} templates={templates.map((t) => ({ id: t.id, name: t.name, specialty: t.specialty }))} label="Novo atendimento" variant="sun" />
              </div>
            )
          ) : null}
          {timeline.documents.length ? (
            <div className="rounded-2xl bg-paper p-4 ring-1 ring-line">
              <p className="mb-2 text-sm font-bold">Documentos emitidos</p>
              <DocumentLinks documents={timeline.documents.slice(0, 8)} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {hasCrmContact && ctx.can("pacientes.ver") ? (
              <Link href={`/crm/contatos/${id}`} className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
                Ficha no Atendimento
              </Link>
            ) : null}
            {canExport ? <ExportRecordButton contactId={id} /> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
