/**
 * PERMISSÕES DA CLÍNICA
 *
 * Cada ação do Tropi exige UMA permissão. As permissões de uma pessoa vêm de:
 *
 *   permissões do perfil (cargo)  +  liberadas só para ela  −  bloqueadas só para ela
 *
 * - O perfil (cargo) é editável pela clínica. Os 3 perfis do sistema (Gestão,
 *   Recepção, Profissional de saúde) não podem ser excluídos, mas suas
 *   permissões podem ser alteradas. Novos cargos nascem de um modelo pronto.
 * - O servidor confere a permissão em TODA página e action (a tela só esconde
 *   o que a pessoa não pode usar; quem decide é o servidor).
 */
import type { ClinicRole } from "./constants";

export const PERMISSION_CATEGORIES = ["conversas", "agenda", "contatos", "tarefas", "retornos", "prontuario", "configuracoes"] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const PERMISSION_CATEGORY_LABEL: Record<PermissionCategory, string> = {
  conversas: "Conversas",
  agenda: "Agenda e lista de espera",
  contatos: "Contatos e jornada",
  tarefas: "Tarefas e qualidade",
  retornos: "Retornos",
  prontuario: "Prontuário",
  configuracoes: "Ajustes",
};

/**
 * Catálogo completo. A ORDEM aqui é a ordem das telas.
 * `sensitive`: permissão que dá acesso amplo a dados ou à administração
 * (a tela destaca, para o gestor pensar duas vezes antes de liberar).
 */
