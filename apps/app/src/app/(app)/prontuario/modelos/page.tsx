import { redirect } from "next/navigation";

/** Endereço antigo: os modelos agora ficam em Ajustes > Prontuário > Formulários (só gestão) */
export default function OldPepTemplates() {
  redirect("/configuracoes/prontuario/modelos");
}
