import { MODULE_FULL_NAME, MODULE_LABEL } from "@ecosaude/core";
import type { EcosystemModule, ModuleConnection, ModuleId } from "@/types";

/**
 * Os cinco módulos do ecossistema Tropi.
 * A ordem do array define a ordem de exibição em todo o site (e a ordem do roadmap).
 * As cores de cada módulo ficam em packages/tokens/theme.css (--color-crm etc.).
 *
 * Situação (23/10/2026), sem prometer o que ainda não existe:
 *  - Atendimento e Prontuário: em teste (fase 1 do Prontuário entregue);
 *  - Gestão, Indicadores e Laboratório: planejados (o Laboratório tem código pausado).
 */
export const modules: EcosystemModule[] = [
  {
    id: "crm",
    name: MODULE_LABEL.crm,
    fullName: MODULE_FULL_NAME.crm,
    summary:
      "WhatsApp, Instagram, Messenger e Telegram em uma caixa só, agenda com confirmação automática, lista de espera e retornos.",
    submodules: [
      "Conversas de todos os canais",
      "Agenda e confirmação automática",
      "Lista de espera inteligente",
      "Retornos e reativação",
      "Jornada do paciente",
      "IA opcional para respostas",
    ],
    status: "em-teste",
  },
  {
    id: "pep",
    name: MODULE_LABEL.pep,
    fullName: MODULE_FULL_NAME.pep,
    summary:
      "Atendimento pela agenda, sinais vitais, CID-10, receitas e atestados com código de verificação, e registro de quem abriu cada prontuário.",
    submodules: [
      "Atendimento pela agenda",
      "Sinais vitais e CID-10",
      "Receitas, atestados e pedidos de exame",
      "Sigilo e acesso de emergência",
      "Assinatura digital (em breve)",
    ],
    status: "em-teste",
  },
  {
    id: "erp",
    name: MODULE_LABEL.erp,
    fullName: MODULE_FULL_NAME.erp,
    summary:
      "Financeiro, faturamento de convênios, estoque e repasse dos profissionais, por unidade e sem planilha paralela.",
    submodules: ["Financeiro e caixa", "Faturamento TISS", "Estoque e compras", "Repasse aos profissionais", "Notas fiscais"],
    status: "planejado",
  },
  {
    id: "bi",
    name: MODULE_LABEL.bi,
    fullName: MODULE_FULL_NAME.bi,
    summary:
      "Painéis prontos de ocupação da agenda e dos consultórios, faltas, faturamento e origem dos pacientes.",
    submodules: ["Painéis por perfil", "Ocupação por unidade", "Receita por origem", "Perguntas em linguagem natural"],
    status: "planejado",
  },
  {
    id: "lab",
    name: MODULE_LABEL.lab,
    fullName: MODULE_FULL_NAME.lab,
    summary:
      "Para laboratórios de análises clínicas, imagem e prótese: do pedido ao laudo, ligado às clínicas que usam o Tropi.",
    submodules: [
      "Pedidos e etiquetas com código de barras",
      "Coleta, bancada e liberação",
      "Imagem com laudo do radiologista",
      "Prótese dentária por etapa",
      "Laudo com código de verificação",
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
      "A ficha do paciente no Atendimento mostra o resumo do último atendimento, e o retorno combinado no consultório vira lembrete.",
  },
  {
    between: ["crm", "erp"],
    description:
      "Cada paciente captado é ligado à receita que gerou: você vê qual canal traz faturamento, não só contatos.",
  },
  {
    between: ["erp", "pep"],
    description: "Procedimentos registrados no prontuário viram guias de faturamento sem redigitação.",
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
  {
    between: ["lab", "pep"],
    description: "O pedido de exame sai do prontuário e o laudo volta para ele, sem papel nem redigitação.",
  },
  {
    between: ["lab", "crm"],
    description: "O preparo do exame vai pelo WhatsApp e o paciente é avisado quando o resultado fica pronto.",
  },
  {
    between: ["lab", "erp"],
    description: "Exames realizados entram no faturamento de convênios e na cobrança de clientes.",
  },
  {
    between: ["lab", "bi"],
    description: "Produção, prazos de entrega e atrasos do laboratório em painéis.",
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