export const PERMISSION_CATALOG = [
  // Conversas
  { key: "conversas.ver", category: "conversas", label: "Ver conversas", hint: "Lista de conversas e histórico de mensagens." },
  { key: "conversas.responder", category: "conversas", label: "Responder conversas", hint: "Enviar mensagens, notas internas e usar respostas rápidas." },
  { key: "conversas.iniciar", category: "conversas", label: "Iniciar conversa", hint: "Mandar a primeira mensagem para um contato." },
  { key: "conversas.massa", category: "conversas", label: "Ações em várias conversas", hint: "Resolver, adiar ou marcar várias conversas de uma vez." },
  // Agenda
  { key: "agenda.ver", category: "agenda", label: "Ver a agenda", hint: "Agenda de todos os profissionais e horários livres." },
  { key: "agenda.editar", category: "agenda", label: "Marcar e remarcar consultas", hint: "Inclui marcar comparecimento e falta." },
  { key: "agenda.cancelar", category: "agenda", label: "Cancelar consultas", hint: "Libera o horário (e pode oferecer à lista de espera)." },
  { key: "agenda.confirmacoes", category: "agenda", label: "Pedir confirmações", hint: "Enviar o pedido de confirmação para várias consultas." },
  { key: "espera.gerir", category: "agenda", label: "Lista de espera", hint: "Incluir, remover e oferecer horários liberados." },
  // Contatos e jornada
  { key: "pacientes.ver", category: "contatos", label: "Ver contatos e fichas", hint: "Dados de contato, linha do tempo e consultas." },
  { key: "pacientes.editar", category: "contatos", label: "Editar contatos", hint: "Cadastrar, alterar dados, anotações e etiquetas." },
  { key: "contatos.massa", category: "contatos", label: "Etiquetas em massa", hint: "Aplicar ou tirar etiquetas de vários contatos." },
  { key: "contatos.mesclar", category: "contatos", label: "Mesclar cadastros duplicados", hint: "Juntar duas fichas da mesma pessoa." },
  { key: "contatos.exportar_ficha", category: "contatos", label: "Exportar dados de um paciente", hint: "Atender o pedido do titular (LGPD): baixa os dados de uma ficha." },
  {
    key: "pacientes.anonimizar",
    category: "contatos",
    label: "Excluir dados a pedido do paciente (LGPD)",
    hint: "Executar ou recusar pedidos de exclusão. Apaga de forma irreversível nome, contatos e conversas. Registrar o pedido só exige “Editar contatos”.",
    sensitive: true,
  },
  { key: "contatos.exportar", category: "contatos", label: "Exportar a lista de contatos", hint: "Baixar a planilha com vários contatos de uma vez.", sensitive: true },
  { key: "jornada.ver", category: "contatos", label: "Ver a jornada", hint: "Quadro de etapas do contato ao paciente." },
  { key: "jornada.editar", category: "contatos", label: "Mover na jornada", hint: "Mudar etapa e marcar como perdido." },
  { key: "jornada.responsavel", category: "contatos", label: "Definir responsável", hint: "Escolher quem da equipe cuida do contato." },
  // Tarefas
  { key: "tarefas.ver", category: "tarefas", label: "Ver e concluir tarefas", hint: "Tarefas próprias e da equipe." },
  { key: "tarefas.gerir", category: "tarefas", label: "Criar e editar tarefas", hint: "Criar, reatribuir, adiar e excluir." },
  {
    key: "qualidade.ver",
    category: "tarefas",
    label: "Qualidade do atendimento",
    hint: "Ver as notas da auditoria por amostragem de toda a equipe (cada pessoa sempre pode ver as próprias, se a clínica permitir).",
    sensitive: true,
  },
  // Retornos
  { key: "retornos.gerir", category: "retornos", label: "Radar de retornos", hint: "Ver quem deve voltar e enviar lembretes." },
  { key: "retornos.protocolos", category: "retornos", label: "Protocolos de retorno", hint: "Criar e editar as regras de retorno." },
  // Prontuário (módulo Tropi Prontuário). Dado de saúde (LGPD art. 11) e sigilo profissional:
  // cada nível mostra só o necessário para a função (princípio da necessidade, LGPD art. 6º, III).
  { key: "prontuario.consultorio", category: "prontuario", label: "Consultório (pacientes do dia)", hint: "Lista do dia com a situação de cada paciente: aguardando, chegou, triagem, em atendimento, finalizado. Sem conteúdo clínico." },
  {
    key: "prontuario.resumo",
    category: "prontuario",
    label: "Resumo de segurança",
    hint: "Alergias, medicamentos em uso e problemas ativos. Útil para enfermagem e para a recepção numa urgência.",
    sensitive: true,
  },
  { key: "prontuario.triagem", category: "prontuario", label: "Triagem e sinais vitais", hint: "Registrar e ver a pré-consulta (queixa, sinais vitais, prioridade) antes do atendimento.", sensitive: true },
  {
    key: "prontuario.documentos",
    category: "prontuario",
    label: "Documentos emitidos",
    hint: "Ver e reimprimir receitas, atestados e declarações para entregar ao paciente, sem ver a consulta.",
    sensitive: true,
  },
  {
    key: "prontuario.ver",
    category: "prontuario",
    label: "Atendimento completo (ler prontuários)",
    hint: "Anamnese, exame, diagnósticos, evolução e histórico. Só vale para quem tem perfil de profissional de saúde. Cada abertura fica registrada.",
    sensitive: true,
    healthProfessional: true,
  },
  {
    key: "prontuario.atender",
    category: "prontuario",
    label: "Atender e emitir documentos",
    hint: "Registrar atendimentos, adendos, receitas, atestados e pedidos de exame. Só vale para profissional de saúde.",
    healthProfessional: true,
  },
  { key: "prontuario.modelos", category: "prontuario", label: "Modelos e ajustes do prontuário", hint: "Modelos de anamnese e evolução, regra de sigilo, cabeçalho dos documentos e registro de acessos." },
  {
    key: "prontuario.acesso_emergencia",
    category: "prontuario",
    label: "Acesso de emergência",
    hint: "Abrir prontuário de paciente que não atendeu (quando a clínica restringe), com justificativa registrada e aviso à gestão. Só vale para profissional de saúde.",
    sensitive: true,
    healthProfessional: true,
  },
  { key: "prontuario.exportar", category: "prontuario", label: "Entregar cópia do prontuário", hint: "Gerar a cópia completa do prontuário a pedido do paciente (sem ler na tela).", sensitive: true },
  // Ajustes
  { key: "config.clinica", category: "configuracoes", label: "Clínica e profissionais", hint: "Dados da clínica, profissionais, horários e ausências." },
  { key: "config.automacoes", category: "configuracoes", label: "Automações", hint: "Ligar, desligar e criar regras automáticas." },
  { key: "config.ia", category: "configuracoes", label: "Inteligência artificial", hint: "Ligar e configurar as funcionalidades de IA (as mensagens passam pelo Gemini).", sensitive: true },
  { key: "config.mensagens", category: "configuracoes", label: "Mensagens automáticas", hint: "Textos de lembretes, confirmações e pesquisas." },
  { key: "config.respostas", category: "configuracoes", label: "Respostas rápidas", hint: "Textos prontos usados com / na conversa." },
  { key: "config.canais", category: "configuracoes", label: "Canais", hint: "WhatsApp, Instagram, Messenger e Telegram.", sensitive: true },
  { key: "config.equipe", category: "configuracoes", label: "Acessos da equipe", hint: "Criar acessos, gerar senha, desativar.", sensitive: true },
  { key: "config.permissoes", category: "configuracoes", label: "Perfis e permissões", hint: "Mudar o que cada perfil e cada pessoa pode fazer.", sensitive: true },
  { key: "config.seguranca", category: "configuracoes", label: "Segurança e atividade", hint: "Pendências de segurança e o histórico de ações.", sensitive: true },
  { key: "config.plano", category: "configuracoes", label: "Plano e módulos", hint: "Módulos contratados e funcionalidades." },
] as const satisfies readonly { key: string; category: PermissionCategory; label: string; hint: string; sensitive?: boolean; healthProfessional?: boolean }[];

