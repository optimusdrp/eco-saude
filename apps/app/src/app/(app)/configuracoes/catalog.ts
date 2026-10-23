import type { ClinicPermission } from "@ecosaude/core/crm";

/**
 * CATÁLOGO DOS AJUSTES
 * Uma lista só, usada pelo menu lateral, pelo painel inicial e pela busca.
 * Cada item diz quem pode ver (permissão) e as palavras que a busca encontra.
 */
export type SettingsIcon = "conta" | "preferencias" | "clinica" | "automacoes" | "canais" | "respostas" | "retornos" | "equipe" | "perfis" | "seguranca" | "plano" | "mensagens" | "ia" | "duracoes" | "unidades" | "prontuario" | "formularios";

export interface SettingsItem {
  href: string;
  label: string;
  hint: string;
  icon: SettingsIcon;
  /** null = todos podem ver */
  permission: ClinicPermission | null;
  /** Só aparece com este módulo contratado (ex.: "pep" para os ajustes do prontuário) */
  module?: string;
  /** O que a busca deve achar aqui (além do nome) */
  keywords: string[];
}

export interface SettingsGroup {
  label: string;
  items: SettingsItem[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Você",
    items: [
      {
        href: "/configuracoes/conta",
        label: "Minha conta",
        hint: "Senha, verificação em duas etapas e aparelhos conectados",
        icon: "conta",
        permission: null,
        keywords: ["senha", "2fa", "duas etapas", "autenticador", "sessão", "aparelhos", "sair", "login", "e-mail"],
      },
      {
        href: "/configuracoes/preferencias",
        label: "Preferências",
        hint: "Tamanho do texto e personalizações salvas neste navegador",
        icon: "preferencias",
        permission: null,
        keywords: ["texto", "fonte", "letra", "tamanho", "acessibilidade", "personalização", "restaurar", "rascunhos", "padrão", "animações"],
      },
    ],
  },
  {
    label: "Clínica",
    items: [
      {
        href: "/configuracoes/clinica",
        label: "Clínica e profissionais",
        hint: "Dados da clínica, quem atende, horários de cada dia e ausências",
        icon: "clinica",
        permission: "config.clinica",
        keywords: [
          "profissional",
          "médico",
          "dentista",
          "expediente",
          "horário",
          "intervalo",
          "almoço",
          "duração",
          "agenda",
          "cor",
          "férias",
          "ausência",
          "folga",
          "feriado",
          "nome da clínica",
          "telefone",
          "endereço",
          "cidade",
        ],
      },
      {
        href: "/configuracoes/unidades",
        label: "Unidades e consultórios",
        hint: "Endereços onde a clínica atende e os consultórios de cada um",
        icon: "unidades",
        permission: "config.clinica",
        keywords: ["unidade", "filial", "endereço", "consultório", "sala", "cnes", "cep", "procedimento", "local", "sede"],
      },
      {
        href: "/configuracoes/duracoes",
        label: "Duração das consultas",
        hint: "Quanto cada consulta dura de verdade e a duração sugerida",
        icon: "duracoes",
        permission: "config.clinica",
        keywords: ["duração", "tempo", "consulta", "atraso", "chegada", "saída", "procedimento", "minutos", "agenda atrasando"],
      },
      {
        href: "/configuracoes/automacoes",
        label: "Automações",
        hint: "Ligar, desligar e criar regras: quando acontecer algo, o Tropi age sozinho",
        icon: "automacoes",
        permission: "config.automacoes",
        keywords: [
          "confirmação",
          "automático",
          "lembrete",
          "véspera",
          "pesquisa",
          "satisfação",
          "nps",
          "sair",
          "reativar",
          "falta",
          "regra",
          "gatilho",
          "aniversário",
          "boas-vindas",
          "fora do horário",
          "desligar",
        ],
      },
      {
        href: "/configuracoes/mensagens",
        label: "Mensagens automáticas",
        hint: "Textos de confirmação, lembrete, pesquisa, lista de espera e outros",
        icon: "mensagens",
        permission: "config.mensagens",
        keywords: ["texto", "mensagem", "modelo", "lembrete", "confirmação", "pesquisa", "nps", "aniversário", "boas-vindas", "variáveis", "oferta", "remarcação"],
      },
      {
        href: "/configuracoes/ia",
        label: "Inteligência artificial",
        hint: "Escolha quais funcionalidades com IA a clínica usa, e o que é enviado",
        icon: "ia",
        permission: "config.ia",
        keywords: ["ia", "inteligência artificial", "gemini", "rascunho", "sugerir resposta", "intenção", "classificar", "lgpd", "dados", "chave", "modelo", "testar"],
      },
    ],
  },
  {
    label: "Atendimento",
    items: [
      {
        href: "/configuracoes/canais",
        label: "Canais",
        hint: "WhatsApp, Instagram, Messenger e Telegram",
        icon: "canais",
        permission: "config.canais",
        keywords: ["whatsapp", "instagram", "messenger", "facebook", "telegram", "token", "webhook", "simulação", "real", "meta"],
      },
      {
        href: "/configuracoes/respostas",
        label: "Respostas rápidas",
        hint: "Textos prontos com / e modelos aprovados da Meta",
        icon: "respostas",
        permission: "config.respostas",
        keywords: ["atalho", "modelo", "template", "texto pronto", "barra", "24h", "janela"],
      },
      {
        href: "/configuracoes/retornos",
        label: "Protocolos de retorno",
        hint: "Quando cada paciente deve voltar e a mensagem do lembrete",
        icon: "retornos",
        permission: "retornos.protocolos",
        keywords: ["retorno", "revisão", "protocolo", "lembrete", "semestral", "dias"],
      },
    ],
  },
  {
    // Prontuário: quem configura é a GESTÃO (não o profissional de saúde no dia a dia)
    label: "Prontuário",
    items: [
      {
        href: "/configuracoes/prontuario/modelos",
        label: "Formulários de atendimento",
        hint: "Formulários por especialidade e qual cada profissional usa",
        icon: "formularios",
        permission: "prontuario.modelos",
        module: "pep",
        keywords: ["modelo", "formulário", "anamnese", "evolução", "especialidade", "primeira consulta", "retorno", "campos", "odontologia", "psicologia", "fisioterapia", "nutrição"],
      },
      {
        href: "/configuracoes/prontuario",
        label: "Regras e acessos do prontuário",
        hint: "Áreas da clínica, sigilo, cabeçalho dos documentos e acessos sensíveis",
        icon: "prontuario",
        permission: "prontuario.modelos",
        module: "pep",
        keywords: ["sigilo", "emergência", "acesso", "auditoria", "cabeçalho", "documento", "retorno", "área", "especialidades", "lgpd"],
      },
    ],
  },
  {
    label: "Gestão",
    items: [
      {
        href: "/configuracoes/equipe",
        label: "Equipe",
        hint: "Acessos de cada pessoa, perfil e ajustes individuais",
        icon: "equipe",
        permission: "config.equipe",
        keywords: ["usuário", "acesso", "pessoa", "convidar", "desativar", "senha temporária", "2fa"],
      },
      {
        href: "/configuracoes/perfis",
        label: "Perfis e permissões",
        hint: "Cargos da clínica e o que cada um pode fazer",
        icon: "perfis",
        permission: "config.permissoes",
        keywords: ["perfil", "cargo", "função", "permissão", "recepção", "gestor", "financeiro", "comercial", "enfermagem", "coordenação", "auditoria", "acesso"],
      },
      {
        href: "/configuracoes/seguranca",
        label: "Segurança e atividade",
        hint: "Pendências de segurança e o histórico do que a equipe fez",
        icon: "seguranca",
        permission: "config.seguranca",
        keywords: ["auditoria", "log", "histórico", "atividade", "lgpd", "exportação", "bloqueado", "2fa"],
      },
      {
        href: "/configuracoes/plano",
        label: "Plano e módulos",
        hint: "Módulos contratados e funcionalidades liberadas",
        icon: "plano",
        permission: "config.plano",
        keywords: ["plano", "assinatura", "módulo", "erp", "prontuário", "bi", "teste", "funcionalidade", "contrato"],
      },
    ],
  },
];

/** Grupos só com os itens que o perfil pode ver (e dos módulos contratados) */
export function visibleGroups(can: (p: ClinicPermission) => boolean, modules?: readonly string[]): SettingsGroup[] {
  return SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (!i.permission || can(i.permission)) && (!i.module || !modules || modules.includes(i.module))) })).filter((g) => g.items.length);
}
