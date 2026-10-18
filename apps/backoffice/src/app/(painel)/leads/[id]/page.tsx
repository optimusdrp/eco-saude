import { can, CLINIC_SIZE_LABEL, LEAD_STAGE_LABEL, type LeadStage } from "@ecosaude/core";
import { and, asc, db, desc, eq, inArray, schema } from "@ecosaude/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonStyles } from "@/components/ui/styles";
import { Badge, DataList, ModuleBadge, PageHeader, Panel } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { LeadNoteForm, LeadStatusForm } from "./forms";

export const metadata: Metadata = { title: "Lead" };
export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("leads.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const lead = await db.query.leads.findFirst({
    where: eq(schema.leads.id, id),
    with: {
      clinic: { columns: { id: true, tradeName: true } },
      notes: { orderBy: desc(schema.leadNotes.createdAt), with: { author: { columns: { name: true } } } },
    },
  });
  if (!lead) notFound();

  const [owners, events] = await Promise.all([
    // Responsáveis possíveis: quem é ativo e tem perfil comercial ou admin
    db.query.staffUsers.findMany({
      where: and(eq(schema.staffUsers.active, true), inArray(schema.staffUsers.role, ["admin", "comercial"])),
      columns: { id: true, name: true },
      orderBy: asc(schema.staffUsers.name),
    }),
    db.query.auditLog.findMany({
      where: and(eq(schema.auditLog.entity, "lead"), eq(schema.auditLog.entityId, id), eq(schema.auditLog.action, "lead.updated")),
      orderBy: desc(schema.auditLog.createdAt),
      limit: 50,
    }),
  ]);

  const canEdit = can(user.role, "leads.edit");
  const canConvert = can(user.role, "clinics.edit") && !lead.clinic;
  const names = new Map(owners.map((o) => [o.id, o.name]));

  // Linha do tempo: anotações + mudanças de etapa/responsável, em ordem cronológica
  type Item = { at: Date; who: string; text: string; kind: "note" | "event" };
  const timeline: Item[] = [
    ...lead.notes.map((n) => ({ at: n.createdAt, who: n.author?.name ?? "Usuário removido", text: n.body, kind: "note" as const })),
    ...events.map((e) => ({ at: e.createdAt, who: e.actorEmail ?? "Sistema", text: describeChange(e.data, names), kind: "event" as const })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <PageHeader
        back={
          <Link href="/leads" className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Leads
          </Link>
        }
        title={lead.clinicName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {lead.name}
            <Badge tone={lead.stage === "ganho" ? "success" : lead.stage === "perdido" ? "neutral" : "crm"}>
              {LEAD_STAGE_LABEL[lead.stage as LeadStage]}
            </Badge>
          </span>
        }
        actions={
          lead.clinic ? (
            <Link href={`/clinicas/${lead.clinic.id}`} className={buttonStyles("secondary")}>
              Ver clínica {lead.clinic.tradeName}
            </Link>
          ) : canConvert ? (
            <Link href={`/clinicas/nova?lead=${lead.id}`} className={buttonStyles("primary")}>
              Converter em cliente
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Contato">
            <DataList
              items={[
                ["E-mail", <a key="e" href={`mailto:${lead.email}`} className="font-semibold text-crm hover:underline">{lead.email}</a>],
                ["Tamanho da clínica", CLINIC_SIZE_LABEL[lead.size]],
                [
                  "Módulos de interesse",
                  <span key="m" className="flex flex-wrap gap-1">
                    {lead.interests.map((m) => <ModuleBadge key={m} id={m} />)}
                  </span>,
                ],
                ["Origem", lead.source === "site" ? "Formulário do site" : lead.source],
                ["Recebido em", formatDateTime(lead.createdAt)],
                ["Consentimento LGPD", formatDateTime(lead.consentAt)],
              ]}
            />
          </Panel>

          <Panel title="Andamento">
            <LeadStatusForm lead={lead} owners={owners} disabled={!canEdit} />
          </Panel>
        </div>

        <Panel title="Histórico">
          {canEdit ? (
            <div className="mb-5 border-b border-line pb-5">
              <LeadNoteForm leadId={lead.id} />
            </div>
          ) : null}
          {timeline.length === 0 ? (
            <p className="text-ink-soft">Nada registrado ainda.</p>
          ) : (
            <ol className="space-y-4">
              {timeline.map((item, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className={item.kind === "note" ? "mt-1.5 size-2.5 shrink-0 rounded-full bg-crm" : "mt-1.5 size-2.5 shrink-0 rounded-full bg-ink/25"}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className={item.kind === "note" ? "whitespace-pre-line break-words" : "text-sm text-ink-soft"}>{item.text}</p>
                    <p className="text-xs text-ink-soft">
                      {item.who}, {formatDateTime(item.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}

/** Transforma o registro de auditoria em uma frase legível. */
function describeChange(data: Record<string, unknown> | null, names: Map<string, string>): string {
  if (!data) return "Lead atualizado.";
  const parts: string[] = [];
  const stage = data.stage as { de: LeadStage | null; para: LeadStage } | undefined;
  if (stage) {
    parts.push(
      stage.de
        ? `Etapa: ${LEAD_STAGE_LABEL[stage.de]} para ${LEAD_STAGE_LABEL[stage.para]}`
        : `Etapa: ${LEAD_STAGE_LABEL[stage.para]}`,
    );
  }
  if (data.convertedTo) parts.push("Convertido em cliente");
  const owner = data.ownerId as { para: string | null } | undefined;
  if (owner) parts.push(owner.para ? `Responsável: ${names.get(owner.para) ?? "outro usuário"}` : "Responsável removido");
  if (typeof data.lostReason === "string") parts.push(`Motivo da perda: ${data.lostReason}`);
  return parts.join(". ") + ".";
}
