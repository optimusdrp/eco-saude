import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ContactsExplorer } from "@/components/crm/contacts/ContactsExplorer";
import { NewPatientButton } from "@/components/pep/widgets";
import { getEntitlements, requireUser } from "@/lib/auth/dal";
import { loadContactsBoard } from "@/modules/crm/contacts-board";
import type { ContactSearchParams } from "@/modules/crm/contacts-list";

export const metadata: Metadata = { title: "Pacientes" };
export const dynamic = "force-dynamic";

/**
 * PACIENTES: todos os pacientes efetivos da clínica (substitui as antigas páginas Contatos e
 * Prontuário). Paciente = cadastrado como paciente, com consulta marcada ou já atendido;
 * os demais (leads) ficam na aba "Leads" de Conversas.
 *
 * Quem entra: quem vê cadastros (Atendimento) ou alguma parte do prontuário. Cada atalho
 * aparece conforme a permissão: conversa e agenda (Atendimento), prontuário e alergia
 * (Prontuário). Cada página de destino confere a permissão de novo no servidor.
 */
export default async function PatientsPage({ searchParams }: { searchParams: Promise<ContactSearchParams> }) {
  const user = await requireUser();
  const can = (p: string) => (user.permissions as readonly string[]).includes(p);
  const { modules } = await getEntitlements(user.clinicId);
  const crm = modules.includes("crm");
  const pep = modules.includes("pep");
  const pepRead = pep && (can("prontuario.ver") || can("prontuario.resumo") || can("prontuario.documentos") || can("prontuario.triagem"));
  if (!(crm && can("pacientes.ver")) && !pepRead) redirect(crm || pep ? "/sem-permissao" : "/modulos/crm");

  const data = await loadContactsBoard(
    { clinicId: user.clinicId, can, crm, pep },
    await searchParams,
    {
      kind: "paciente",
      path: "/pacientes",
      title: "Pacientes",
      description: "Todos os pacientes da clínica. Clique no nome para o resumo; o ícone do coração abre o prontuário.",
      other: crm && can("conversas.ver") ? { href: "/crm/conversas/leads", label: "Ver leads em Conversas", count: 0 } : null,
    },
  );
  data.newLabel = "Cadastrar paciente";
  // Sem o Atendimento, o cadastro é o do Prontuário (já entra como paciente e abre o prontuário)
  const actions = !crm && pep && can("prontuario.atender") ? <NewPatientButton /> : null;
  return <ContactsExplorer data={data} actions={actions} />;
}
