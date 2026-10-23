import type { ClinicPermission } from "@ecosaude/core/crm";

/** Abas do Prontuário conforme as permissões (arquivo sem "use client": usado nas páginas do servidor) */
export function pepTabsFor(can: (p: ClinicPermission) => boolean) {
  const tabs: { href: string; label: string }[] = [];
  if (can("prontuario.ver") || can("prontuario.resumo") || can("prontuario.documentos") || can("prontuario.triagem")) tabs.push({ href: "/prontuario", label: "Pacientes" });
  if (can("prontuario.modelos")) tabs.push({ href: "/prontuario/modelos", label: "Modelos" }, { href: "/prontuario/ajustes", label: "Ajustes e acessos" });
  return tabs;
}
