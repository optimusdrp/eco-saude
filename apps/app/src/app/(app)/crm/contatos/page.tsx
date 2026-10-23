import { redirect } from "next/navigation";
import type { ContactSearchParams } from "@/modules/crm/contacts-list";

/**
 * Endereço antigo da lista de Contatos. Agora são duas listas:
 *  - Pacientes (menu): pacientes efetivos;
 *  - Leads (aba de Conversas): quem ainda não marcou consulta.
 * Links salvos continuam funcionando (os filtros vão junto).
 */
export default async function OldContactsPage({ searchParams }: { searchParams: Promise<ContactSearchParams> }) {
  const sp = await searchParams;
  const { tipo, ...rest } = sp;
  const qs = new URLSearchParams(Object.entries(rest).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  redirect(`${tipo === "lead" ? "/crm/conversas/leads" : "/pacientes"}${qs ? `?${qs}` : ""}`);
}