export type ClinicPermission = (typeof PERMISSION_CATALOG)[number]["key"];
export const CLINIC_PERMISSIONS: readonly ClinicPermission[] = PERMISSION_CATALOG.map((p) => p.key);

const PERMISSION_SET = new Set<string>(CLINIC_PERMISSIONS);
export const isClinicPermission = (v: string): v is ClinicPermission => PERMISSION_SET.has(v);

export const PERMISSION_LABEL = Object.fromEntries(PERMISSION_CATALOG.map((p) => [p.key, p.label])) as Record<ClinicPermission, string>;

/** Catálogo agrupado por categoria, na ordem das telas. */
export function permissionsByCategory() {
  return PERMISSION_CATEGORIES.map((c) => ({ category: c, label: PERMISSION_CATEGORY_LABEL[c], items: PERMISSION_CATALOG.filter((p) => p.category === c) }));
}

/* --------------------------- Perfis do sistema ----------------------------- */

const ALL = CLINIC_PERMISSIONS;

/** Permissões iniciais dos 3 perfis do sistema (a clínica pode mudar depois). */
/**
 * PROFISSIONAL DE SAÚDE
 * Quem tem registro em conselho (CRM, CRO, COREN, CRP, CRN...), seja no próprio cadastro de
 * acesso ("perfil de profissional de saúde") ou por estar ligado a um profissional da agenda.
 *
 *  - HEALTH_PROFESSIONAL_ONLY: só valem para profissional de saúde. Para os demais, são
 *    ignoradas mesmo que o perfil ou a liberação individual tenham (sigilo profissional).
 *  - HEALTH_PROFESSIONAL_GRANTS: o profissional de saúde recebe automaticamente, qualquer que
 *    seja o cargo (ex.: a gestora que também é médica). A gestão pode bloquear individualmente.
 */
export const HEALTH_PROFESSIONAL_ONLY: readonly ClinicPermission[] = ["prontuario.ver", "prontuario.atender", "prontuario.acesso_emergencia"];
export const HEALTH_PROFESSIONAL_GRANTS: readonly ClinicPermission[] = [
  "prontuario.consultorio",
  "prontuario.resumo",
  "prontuario.triagem",
  "prontuario.documentos",
  "prontuario.ver",
  "prontuario.atender",
  "prontuario.acesso_emergencia",
];

