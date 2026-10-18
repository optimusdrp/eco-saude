/**
 * PERMISSÕES DA CLÍNICA
 *
 * Cada ação do CRM exige UMA permissão. As permissões de uma pessoa vêm de:
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

export const PERMISSION_CATEGORIES = ["conversas", "agenda", "contatos", "tarefas", "retornos", "configuracoes"] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const PERMISSION_CATEGORY_LABEL: Record<PermissionCategory, string> = {
  conversas: "Conversas",
  agenda: "Agenda e lista de espera",
  contatos: "Contatos e jornada",
  tarefas: "Tarefas e qualidade",
  retornos: "Retornos",
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
] as const satisfies readonly { key: string; category: PermissionCategory; label: string; hint: string; sensitive?: boolean }[];

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
export const DEFAULT_ROLE_PERMISSIONS: Record<ClinicRole, readonly ClinicPermission[]> = {
  gestor: ALL,
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
  profissional: ["conversas.ver", "agenda.ver", "agenda.editar", "pacientes.ver", "jornada.ver", "tarefas.ver"],
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
    permissions: ALL.filter((p) => !["config.equipe", "config.permissoes", "config.canais", "config.plano"].includes(p)),
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
    description: "Acompanha a agenda do dia e as fichas; marca comparecimento.",
    base: "profissional",
    permissions: ["conversas.ver", "agenda.ver", "agenda.editar", "pacientes.ver", "tarefas.ver"],
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
    permissions: [...ALL.filter((p) => p.endsWith(".ver")), "config.seguranca"],
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
}): ClinicPermission[] {
  const set = new Set<string>(input.rolePermissions ?? DEFAULT_ROLE_PERMISSIONS[input.baseRole]);
  for (const g of input.grants ?? []) set.add(g);
  for (const r of input.revokes ?? []) set.delete(r);
  return CLINIC_PERMISSIONS.filter((p) => set.has(p));
}

/** Normaliza uma lista vinda de formulário/banco: só chaves válidas, sem repetição, na ordem do catálogo. */
export function normalizePermissions(values: readonly string[]): ClinicPermission[] {
  const set = new Set(values);
  return CLINIC_PERMISSIONS.filter((p) => set.has(p));
}

/** Permissões que a administração precisa manter em pelo menos uma pessoa ativa. */
export const ADMIN_PERMISSIONS: readonly ClinicPermission[] = ["config.equipe", "config.permissoes"];
