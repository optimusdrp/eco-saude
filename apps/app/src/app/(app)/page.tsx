import { redirect } from "next/navigation";
import { getEntitlements, requireUser } from "@/lib/auth/dal";

/**
 * Página inicial depois do login:
 *  - profissional de saúde (com o Prontuário contratado): o Consultório, com os pacientes do dia;
 *  - demais: o "Hoje" do Atendimento; clínica só com o Prontuário começa pelo Prontuário.
 */
export default async function Home() {
  const user = await requireUser();
  const ent = await getEntitlements(user.clinicId);
  const pep = ent.modules.includes("pep");
  if (pep && user.healthProfessional && user.permissions.includes("prontuario.consultorio")) redirect("/consultorio");
  if (!ent.modules.includes("crm") && pep) redirect(user.permissions.includes("prontuario.consultorio") ? "/consultorio" : "/prontuario");
  redirect("/hoje");
}
