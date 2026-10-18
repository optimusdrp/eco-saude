/**
 * ATIVIDADE DA EQUIPE (Ajustes > Segurança e atividade)
 * Traduz cada registro da trilha da clínica (crm_events) numa frase e numa
 * categoria. Eventos de paciente reaproveitam describeEvent (mesmo texto da
 * linha do tempo da ficha); os de acesso e configuração são descritos aqui.
 */
import { CHANNEL_LABEL, CLINIC_ROLE_LABEL, type Channel, type ClinicRole } from "@ecosaude/core/crm";
import { describeEvent } from "./format";

export type ActivityCategory = "acesso" | "pacientes" | "exportacao" | "configuracao" | "automacao";

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  acesso: "Acessos",
  pacientes: "Contatos e agenda",
  exportacao: "Exportações (LGPD)",
  configuracao: "Configurações",
  automacao: "Automações",
};

type Data = Record<string, unknown> | null;

const SYSTEM: Record<string, (d: Record<string, unknown>) => string> = {
  "auth.login": () => "Entrou no sistema",
  "auth.login_failed": () => "Tentativa de login com senha errada",
  "auth.password_changed": () => "Trocou a própria senha",
  "auth.2fa_enabled": () => "Ligou a verificação em duas etapas",
  "auth.2fa_disabled": () => "Desligou a verificação em duas etapas",
  "auth.sessions_ended": () => "Desconectou outros aparelhos",
  user_created: (d) => `Criou o acesso de ${String(d.email ?? "")}${d.perfilNome || d.perfil ? ` (${String(d.perfilNome ?? CLINIC_ROLE_LABEL[d.perfil as ClinicRole] ?? d.perfil)})` : ""}`,
  user_updated: (d) => `Alterou um acesso${d.perfilNome || d.perfil ? ` (perfil ${String(d.perfilNome ?? CLINIC_ROLE_LABEL[d.perfil as ClinicRole] ?? d.perfil)})` : ""}`,
  user_access_updated: (d) =>
    `Ajustou o acesso de alguém da equipe (perfil ${String(d.perfilNome ?? "")}${Number(d.liberadas) ? `, ${String(d.liberadas)} liberada(s)` : ""}${Number(d.bloqueadas) ? `, ${String(d.bloqueadas)} bloqueada(s)` : ""})`,
  role_created: (d) => `Criou o perfil ${String(d.perfil ?? "")}`,
  role_updated: (d) => `Alterou as permissões do perfil ${String(d.perfil ?? "")}`,
  role_deleted: (d) => `Excluiu o perfil ${String(d.perfil ?? "")}`,
  user_enabled: () => "Reativou um acesso",
  user_disabled: () => "Desativou um acesso",
  user_password_reset: () => "Gerou senha temporária para alguém da equipe",
  user_2fa_reset: () => "Zerou a verificação em duas etapas de alguém da equipe",
  channel_updated: (d) => `Alterou o canal ${CHANNEL_LABEL[d.canal as Channel] ?? String(d.canal ?? "")}${d.modo ? ` (modo ${String(d.modo)})` : ""}`,
  crm_settings_updated: () => "Alterou a confirmação automática",
  professional_created: (d) => `Cadastrou o profissional ${String(d.nome ?? "")}`,
  professional_updated: (d) => `Alterou o profissional ${String(d.nome ?? "")}`,
  professional_absence: (d) =>
    `Marcou ausência de ${String(d.nome ?? "")} (${String(d.de ?? "")
      .split("-")
      .reverse()
      .join("/")} a ${String(d.ate ?? "")
      .split("-")
      .reverse()
      .join("/")})`,
  professional_absence_removed: () => "Removeu uma ausência de profissional",
  "clinic.profile_updated": () => "Alterou os dados da clínica",
  automation_updated: (d) => `${d.ligada ? "Ligou ou ajustou" : "Desligou"} a automação ${String(d.automacao ?? "")}`,
  rule_created: (d) => `Criou a regra de automação ${String(d.regra ?? "")}${d.pelaFrase ? " (descrita em português)" : ""}`,
  quick_replies_mined: (d) => `Procurou respostas repetidas: ${String(d.sugestoes ?? 0)} sugestões`,
  quick_reply_suggestion: (d) => `${d.decisao === "aceita" ? "Criou o atalho" : "Descartou a sugestão"} /${String(d.atalho ?? "")}`,
  service_audit_run: (d) => `Auditoria de atendimento: ${String(d.avaliadas ?? 0)} conversas avaliadas (semana ${String(d.semana ?? "")})`,
  rule_updated: (d) => `${d.ligada === false ? "Desligou" : d.ligada === true ? "Ligou" : "Alterou"} a regra ${String(d.regra ?? "")}`,
  rule_deleted: (d) => `Excluiu a regra ${String(d.regra ?? "")}`,
  template_updated: (d) => `${d.padrao ? "Restaurou o texto padrão de" : d.ligada === false ? "Desligou" : "Alterou"} a mensagem ${String(d.mensagem ?? "")}`,
  offer_cancelled: () => "Cancelou uma oferta da lista de espera",
  contacts_export: (d) => `Exportou a lista de contatos (${String(d.linhas ?? 0)} linhas)`,
};

export function categoryOf(type: string, actorId: string | null): ActivityCategory {
  if (type.startsWith("auth.")) return "acesso";
  if (type === "contacts_export" || type === "data_export") return "exportacao";
  if (
    type.startsWith("clinic.") ||
    type.startsWith("user_") ||
    type.startsWith("role_") ||
    type.startsWith("rule_") ||
    type === "automation_updated" ||
    type === "template_updated" ||
    type.startsWith("professional_") ||
    type === "channel_updated" ||
    type === "crm_settings_updated"
  )
    return "configuracao";
  if (!actorId) return "automacao";
  return "pacientes";
}

export function describeActivity(type: string, data: Data, now: Date): string {
  const fn = SYSTEM[type];
  return fn ? fn(data ?? {}) : describeEvent(type, data, now);
}
