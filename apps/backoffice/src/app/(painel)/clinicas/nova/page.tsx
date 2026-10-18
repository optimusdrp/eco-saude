import { db, eq, schema } from "@ecosaude/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui/server";
import { requirePermission } from "@/lib/auth/dal";
import { ClinicForm } from "../forms";

export const metadata: Metadata = { title: "Nova clínica" };

/**
 * Cadastro de clínica. Com ?lead=<id>, os dados do lead vêm preenchidos
 * e, ao salvar, o lead é marcado como "ganho" e ligado à clínica.
 */
export default async function NewClinicPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  await requirePermission("clinics.edit");
  const leadId = (await searchParams).lead;
  const lead =
    leadId && /^[0-9a-f-]{36}$/i.test(leadId)
      ? await db.query.leads.findFirst({ where: eq(schema.leads.id, leadId) })
      : undefined;

  return (
    <>
      <PageHeader
        back={
          <Link href={lead ? `/leads/${lead.id}` : "/clinicas"} className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {lead ? "Voltar ao lead" : "Clínicas"}
          </Link>
        }
        title="Nova clínica"
        description={lead ? `Convertendo o lead de ${lead.name} em cliente.` : "Depois de salvar, você poderá adicionar as contratações."}
      />
      <Panel className="max-w-3xl">
        <ClinicForm clinic={lead ? { tradeName: lead.clinicName, email: lead.email } : {}} leadId={lead && !lead.clinicId ? lead.id : undefined} />
      </Panel>
    </>
  );
}