/** Dado de saúde: fora dos padrões da gestão e dos cargos administrativos (a clínica libera se precisar) */
const CLINICAL: readonly ClinicPermission[] = [...HEALTH_PROFESSIONAL_ONLY, "prontuario.resumo", "prontuario.triagem", "prontuario.documentos"];

export const DEFAULT_ROLE_PERMISSIONS: Record<ClinicRole, readonly ClinicPermission[]> = {
  gestor: ALL.filter((p) => !CLINICAL.includes(p)),
  recepcao: [
    "conversas.ver",
    "conversas.responder",
    "conversas.iniciar",
    "conversas.massa",
    "agenda.ver",
    "agenda.editar",
    "agenda.cancelar",
    "agenda.confirmacoes",
    "espera.gerir",
    "pacientes.ver",
    "pacientes.editar",
    "contatos.massa",
    "contatos.mesclar",
    "contatos.exportar_ficha",
    "jornada.ver",
    "jornada.editar",
    "jornada.responsavel",
    "tarefas.ver",
    "tarefas.gerir",
    "retornos.gerir",
    "retornos.protocolos",
    "config.respostas",
  ],
  // Acesso de emergência ligado: com o sigilo "só quem atendeu", o profissional ainda abre
  // qualquer prontuário numa urgência (com justificativa registrada e aviso à gestão)
  profissional: [
    "conversas.ver",
    "agenda.ver",
    "agenda.editar",
    "pacientes.ver",
    "jornada.ver",
    "tarefas.ver",
    "prontuario.consultorio",
    "prontuario.resumo",
    "prontuario.triagem",
    "prontuario.documentos",
    "prontuario.ver",
    "prontuario.atender",
    "prontuario.acesso_emergencia",
  ],
};

export const ROLE_DESCRIPTION: Record<ClinicRole, string> = {
  gestor: "Tudo, inclusive equipe, permissões e canais.",
  recepcao: "Atendimento do dia a dia: conversas, agenda, contatos e tarefas.",
  profissional: "Vê conversas e fichas; mexe na própria rotina da agenda.",
};

/* ------------------------- Modelos de novos cargos ------------------------- */

/**
 * Modelos para criar cargos com funções específicas. `base` é o nível de
 * referência do cargo (usado em relatórios e alertas, ex.: “gestão sem 2 etapas”);
 * o que a pessoa pode fazer vem SEMPRE da lista de permissões.
 */
export const ROLE_PRESETS: { id: string; name: string; description: string; base: ClinicRole; permissions: readonly ClinicPermission[] }[] = [
  {
    id: "coordenacao",
    name: "Coordenação clínica",
    description: "Cuida da operação e dos profissionais, sem mexer em acessos, canais ou plano.",
    base: "gestor",
    permissions: ALL.filter((p) => !["config.equipe", "config.permissoes", "config.canais", "config.plano", ...CLINICAL].includes(p)),
  },
  {
    id: "atendimento",
    name: "Atendimento / call center",
    description: "Responde mensagens, marca consultas e cuida da lista de espera.",
    base: "recepcao",
    permissions: [
      "conversas.ver",
      "conversas.responder",
      "conversas.iniciar",
      "agenda.ver",
      "agenda.editar",
      "agenda.confirmacoes",
      "espera.gerir",
      "pacientes.ver",
      "pacientes.editar",
      "jornada.ver",
      "jornada.editar",
      "tarefas.ver",
      "tarefas.gerir",
    ],
  },
  {
    id: "comercial",
    name: "Comercial / marketing",
    description: "Leads, jornada, campanhas de retorno e textos automáticos.",
    base: "recepcao",
    permissions: [
      "conversas.ver",
      "conversas.responder",
      "conversas.iniciar",
      "conversas.massa",
      "agenda.ver",
      "pacientes.ver",
      "pacientes.editar",
      "contatos.massa",
      "contatos.exportar",
      "jornada.ver",
      "jornada.editar",
      "jornada.responsavel",
      "tarefas.ver",
      "tarefas.gerir",
      "retornos.gerir",
      "retornos.protocolos",
      "config.respostas",
      "config.mensagens",
      "config.automacoes",
    ],
  },
  {
    id: "financeiro",
    name: "Financeiro / faturamento",
    description: "Consulta agenda e cadastros, exporta dados e vê o plano.",
    base: "recepcao",
    permissions: ["agenda.ver", "pacientes.ver", "contatos.exportar", "jornada.ver", "tarefas.ver", "tarefas.gerir", "config.plano"],
  },
  {
    id: "enfermagem",
    name: "Enfermagem / técnico",
    description: "Consultório, triagem e sinais vitais, resumo de segurança e documentos. Com o COREN no cadastro, também lê e registra no prontuário.",
    base: "profissional",
    permissions: ["conversas.ver", "agenda.ver", "agenda.editar", "pacientes.ver", "tarefas.ver", "prontuario.consultorio", "prontuario.resumo", "prontuario.triagem", "prontuario.documentos"],
  },
  {
    id: "assistente",
    name: "Assistente / estagiário",
    description: "Ajuda no atendimento, sem cancelar nem mudar cadastros.",
    base: "recepcao",
    permissions: ["conversas.ver", "conversas.responder", "agenda.ver", "pacientes.ver", "jornada.ver", "tarefas.ver"],
  },
  {
    id: "auditoria",
    name: "Auditoria / somente leitura",
    description: "Vê tudo, não altera nada. Útil para consultoria e auditoria LGPD.",
    base: "recepcao",
    permissions: [...ALL.filter((p) => p.endsWith(".ver") && !CLINICAL.includes(p)), "config.seguranca"],
  },
];

