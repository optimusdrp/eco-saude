import { clinicTimeZone, formatWhen } from "@ecosaude/core/crm";
import { DOCUMENT_KIND_LABEL } from "@ecosaude/core/pep";
import { eq, schema, withTenant } from "@ecosaude/db";
import { ArrowLeft, BadgeCheck, FileText, Lock, MessageSquareText, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DocumentButtons } from "@/components/pep/DocumentDialog";
import { EncounterEditor } from "@/components/pep/EncounterEditor";
import { EncounterContent } from "@/components/pep/EncounterView";
import { PatientSummary } from "@/components/pep/PatientSummary";
import { AddendumForm, DiscardDraftButton, RevokeDocumentButton } from "@/components/pep/widgets";
import { Badge, Panel } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requirePep } from "@/lib/auth/dal";
import { accessFor, auditOpen, loadPepSettings } from "@/modules/pep/access";
import { loadEncounter, loadPatient } from "@/modules/pep/records";

export const metadata: Metadata = { title: "Atendimento" };

/**
 * ATENDIMENTO
 *  - Rascunho do próprio profissional: edição com salvamento automático, documentos e finalizar.
 *  - Finalizado (ou de outro profissional): leitura, adendos e documentos emitidos.
 */
export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requirePep("prontuario.ver");

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const e = await loadEncounter(tx, id);
    if (!e) return null;
    const { access, viaEmergency } = await accessFor(tx, ctx, e.contactId);
    if (access !== "liberado") return { blocked: true as const, contactId: e.contactId };
    await auditOpen(tx, ctx, e.contactId);
    const patient = (await loadPatient(tx, e.contactId))!;
    const settings = await loadPepSettings(tx);
    const [triage] = e.appointmentId ? await tx.select().from(schema.pepTriages).where(eq(schema.pepTriages.appointmentId, e.appointmentId)) : [];
    return { blocked: false as const, e, patient, settings, viaEmergency, triage: triage ?? null };
  });
  if (!data) notFound();
  if (data.blocked) redirect(`/prontuario/pacientes/${data.contactId}`);
  const { e, patient, settings, viaEmergency, triage } = data;

  const isAuthor = e.professional.userId === ctx.user.id;
  const canAttend = ctx.can("prontuario.atender");
  const editable = e.status === "rascunho" && isAuthor && canAttend;
  const canIssue = isAuthor && canAttend && !patient.anonymized;
  const allergies = patient.profile.allergies.map((a) => a.name);
  const council = e.professional.council && e.professional.councilNumber ? `${e.professional.council}${e.professional.councilUf ? `-${e.professional.councilUf}` : ""} ${e.professional.councilNumber}` : null;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/prontuario/pacientes/${e.contactId}`} className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Prontuário de {patient.identity.name.split(" ")[0]}
      </Link>
      {viaEmergency ? (
        <p role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          Aberto com acesso de emergência (registrado).
        </p>
      ) : null}

      <PatientSummary patient={patient} canEdit={canAttend && !patient.anonymized} compact />

      <header className="mt-5 mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-pep">{e.templateName ?? "Atendimento"}</p>
          <h2 className="text-2xl font-bold">
            {e.startedAt.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: clinicTimeZone() })}, {e.professional.name}
          </h2>
          {council ? <p className="text-sm text-ink-soft">{council}</p> : null}
        </div>
        {e.status === "finalizado" ? (
          <Badge tone="success" className="gap-1.5">
            <Lock className="size-3.5" aria-hidden />
            Finalizado {e.finishedAt ? formatWhen(e.finishedAt) : ""}
          </Badge>
        ) : (
          <Badge tone="warning">Rascunho</Badge>
        )}
      </header>

      {/* Triagem da consulta (enfermagem): queixa, prioridade e observações; os sinais vitais já entraram no atendimento */}
      {triage ? (
        <section aria-label="Triagem" className={triage.priority === "urgente" ? "mb-4 rounded-2xl bg-alert-tint p-4 ring-1 ring-alert/30" : "mb-4 rounded-2xl bg-pep-tint/60 p-4 ring-1 ring-pep/20"}>
          <p className="text-sm font-semibold">
            Triagem por {triage.recordedByName}, {formatWhen(triage.updatedAt)}
            {triage.priority !== "normal" ? <Badge tone={triage.priority === "urgente" ? "alert" : "warning"} className="ml-2">{triage.priority === "urgente" ? "Urgente" : "Prioritário"}</Badge> : null}
          </p>
          {triage.complaint ? <p className="mt-1">Queixa: {triage.complaint}</p> : null}
          {triage.notes ? <p className="mt-1 text-sm text-ink-soft">{triage.notes}</p> : null}
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {editable ? (
            <EncounterEditor
              id={e.id}
              version={e.version}
              fields={e.templateFields}
              answers={e.answers}
              vitals={e.vitals as Record<string, number>}
              diagnoses={e.diagnoses}
              conduct={e.conduct}
              returnDays={e.returnDays}
              returnNote={e.returnNote}
              defaultReturnDays={settings.defaultReturnDays}
              age={patient.age}
              sex={patient.identity.sex}
            />
          ) : (
            <div className="space-y-5">
              {e.status === "rascunho" ? (
                <p className="rounded-xl bg-erp-tint px-3 py-2 text-sm font-semibold text-erp-ink">Atendimento em andamento por {e.professional.name}. Você vê o rascunho, mas só quem atende registra.</p>
              ) : null}
              <Panel>
                <EncounterContent fields={e.templateFields} answers={e.answers} vitals={e.vitals} diagnoses={e.diagnoses} conduct={e.conduct} returnDays={e.returnDays} returnNote={e.returnNote} age={patient.age} />
              </Panel>
              {e.status === "finalizado" ? (
                <Panel title="Adendos" description="Complementos e correções feitos depois da finalização.">
                  {e.addenda.length ? (
                    <ul className="mb-4 space-y-2">
                      {e.addenda.map((a) => (
                        <li key={a.id} className="rounded-xl bg-fog p-3">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                            <MessageSquareText className="size-3.5" aria-hidden />
                            {a.authorName}, {formatWhen(a.createdAt)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">{a.text}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {canAttend ? <AddendumForm encounterId={e.id} /> : null}
                </Panel>
              ) : null}
              {e.hash ? (
                <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <BadgeCheck className="size-3.5" aria-hidden />
                  Registro íntegro e travado. Código de integridade {e.hash.slice(0, 16)}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* ------------------------------- Documentos ------------------------------- */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start" aria-label="Documentos do atendimento">
          <Panel title="Documentos">
            {e.documents.length ? (
              <ul className="mb-3 divide-y divide-line">
                {e.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-1 py-1.5">
                    <a href={`/api/prontuario/documentos/${d.id}/pdf`} target="_blank" rel="noopener" className={cn("flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-sm font-semibold hover:text-pep", d.revokedAt && "text-ink-soft line-through")}>
                      <FileText className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{DOCUMENT_KIND_LABEL[d.kind]}</span>
                      {d.revokedAt ? <span className="sr-only">(cancelado)</span> : null}
                    </a>
                    {canIssue && !d.revokedAt ? <RevokeDocumentButton documentId={d.id} label={DOCUMENT_KIND_LABEL[d.kind]} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canIssue ? (
              council ? (
                <DocumentButtons encounterId={e.id} diagnoses={e.diagnoses} allergies={allergies} startedAt={e.startedAt.toISOString()} />
              ) : (
                <p className="text-sm text-ink-soft">
                  Para emitir receita e atestado, cadastre o registro no conselho de {e.professional.name} em{" "}
                  {ctx.can("config.clinica") ? (
                    <Link href="/configuracoes/clinica" className="font-semibold text-pep underline underline-offset-2">
                      Ajustes &gt; Clínica
                    </Link>
                  ) : (
                    "Ajustes > Clínica (peça à gestão)"
                  )}
                  .
                </p>
              )
            ) : !e.documents.length ? (
              <p className="text-sm text-ink-soft">Nenhum documento emitido.</p>
            ) : null}
          </Panel>
          {editable ? <DiscardDraftButton encounterId={e.id} /> : null}
        </aside>
      </div>
    </div>
  );
}
