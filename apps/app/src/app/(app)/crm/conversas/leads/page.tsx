import type { Metadata } from "next";
import { ContactsExplorer } from "@/components/crm/contacts/ContactsExplorer";
import { ConversasTabs } from "@/components/crm/inbox/ConversasTabs";
import { requireCrm } from "@/lib/auth/dal";
import { loadContactsBoard } from "@/modules/crm/contacts-board";
import type { ContactSearchParams } from "@/modules/crm/contacts-list";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

/**
 * LEADS (aba de Conversas): quem conversou com a clínica e ainda não virou paciente
 * (sem consulta marcada nem atendimento). Ao marcar a primeira consulta, a pessoa passa
 * sozinha para a página Pacientes.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<ContactSearchParams> }) {
  const ctx = await requireCrm("conversas.ver");
  const data = await loadContactsBoard(
    { clinicId: ctx.user.clinicId, can: (p) => (ctx.user.permissions as readonly string[]).includes(p), crm: true, pep: ctx.entitlements.modules.includes("pep") },
    await searchParams,
    {
      kind: "lead",
      path: "/crm/conversas/leads",
      title: "Leads",
      description: "Quem falou com a clínica e ainda não marcou consulta. Ao marcar, a pessoa vai para Pacientes.",
      other: ctx.can("pacientes.ver") ? { href: "/pacientes", label: "Ver pacientes", count: 0 } : null,
    },
  );
  data.newLabel = "Novo lead";
  return (
    <>
      <ConversasTabs active="leads" />
      <ContactsExplorer data={data} />
    </>
  );
}