/* --------------------------- Cálculo final --------------------------------- */

/**
 * Permissões efetivas: perfil + liberadas − bloqueadas.
 * Valores desconhecidos (ex.: permissão removida numa versão nova) são ignorados.
 */
export function effectivePermissions(input: {
  rolePermissions: readonly string[] | null | undefined;
  baseRole: ClinicRole;
  grants?: readonly string[] | null;
  revokes?: readonly string[] | null;
  /** Tem registro em conselho (perfil de profissional de saúde) */
  healthProfessional?: boolean;
}): ClinicPermission[] {
  const set = new Set<string>(baselinePermissions(input));
  for (const g of input.grants ?? []) set.add(g);
  for (const r of input.revokes ?? []) set.delete(r);
  if (!input.healthProfessional) for (const p of HEALTH_PROFESSIONAL_ONLY) set.delete(p);
  return CLINIC_PERMISSIONS.filter((p) => set.has(p));
}

/** O que a pessoa tem antes dos ajustes individuais: perfil (cargo) + o que vem por ser profissional de saúde */
export function baselinePermissions(input: { rolePermissions: readonly string[] | null | undefined; baseRole: ClinicRole; healthProfessional?: boolean }): string[] {
  const set = new Set<string>(input.rolePermissions ?? DEFAULT_ROLE_PERMISSIONS[input.baseRole]);
  if (input.healthProfessional) for (const p of HEALTH_PROFESSIONAL_GRANTS) set.add(p);
  return [...set];
}

/** Conselhos profissionais da saúde (sigla -> profissão), para o perfil de profissional de saúde */
export const HEALTH_COUNCILS: Record<string, string> = {
  CRM: "Medicina",
  CRO: "Odontologia",
  COREN: "Enfermagem",
  CRP: "Psicologia",
  CRN: "Nutrição",
  CREFITO: "Fisioterapia e terapia ocupacional",
  CRF: "Farmácia",
  CRFA: "Fonoaudiologia",
  CRBM: "Biomedicina",
  CREF: "Educação física",
};

/** Normaliza uma lista vinda de formulário/banco: só chaves válidas, sem repetição, na ordem do catálogo. */
export function normalizePermissions(values: readonly string[]): ClinicPermission[] {
  const set = new Set(values);
  return CLINIC_PERMISSIONS.filter((p) => set.has(p));
}

/** Permissões que a administração precisa manter em pelo menos uma pessoa ativa. */
export const ADMIN_PERMISSIONS: readonly ClinicPermission[] = ["config.equipe", "config.permissoes"];
