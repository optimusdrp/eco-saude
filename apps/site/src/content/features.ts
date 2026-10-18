import type { Feature, Role } from "@/types";

/**
 * Funcionalidades pouco exploradas pelo mercado.
 * Algumas têm demonstração interativa própria (ver src/components/demos).
 */
export const features: Feature[] = [
  {
    id: "lista-espera",
    title: "Cancelou? O horário já tem dono",
    description:
      "Quando um paciente desmarca, o sistema oferece o horário aos próximos da lista de espera pelo canal que cada um prefere. A primeira confirmação fica com a vaga.",
    modules: ["crm"],
  },
  {
    id: "risco-falta",
    title: "Risco de falta antes da falta",
    description:
      "Cada agendamento recebe um nível de risco calculado pelo histórico do paciente, e o sistema sugere a ação: confirmação reforçada, lembrete por outro canal ou encaixe.",
    modules: ["crm", "bi"],
  },
  {
    id: "retorno-protocolo",
    title: "Retornos que não dependem de memória",
    description:
      "Protocolos como revisão semestral ou exame anual geram lembretes automáticos no momento certo. Pacientes inativos entram em campanhas de reativação.",
    modules: ["crm", "pep"],
  },
  {
    id: "linha-tempo",
    title: "Uma linha do tempo por paciente",
    description:
      "Mensagens, consultas, pagamentos e registros clínicos em ordem cronológica. Cada perfil vê apenas o que tem permissão para ver.",
    modules: ["crm", "erp", "pep"],
  },
  {
    id: "comandos",
    title: "Tudo a um atalho de distância",
    description:
      "Ctrl+K abre a barra de comandos: buscar paciente, marcar consulta ou responder uma conversa sem navegar por menus. Experimente nesta página.",
    modules: ["crm", "erp", "pep", "bi"],
  },
  {
    id: "contingencia",
    title: "Painel de contingência",
    description:
      "Se a internet cai, um painel mostra em linguagem simples o que ficou salvo no aparelho, o que espera para sincronizar e o que precisa de decisão humana.",
    modules: ["crm", "erp", "pep", "bi"],
  },
];

/**
 * Perfis da demonstração do herói.
 * A mesma clínica, três telas diferentes: a interface se adapta a quem usa.
 */
export const roles: Role[] = [
  {
    id: "recepcao",
    label: "Recepção",
    device: "desktop",
    headline: "Fila do dia, conversas e confirmações",
  },
  {
    id: "medico",
    label: "Médico",
    device: "tablet",
    headline: "Próximo paciente e histórico em uma tela",
  },
  {
    id: "gestor",
    label: "Gestão",
    device: "phone",
    headline: "Indicadores da semana no celular",
  },
];
