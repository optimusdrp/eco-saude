import type { EcosystemModule, ModuleConnection, ModuleId } from "@/types";

/**
 * Os quatro módulos do ecossistema.
 * A ordem do array define a ordem de exibição em todo o site.
 * As cores de cada módulo ficam em globals.css (variáveis --color-crm etc.).
 */
export const modules: EcosystemModule[] = [
  {
    id: "crm",
    name: "CRM",
    fullName: "Relacionamento com pacientes",
    summary:
      "Conversas de todos os canais em uma caixa só, funil de novos pacientes, confirmações e campanhas de retorno.",
    submodules: [
      "Caixa de entrada omnichannel",
      "Funil de captação",
      "Confirmação de consultas",
      "Lista de espera inteligente",
      "Campanhas de retorno",
      "Pesquisa de satisfação",
    ],
    status: "em-teste",
  },
  {
    id: "erp",
    name: "ERP",
    fullName: "Gestão da clínica",
    summary:
      "Financeiro, faturamento de convênios, estoque e repasse dos profissionais, sem planilha paralela.",
    submodules: [
      "Financeiro e caixa",
      "Faturamento TISS",
      "Estoque e compras",
      "Repasse médico",
      "Notas fiscais",
    ],
    status: "em-desenvolvimento",
  },
  {
    id: "pep",
    name: "Prontuário",
    fullName: "Prontuário eletrônico",
    summary:
      "Evolução clínica, prescrições e exames com histórico completo e registro de quem alterou o quê.",
    submodules: [
      "Evolução por especialidade",
      "Prescrição e atestados",
      "Solicitação de exames",
      "Anexos e imagens",
      "Assinatura digital",
    ],
    status: "planejado",
  },
  {
    id: "bi",
    name: "BI",
    fullName: "Indicadores e análises",
    summary:
      "Painéis prontos de ocupação, faltas, faturamento e origem dos pacientes, com perguntas em linguagem natural.",
    submodules: [
      "Painéis por perfil",
      "Ocupação de agenda",
      "Receita por origem",
      "Perguntas em linguagem natural",
    ],
    status: "planejado",
  },
];

/**
 * O que acontece automaticamente quando dois módulos estão contratados.
 * Usado pelo configurador da seção "Ecossistema".
 */
export const connections: ModuleConnection[] = [
  {
    between: ["crm", "pep"],
    description:
      "A linha do tempo do paciente no CRM passa a mostrar o resumo do último atendimento.",
  },
  {
    between: ["crm", "erp"],
    description:
      "Cada paciente captado é ligado à receita que gerou: você vê qual canal traz faturamento, não só contatos.",
  },
  {
    between: ["erp", "pep"],
    description:
      "Procedimentos registrados no prontuário viram guias de faturamento sem redigitação.",
  },
  {
    between: ["bi", "crm"],
    description: "Painel de conversão: de mensagem recebida a consulta realizada.",
  },
  {
    between: ["bi", "erp"],
    description: "Painel financeiro com margem por procedimento e por convênio.",
  },
  {
    between: ["bi", "pep"],
    description: "Indicadores assistenciais, como retornos em atraso por especialidade.",
  },
];

/** Rótulos legíveis para o status de cada módulo. */
export const statusLabel: Record<EcosystemModule["status"], string> = {
  "em-teste": "Em teste",
  "em-desenvolvimento": "Em desenvolvimento",
  planejado: "Planejado",
};

/** Atalho para buscar um módulo pelo id (lança erro se o id não existir). */
export function getModule(id: ModuleId): EcosystemModule {
  const found = modules.find((m) => m.id === id);
  if (!found) throw new Error(`Módulo desconhecido: ${id}`);
  return found;
}
