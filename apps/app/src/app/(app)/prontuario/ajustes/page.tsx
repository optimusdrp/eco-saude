import { redirect } from "next/navigation";

/** Endereço antigo: os ajustes do prontuário agora ficam em Ajustes > Prontuário (só gestão) */
export default function OldPepSettings() {
  redirect("/configuracoes/prontuario");
}
