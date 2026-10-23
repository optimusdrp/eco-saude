import { redirect } from "next/navigation";

/**
 * Endereço antigo do Prontuário (busca de pacientes): agora é a página Pacientes, que lista
 * todos os pacientes efetivos com o atalho para o prontuário de cada um. Atendimentos não
 * finalizados aparecem no Consultório.
 */
export default async function OldPepHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  redirect(q ? `/pacientes?${new URLSearchParams({ q })}` : "/pacientes");
}
