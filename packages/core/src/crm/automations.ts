/**
 * AUTOMAÇÕES DO CRM (catálogo e regras puras)
 *
 * Dois tipos:
 *
 * 1. AUTOMAÇÕES DO SISTEMA: comportamentos prontos (confirmação, lembrete,
 *    pesquisa, lista de espera...). Cada uma pode ser ligada/desligada e tem
 *    parâmetros (horas antes, limite da nota...). Guardadas em
 *    crm_settings.automations como { chave: { enabled, ...parâmetros } }.
 *    Duas nunca desligam: sinais de urgência (segurança do paciente) e
 *    SAIR/VOLTAR (LGPD).
 *
 * 2. REGRAS DA CLÍNICA: "QUANDO acontecer X, SE for assim, ENTÃO faça Y,
 *    depois de N minutos". Ficam em automation_rules e são executadas pela
 *    fila automation_runs (na hora, ou pela rotina agendada a cada 10 min).
 */
import { APPOINTMENT_STATUSES, CHANNELS, CRM_FEATURES, JOURNEY_STAGES, type CrmFeature } from "./constants";

/* ========================= 1. Automações do sistema ========================= */

export type ParamDef =
  | { key: string; label: string; type: "number"; min: number; max: number; unit?: string; hint?: string }
  | { key: string; label: string; type: "boolean"; hint?: string }
  | { key: string; label: string; type: "text"; placeholder?: string; hint?: string; maxLength: number }
  | { key: string; label: string; type: "time"; hint?: string }
  | { key: string; label: string; type: "weekdays"; hint?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; hint?: string };

export const BUILTIN_GROUPS = ["ia", "consultas", "espera", "pesquisa", "relacionamento", "seguranca"] as const;
export type BuiltinGroup = (typeof BUILTIN_GROUPS)[number];
export const BUILTIN_GROUP_LABEL: Record<BuiltinGroup, string> = {
  ia: "Inteligência artificial",
  consultas: "Consultas",
  espera: "Lista de espera",
  pesquisa: "Pesquisa de satisfação",
  relacionamento: "Relacionamento",
  seguranca: "Segurança e LGPD",
};

export interface BuiltinAutomation {
  key: string;
  group: BuiltinGroup;
  title: string;
  what: string;
  /** Funcionalidade do plano necessária */
  feature: CrmFeature | null;
  /** Nunca desliga */
  locked?: boolean;
  defaults: Record<string, unknown> & { enabled: boolean };
  params: ParamDef[];
  /** Mensagens automáticas que esta automação envia (editáveis em Mensagens automáticas) */
  templates: string[];
  /** Onde ver o resultado */
  href: string;
  where: string;
  /** Eventos da trilha que contam como "agiu" (últimos 7 dias) */
  events: string[];
}

export const BUILTIN_AUTOMATIONS: BuiltinAutomation[] = [
  {
    key: "ia_rascunho",
    group: "ia",
    title: "Rascunho de resposta com IA (Gemini)",
    what: "Na conversa, o botão “Sugerir resposta” lê o histórico, a próxima consulta, os horários livres e as respostas rápidas, e escreve um rascunho. O atendente revisa e envia: nada sai sozinho. Vai para a IA só o primeiro nome; CPF, cartão, e-mail e telefone são ocultados. Desligada (ou se a IA falhar), a sugestão sai das regras do CRM, sem enviar dados para fora.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, tom: "acolhedor" },
    params: [
      {
        key: "tom",
        label: "Tom das respostas",
        type: "select",
        options: [
          { value: "acolhedor", label: "Acolhedor (próximo, caloroso)" },
          { value: "objetivo", label: "Objetivo (curto e direto)" },
          { value: "formal", label: "Formal (senhor, senhora)" },
        ],
      },
    ],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: [],
  },
  {
    key: "ia_intencao",
    group: "ia",
    title: "Entender a intenção com IA (Gemini)",
    what: "As palavras-chave marcam a intenção na hora (agendar, remarcar, preço...). Em seguida a IA lê a conversa e corrige quando entende melhor: “dá pra passar pra semana que vem?” vira Remarcar. Vão para a IA só as últimas mensagens, com CPF, cartão, e-mail e telefone ocultados. Se a IA falhar, demorar ou tiver pouca certeza, fica a marcação das palavras-chave.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, confiancaMinima: 70 },
    params: [
      {
        key: "confiancaMinima",
        label: "Certeza mínima para a IA substituir as palavras-chave",
        type: "number",
        min: 50,
        max: 95,
        unit: "%",
        hint: "Abaixo disso, fica a marcação das palavras-chave.",
      },
    ],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: [],
  },
  {
    key: "ia_resumo",
    group: "ia",
    title: "Resumo da conversa com IA (Gemini)",
    what: "Na conversa, o botão “Resumir” mostra em uma linha o que o paciente quer, o que já foi combinado e o que está pendente (ex.: “quer clareamento, pediu valor, prefere sábado de manhã, ainda sem resposta”). Ideal para quem assume no meio. Vão para a IA só as últimas mensagens e o primeiro nome, com CPF, cartão, e-mail e telefone ocultados. O resumo fica guardado para a próxima pessoa. Desligada (ou se a IA falhar), o resumo sai das regras do CRM, sem enviar dados para fora.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, mensagens: 40 },
    params: [
      {
        key: "mensagens",
        label: "Quantas mensagens a IA lê (as mais recentes)",
        type: "number",
        min: 10,
        max: 80,
        unit: "mensagens",
        hint: "Mais mensagens = resumo mais completo, porém mais lento e caro.",
      },
    ],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: [],
  },
  {
    key: "ia_agendar",
    group: "ia",
    title: "Agendar pelo pedido com IA (Gemini)",
    what: "Na conversa, o botão “Agendar pelo pedido” lê o que o paciente pediu (“quinta à tarde com a Dra. Beatriz”) e abre o agendamento já preenchido: profissional, procedimento e só os horários livres que batem com o pedido. A IA só entende o pedido: os horários vêm da agenda real e quem confirma é a recepção. Vão para a IA só as últimas mensagens (sem nome, com CPF, cartão, e-mail e telefone ocultados), os nomes dos profissionais e dos serviços. Desligada (ou se a IA falhar), o pedido é lido pelas regras do CRM, sem enviar dados para fora.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, diasAFrente: 21 },
    params: [{ key: "diasAFrente", label: "Até quantos dias à frente procurar", type: "number", min: 7, max: 60, unit: "dias", hint: "Datas pedidas além desse prazo não são consideradas." }],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: [],
  },
  {
    key: "ia_proximo_passo",
    group: "ia",
    title: "Próximo passo de cada cartão da Jornada (Gemini)",
    what: "Cada cartão mostra o que fazer agora (“Lead há 3 dias sem resposta: mande esta mensagem”) com um rascunho pronto. O próximo passo é decidido pelas regras do CRM; a IA só redige a mensagem a partir das últimas mensagens (sem nome e com dados pessoais ocultados). A equipe revisa e envia; se a IA falhar, o rascunho sai pronto das regras.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, diasSemResposta: 2 },
    params: [{ key: "diasSemResposta", label: "Lembrar de cobrar resposta depois de", type: "number", min: 1, max: 14, unit: "dias" }],
    templates: [],
    href: "/crm/jornada",
    where: "Jornada",
    events: [],
  },
  {
    key: "ia_motivo_perda",
    group: "ia",
    title: "Motivo da perda organizado (Gemini)",
    what: "Quando um contato vai para Perdido, a IA lê a conversa e coloca o motivo numa categoria (preço, convênio, distância, horário, outra clínica, parou de responder, desistiu, insatisfação), com o trecho que mostra o motivo. Na Jornada, a gestão vê os motivos agrupados dos últimos 90 dias. Se a IA falhar, as palavras-chave classificam.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false },
    params: [],
    templates: [],
    href: "/crm/jornada",
    where: "Jornada",
    events: [],
  },
  {
    key: "ia_cadastro",
    group: "ia",
    title: "Preencher o cadastro a partir da conversa (Gemini)",
    what: "Aniversário, e-mail, convênio e indicação mencionados no chat viram SUGESTÃO no painel do paciente, com o trecho da conversa. A ficha só muda quando a equipe clica em “Aplicar”. O e-mail é lido só pelas regras (ele nunca vai para a IA). Só mensagens com pista (“nasci”, “convênio”, “@”, “indicação”) são analisadas.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false },
    params: [],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: [],
  },
  {
    key: "ia_duplicados",
    group: "ia",
    title: "Duplicados com IA (Gemini)",
    what: "Na tela de duplicados, cada par ganha uma opinião: mesma pessoa (“Bia” é apelido de “Beatriz”), família (mesmo celular, nomes diferentes: a mãe que marca para o filho) ou pessoas diferentes. Para a IA vão só os nomes e se e-mail, celular e nascimento batem (sim/não), nunca os dados em si. Quem unifica é a equipe. Sem IA, um dicionário de apelidos e as regras dão a opinião.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false },
    params: [],
    templates: [],
    href: "/crm/contatos/duplicados",
    where: "Duplicados",
    events: [],
  },
  {
    key: "ia_etiquetas",
    group: "ia",
    title: "Etiquetas sugeridas pelo comportamento (Gemini)",
    what: "Sugere etiquetas como “sensível a preço”, “prefere áudio”, “indica amigos”, “prefere manhã” e “ansioso com procedimento”, com a evidência. Contagens objetivas (áudios, perguntas de preço, indicações, horários) saem das regras; a IA só lê o tom, sempre com o trecho, e só usa etiquetas de um catálogo fechado (nada sobre saúde, religião ou situação financeira). A equipe aceita ou recusa.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false },
    params: [],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: [],
  },
  {
    key: "ia_retorno",
    group: "ia",
    title: "Mensagem de retorno personalizada (Gemini)",
    what: "Em vez do mesmo texto para todos, a IA adapta o lembrete de retorno pelo último procedimento e pelo histórico, dentro dos limites abaixo. Nunca cita preço, desconto, promessa, link ou número que não estejam no texto da clínica, nem orientação de saúde. Se a versão da IA não passar em todas as conferências, vai o texto da clínica (que já fica na fila).",
    feature: CRM_FEATURES.campaigns,
    defaults: { enabled: false, maxCaracteres: 320, tom: "acolhedor", citarProcedimento: true },
    params: [
      { key: "maxCaracteres", label: "Tamanho máximo", type: "number", min: 120, max: 600, unit: "caracteres" },
      {
        key: "tom",
        label: "Tom",
        type: "select",
        options: [
          { value: "acolhedor", label: "Acolhedor" },
          { value: "objetivo", label: "Objetivo" },
          { value: "formal", label: "Formal" },
        ],
      },
      { key: "citarProcedimento", label: "Pode citar o último procedimento", type: "boolean", hint: "Ex.: “Já faz 6 meses da sua limpeza”." },
    ],
    templates: [],
    href: "/crm/retornos",
    where: "Retornos",
    events: [],
  },
  {
    key: "ia_melhor_horario",
    group: "ia",
    title: "Melhor horário para enviar a cada paciente",
    what: "Descobre quando cada paciente costuma responder (pelas horas em que ele escreve para a clínica) e mostra no painel (“costuma responder à noite, 19h às 21h”). Os lembretes de retorno passam a sair nesse horário, dentro da janela abaixo. Estatística sobre os dados da clínica, sem IA externa; com poucas mensagens, usa o padrão da clínica.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, inicio: 8, fim: 20, sabado: false, usarNosRetornos: true },
    params: [
      { key: "inicio", label: "Enviar a partir das", type: "number", min: 6, max: 12, unit: "h" },
      { key: "fim", label: "Enviar até as", type: "number", min: 14, max: 22, unit: "h" },
      { key: "sabado", label: "Também aos sábados", type: "boolean" },
      { key: "usarNosRetornos", label: "Agendar os lembretes de retorno para o melhor horário", type: "boolean" },
    ],
    templates: [],
    href: "/crm/retornos",
    where: "Retornos",
    events: [],
  },
  {
    key: "ia_regra_texto",
    group: "ia",
    title: "Criar regra de automação escrevendo em português (Gemini)",
    what: "Em Automações > Regras da clínica, escreva o que quer (“quando alguém pedir orçamento e não marcar em 2 dias, crie tarefa para a Paula”) e a regra aparece MONTADA no construtor, com o que foi entendido e os avisos, para você revisar. Nada é salvo nem ligado sem clicar em “Criar regra”. Para a IA vão só a frase, os nomes da equipe e as etiquetas: nenhum dado de paciente. Se a IA falhar, as regras do CRM entendem os pedidos mais comuns.",
    feature: null,
    defaults: { enabled: false },
    params: [],
    templates: [],
    href: "/configuracoes/automacoes?aba=regras",
    where: "Automações",
    events: [],
  },
  {
    key: "ia_respostas_sugeridas",
    group: "ia",
    title: "Respostas rápidas sugeridas (Gemini)",
    what: "Uma vez por semana o CRM procura os textos que a equipe digita repetidamente (mesmo texto, em várias conversas) e propõe virar atalho, já com o nome do paciente trocado por {{primeiro_nome}}. Quem acha a repetição é a contagem do sistema; a IA só junta as variações num texto limpo e sugere atalho e título, sem inventar informação. A sugestão aparece em Respostas rápidas, com “Criar atalho” e “Descartar”. Textos com dado pessoal ou orientação de saúde nunca viram sugestão. Se a IA falhar, vai a variação mais usada.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, minRepeticoes: 5, minConversas: 3 },
    params: [
      { key: "minRepeticoes", label: "Sugerir a partir de", type: "number", min: 3, max: 30, unit: "repetições" },
      { key: "minConversas", label: "Em pelo menos", type: "number", min: 2, max: 20, unit: "conversas diferentes" },
    ],
    templates: [],
    href: "/configuracoes/respostas",
    where: "Respostas rápidas",
    events: [],
  },
  {
    key: "ia_auditoria",
    group: "ia",
    title: "Auditoria de atendimento por amostragem (Gemini)",
    what: "Toda semana, algumas conversas sorteadas (divididas entre as pessoas da equipe) recebem nota de qualidade: tempo de resposta (medido pelo sistema, só dentro do horário de atendimento), cordialidade, clareza e se ofereceu horário a quem quis marcar, com um ponto forte e uma dica. Serve para treinar a equipe. Sem expor o paciente: a IA não recebe nome nem telefone e o relatório não mostra quem é o paciente. Se a IA falhar, a nota sai pelos sinais objetivos (cumprimento, nome, agradecimento). Conte à equipe que a amostragem existe: transparência faz parte da LGPD.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, amostraSemanal: 10, mostrarParaAtendente: true },
    params: [
      { key: "amostraSemanal", label: "Conversas avaliadas por semana", type: "number", min: 3, max: 50 },
      { key: "mostrarParaAtendente", label: "Cada pessoa vê as próprias avaliações", type: "boolean", hint: "A gestão (permissão “Qualidade do atendimento”) vê todas." },
    ],
    templates: [],
    href: "/crm/qualidade",
    where: "Qualidade do atendimento",
    events: [],
  },
  {
    key: "ia_risco",
    group: "ia",
    title: "Risco de falta aprendido com os dados da clínica",
    what: "Troca a fórmula fixa por um modelo treinado com o histórico da própria clínica: dia, horário, antecedência, chuva prevista, histórico do paciente e confirmação. A explicação continua em português (“Faltou 2 das últimas 3”). Roda no servidor: nenhum dado de paciente sai do sistema. Treina sozinho todo dia e só substitui a fórmula se acertar MAIS que ela num teste com as consultas mais recentes; senão, continua a fórmula (plano B).",
    feature: CRM_FEATURES.noShowRisk,
    defaults: { enabled: false, usarChuva: true },
    params: [
      {
        key: "usarChuva",
        label: "Usar a previsão de chuva da cidade da clínica",
        type: "boolean",
        hint: "Previsão pública (Open-Meteo), sem dado de paciente. Sem previsão, o modelo segue sem esse fator.",
      },
    ],
    templates: [],
    href: "/crm/agenda",
    where: "Agenda",
    events: [],
  },
  {
    key: "ia_encaixe",
    group: "ia",
    title: "Encaixe inteligente",
    what: "Quando abre uma vaga, a lista de espera aparece ordenada por quem tem MAIS CHANCE DE ACEITAR (não só por ordem de chegada), com a chance e os motivos: “Aceitou 1 oferta antes”, “Conversou nas últimas 24h”, “Pediu exatamente este período”. A escolha continua com a recepção. Começa com pesos fixos e passa a aprender com as ofertas da clínica quando houver respostas suficientes.",
    feature: CRM_FEATURES.waitlist,
    defaults: { enabled: false },
    params: [],
    templates: [],
    href: "/crm/espera",
    where: "Lista de espera",
    events: [],
  },
  {
    key: "ia_duracao",
    group: "ia",
    title: "Duração real das consultas",
    what: "Compara o horário marcado com a chegada (“Chegou”) e a saída (“Finalizar atendimento”) e sugere a duração ideal por profissional e procedimento. A sugestão aparece ao agendar e em Ajustes > Duração das consultas, onde a equipe aplica com um clique. Estatística sobre os dados da clínica, sem IA externa.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, percentil: "75" },
    params: [
      {
        key: "percentil",
        label: "Sugerir a duração que cabe em",
        type: "select",
        options: [
          { value: "50", label: "Metade das consultas (mediana)" },
          { value: "75", label: "3 de cada 4 consultas (recomendado)" },
          { value: "90", label: "9 de cada 10 consultas (agenda folgada)" },
        ],
      },
    ],
    templates: [],
    href: "/configuracoes/duracoes",
    where: "Duração das consultas",
    events: [],
  },
  {
    key: "ia_resumo_dia",
    group: "ia",
    title: "Resumo da manhã no painel Hoje (Gemini)",
    what: "No topo do Hoje, um resumo em linguagem natural: “Hoje 18 consultas, 3 com alto risco de falta, 2 encaixes possíveis na tarde da Dra. Helena, 4 conversas esperando há mais de 1 hora”. Os números são calculados pelo sistema; a IA só redige, e a frase é conferida contra os números. Para a IA vão só contagens e nomes de profissionais. Desligada ou se a IA falhar, o resumo sai montado pelas regras.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false },
    params: [],
    templates: [],
    href: "/hoje",
    where: "Hoje",
    events: [],
  },
  {
    key: "ia_promessas",
    group: "ia",
    title: "Lembrar o que ficou prometido com IA (Gemini)",
    what: "Quando alguém da equipe escreve uma promessa na conversa (“vou te mandar o orçamento amanhã”, “vejo com a doutora e te aviso até sexta”), o CRM cria sozinho uma tarefa para essa pessoa, com o prazo dito. No painel da conversa aparece “Prometido nesta conversa”, com “Feito” e “Não era promessa”. Só mensagens com jeito de compromisso são analisadas. Vão para a IA só essa mensagem e as anteriores, sem nome e com CPF, cartão, e-mail e telefone ocultados. Se a IA falhar, as regras do CRM leem a promessa. Nada é enviado ao paciente.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, prazoPadrao: 1, lembrarPaciente: false, confiancaMinima: 70 },
    params: [
      { key: "prazoPadrao", label: "Prazo quando ninguém disse quando", type: "number", min: 0, max: 7, unit: "dias", hint: "0 = no mesmo dia." },
      { key: "lembrarPaciente", label: "Lembrar também o que o PACIENTE ficou de fazer", type: "boolean", hint: "Ex.: “amanhã te mando os exames” vira tarefa para cobrar se não chegar." },
      { key: "confiancaMinima", label: "Certeza mínima para a IA substituir as regras", type: "number", min: 50, max: 95, unit: "%" },
    ],
    templates: [],
    href: "/crm/tarefas",
    where: "Tarefas",
    events: [],
  },
  {
    key: "ia_sentimento",
    group: "ia",
    title: "Sentimento do paciente com IA (Gemini)",
    what: "Percebe quem está irritado, impaciente, sendo irônico, insatisfeito ou ameaçando (Procon, processo, avaliação negativa pública). Essas conversas sobem na fila e a gestão recebe uma tarefa para agir antes de virar reclamação. As palavras-chave e os sinais (mensagens repetidas sem resposta, MAIÚSCULAS) marcam na hora; a IA confirma ou corrige logo depois, entendendo ironia e contexto (“processo de clareamento” não é ameaça). Vão para a IA só as últimas mensagens, sem nome e com CPF, cartão, e-mail e telefone ocultados. Se a IA falhar, valem as palavras-chave. Desligada, a fila não muda.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, nivelAlerta: "irritado", subirFila: true, avisarGestao: true, confiancaMinima: 70 },
    params: [
      {
        key: "nivelAlerta",
        label: "Subir na fila e avisar a partir de",
        type: "select",
        options: [
          { value: "impaciente", label: "Impaciente ou irônico (e os mais graves)" },
          { value: "irritado", label: "Irritado ou insatisfeito (e ameaça)" },
          { value: "ameaca", label: "Só ameaça (Procon, processo, avaliação pública)" },
        ],
      },
      { key: "subirFila", label: "Subir a conversa na fila (logo abaixo das urgências)", type: "boolean" },
      { key: "avisarGestao", label: "Avisar a gestão com uma tarefa para hoje", type: "boolean", hint: "Uma tarefa por conversa; nova tarefa só se o caso piorar (ex.: de irritado para ameaça)." },
      {
        key: "confiancaMinima",
        label: "Certeza mínima para a IA substituir as palavras-chave",
        type: "number",
        min: 50,
        max: 95,
        unit: "%",
        hint: "Para rebaixar uma ameaça, a IA precisa de pelo menos 85%.",
      },
    ],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: [],
  },
  {
    key: "confirmacao_resposta",
    group: "consultas",
    title: "Resposta à confirmação",
    what: "“1” confirma a consulta na hora. “2” avisa que a equipe vai ajudar a remarcar e deixa a conversa marcada para a recepção.",
    feature: CRM_FEATURES.confirmations,
    defaults: { enabled: true, tarefaRemarcar: false },
    params: [{ key: "tarefaRemarcar", label: "Criar tarefa “Remarcar” quando responder 2", type: "boolean" }],
    templates: ["confirmacao_ok", "confirmacao_remarcar"],
    href: "/crm/agenda",
    where: "Agenda",
    events: ["confirmation_reply"],
  },
  {
    key: "lembrete_dia",
    group: "consultas",
    title: "Lembrete no dia",
    what: "Algumas horas antes da consulta, o paciente recebe um lembrete. Ninguém recebe duas vezes; quem pediu SAIR não recebe.",
    feature: CRM_FEATURES.confirmations,
    defaults: { enabled: false, horasAntes: 3, soConfirmadas: false },
    params: [
      { key: "horasAntes", label: "Quanto tempo antes", type: "number", min: 1, max: 12, unit: "horas" },
      { key: "soConfirmadas", label: "Só para consultas já confirmadas", type: "boolean" },
    ],
    templates: ["lembrete"],
    href: "/crm/agenda",
    where: "Agenda",
    events: ["reminder_sent"],
  },
  {
    key: "falta",
    group: "consultas",
    title: "Falta vira tarefa",
    what: "Marcou “Faltou”: o paciente sai de Agendado e a recepção recebe a tarefa de remarcar. Opcional: mandar uma mensagem acolhedora.",
    feature: null,
    defaults: { enabled: true, enviarMensagem: false },
    params: [{ key: "enviarMensagem", label: "Também mandar a mensagem “Faltou à consulta”", type: "boolean" }],
    templates: ["falta"],
    href: "/crm/tarefas",
    where: "Tarefas",
    events: ["no_show_followup"],
  },
  {
    key: "cancelamento_aviso",
    group: "consultas",
    title: "Avisar cancelamento",
    what: "Quando a clínica cancela uma consulta, o paciente recebe o aviso com convite para remarcar.",
    feature: null,
    defaults: { enabled: false },
    params: [],
    templates: ["cancelamento"],
    href: "/crm/agenda",
    where: "Agenda",
    events: ["cancel_notice"],
  },
  {
    key: "pos_consulta",
    group: "consultas",
    title: "Mensagem pós-consulta",
    what: "Algumas horas depois do atendimento, um agradecimento com espaço para dúvidas sobre as orientações.",
    feature: null,
    defaults: { enabled: false, horasDepois: 3 },
    params: [{ key: "horasDepois", label: "Quanto tempo depois", type: "number", min: 1, max: 48, unit: "horas" }],
    templates: ["pos_consulta"],
    href: "/crm/conversas",
    where: "Conversas",
    events: ["post_visit_sent"],
  },
  {
    key: "espera_oferta",
    group: "espera",
    title: "Vaga para a lista de espera",
    what: "Ao oferecer um horário liberado, o primeiro “SIM” fica com a vaga; quem responde depois recebe um aviso educado.",
    feature: CRM_FEATURES.waitlist,
    defaults: { enabled: true },
    params: [],
    templates: ["oferta", "oferta_aceita", "oferta_recusada", "oferta_perdida"],
    href: "/crm/espera",
    where: "Lista de espera",
    events: ["slot_filled"],
  },
  {
    key: "nps",
    group: "pesquisa",
    title: "Pesquisa de satisfação",
    what: "Depois do atendimento, o paciente recebe a pergunta de 0 a 10. Nota baixa cria uma tarefa para a gestão ligar.",
    feature: CRM_FEATURES.nps,
    defaults: { enabled: true, limiteAlerta: 6, criarTarefa: true, linkAvaliacao: "" },
    params: [
      { key: "limiteAlerta", label: "Nota de alerta (esta ou menor)", type: "number", min: 0, max: 8, hint: "Padrão do NPS: 6 ou menos." },
      { key: "criarTarefa", label: "Criar tarefa para a gestão quando a nota for baixa", type: "boolean" },
      {
        key: "linkAvaliacao",
        label: "Link para avaliar a clínica (Google)",
        type: "text",
        maxLength: 200,
        placeholder: "https://g.page/r/...",
        hint: "Quem der 9 ou 10 recebe o link no agradecimento ({{link_avaliacao}}).",
      },
    ],
    templates: ["nps", "nps_obrigado", "nps_detrator"],
    href: "/crm/tarefas",
    where: "Tarefas",
    events: ["nps"],
  },
  {
    key: "boas_vindas",
    group: "relacionamento",
    title: "Boas-vindas",
    what: "A primeira mensagem de um contato novo recebe uma resposta imediata, para ele saber que foi visto.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false },
    params: [],
    templates: ["boas_vindas"],
    href: "/crm/conversas",
    where: "Conversas",
    events: ["welcome_sent"],
  },
  {
    key: "fora_horario",
    group: "relacionamento",
    title: "Fora do horário",
    what: "Mensagem que chega fora do horário de atendimento recebe uma resposta com o horário. No máximo uma vez a cada 12 horas por conversa.",
    feature: CRM_FEATURES.inbox,
    defaults: { enabled: false, dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" },
    params: [
      { key: "dias", label: "Dias de atendimento", type: "weekdays" },
      { key: "inicio", label: "Abre às", type: "time" },
      { key: "fim", label: "Fecha às", type: "time" },
    ],
    templates: ["fora_horario"],
    href: "/crm/conversas",
    where: "Conversas",
    events: ["after_hours_reply"],
  },
  {
    key: "aniversario",
    group: "relacionamento",
    title: "Aniversário",
    what: "No dia do aniversário (com data de nascimento no cadastro), o paciente recebe uma mensagem. Só para quem não pediu SAIR.",
    feature: CRM_FEATURES.campaigns,
    defaults: { enabled: false, hora: 9 },
    params: [{ key: "hora", label: "A partir de que hora", type: "number", min: 7, max: 20, unit: "h" }],
    templates: ["aniversario"],
    href: "/crm/contatos",
    where: "Contatos",
    events: ["birthday_sent"],
  },
  {
    key: "jornada_auto",
    group: "relacionamento",
    title: "Jornada automática",
    what: "A etapa muda sozinha: respondeu, agendou, compareceu. Paciente sem consulta há muito tempo vai para “Para reativar”.",
    feature: CRM_FEATURES.funnel,
    defaults: { enabled: true, diasReativar: 180 },
    params: [{ key: "diasReativar", label: "Para reativar depois de", type: "number", min: 30, max: 730, unit: "dias sem consulta" }],
    templates: [],
    href: "/crm/jornada",
    where: "Jornada",
    events: ["stage_changed"],
  },
  {
    key: "urgencia",
    group: "seguranca",
    title: "Sinais de urgência",
    what: "Mensagens com sinais de urgência (dor no peito, falta de ar, crise) ganham alerta e orientação (SAMU 192, CVV 188). O sistema nunca responde sozinho nesses casos.",
    feature: CRM_FEATURES.inbox,
    locked: true,
    defaults: { enabled: true },
    params: [],
    templates: [],
    href: "/crm/conversas",
    where: "Conversas",
    events: ["urgency_flag"],
  },
  {
    key: "sair_voltar",
    group: "seguranca",
    title: "SAIR e VOLTAR (LGPD)",
    what: "Quem escreve SAIR deixa de receber mensagens automáticas na hora; VOLTAR libera de novo.",
    feature: null,
    locked: true,
    defaults: { enabled: true },
    params: [],
    templates: ["descadastro", "reativacao"],
    href: "/crm/contatos?segmento=sairam",
    where: "Contatos",
    events: ["opt_out", "opt_in"],
  },
];

export type BuiltinKey = (typeof BUILTIN_AUTOMATIONS)[number]["key"];

/** Funcionalidades de IA: ficam em Ajustes > Inteligência artificial (permissão config.ia), não em Automações. */
export const AI_FEATURES = BUILTIN_AUTOMATIONS.filter((a) => a.group === "ia");
export const isAiFeature = (key: string) => AI_FEATURES.some((a) => a.key === key);
export type AutomationSettings = Record<string, Record<string, unknown> & { enabled: boolean }>;

/** Configuração efetiva: o salvo pela clínica por cima dos padrões (travadas sempre ligadas). */
export function automationConfig(saved: Record<string, unknown> | null | undefined): AutomationSettings {
  const out: AutomationSettings = {};
  for (const a of BUILTIN_AUTOMATIONS) {
    const mine = (saved?.[a.key] ?? {}) as Record<string, unknown>;
    out[a.key] = { ...a.defaults, ...mine, enabled: a.locked ? true : typeof mine.enabled === "boolean" ? mine.enabled : a.defaults.enabled };
  }
  return out;
}

/** Valida e normaliza os parâmetros enviados pela tela (números dentro do limite etc.). */
export function sanitizeBuiltin(key: string, input: Record<string, unknown>): (Record<string, unknown> & { enabled: boolean }) | null {
  const def = BUILTIN_AUTOMATIONS.find((a) => a.key === key);
  if (!def) return null;
  const out: Record<string, unknown> & { enabled: boolean } = { enabled: def.locked ? true : input.enabled === true };
  for (const p of def.params) {
    const v = input[p.key];
    if (p.type === "number") {
      const n = Math.round(Number(v));
      out[p.key] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : def.defaults[p.key];
    } else if (p.type === "boolean") out[p.key] = v === true;
    else if (p.type === "text") {
      const t = String(v ?? "")
        .trim()
        .slice(0, p.maxLength);
      out[p.key] = p.key === "linkAvaliacao" && t && !/^https:\/\//.test(t) ? "" : t;
    } else if (p.type === "time") out[p.key] = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? v : def.defaults[p.key];
    else if (p.type === "weekdays") out[p.key] = Array.isArray(v) ? [...new Set(v.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : def.defaults[p.key];
    else if (p.type === "select") out[p.key] = p.options.some((o) => o.value === v) ? v : def.defaults[p.key];
  }
  return out;
}

/** "de segunda a sexta, das 08:00 às 18:00" (variável {{horario_atendimento}}). */
export function describeOpeningHours(dias: number[], inicio: string, fim: string): string {
  const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const sorted = [...dias].sort();
  const consecutive = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  const days = consecutive ? `de ${names[sorted[0]!]} a ${names[sorted[sorted.length - 1]!]}` : sorted.map((d) => names[d]).join(", ");
  return `${days}, das ${inicio} às ${fim}`;
}

/** Está dentro do horário de atendimento? (weekday 0-6, minutos do dia) */
export function isOpen(cfg: { dias: number[]; inicio: string; fim: string }, weekday: number, minutes: number): boolean {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return cfg.dias.includes(weekday) && minutes >= toMin(cfg.inicio) && minutes < toMin(cfg.fim);
}

/* ========================= 2. Regras da clínica ========================= */

/**
 * GATILHOS: cada um corresponde a um tipo de evento da trilha (crm_events),
 * menos "message_in", que vem direto da entrada de mensagens.
 */
export const RULE_TRIGGERS = [
  { key: "contact_created", label: "Um contato novo chegou", hint: "Primeira mensagem de alguém ou cadastro manual." },
  { key: "message_in", label: "O paciente mandou mensagem", hint: "Dá para filtrar por palavras." },
  { key: "stage_changed", label: "O contato mudou de etapa", hint: "Escolha para qual etapa." },
  { key: "appointment_created", label: "Uma consulta foi marcada", hint: "Por qualquer caminho: recepção, conversa ou lista de espera." },
  { key: "appointment_status", label: "O status da consulta mudou", hint: "Confirmou, compareceu, faltou ou cancelou." },
  { key: "nps", label: "Respondeu a pesquisa de satisfação", hint: "Dá para filtrar pela nota." },
  { key: "task_done", label: "Uma tarefa foi concluída", hint: "Dá para encadear o próximo passo." },
  { key: "opt_out", label: "Pediu para sair (SAIR)", hint: "Ótimo para avisar a equipe." },
  { key: "urgency_flag", label: "Mensagem com sinal de urgência", hint: "Para avisar alguém na hora." },
] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number]["key"];
export const RULE_TRIGGER_KEYS = RULE_TRIGGERS.map((t) => t.key) as unknown as readonly [RuleTrigger, ...RuleTrigger[]];

/** Filtro do gatilho (só os campos que fazem sentido para cada um). */
export interface RuleFilter {
  /** stage_changed: etapa de destino */
  stage?: (typeof JOURNEY_STAGES)[number] | "";
  /** appointment_status: status novo */
  status?: (typeof APPOINTMENT_STATUSES)[number] | "";
  /** message_in: contém alguma destas palavras (separadas por vírgula) */
  keywords?: string;
  /** contact_created/message_in: canal */
  channel?: (typeof CHANNELS)[number] | "";
  /** nps: faixa de nota */
  minScore?: number;
  maxScore?: number;
}

/** CONDIÇÕES conferidas NA HORA DE EXECUTAR (depois da espera). */
export const RULE_CONDITIONS = [
  { key: "stage_in", label: "O contato está na etapa", needs: "stage" },
  { key: "has_tag", label: "O contato tem a etiqueta", needs: "tag" },
  { key: "not_tag", label: "O contato NÃO tem a etiqueta", needs: "tag" },
  { key: "no_future_appointment", label: "Não tem consulta marcada", needs: null },
  { key: "has_future_appointment", label: "Tem consulta marcada", needs: null },
  { key: "patient_silent", label: "O paciente não respondeu desde o gatilho", needs: null },
  { key: "team_silent", label: "A equipe não respondeu desde o gatilho", needs: null },
] as const;
export type RuleConditionKey = (typeof RULE_CONDITIONS)[number]["key"];
export interface RuleCondition {
  type: RuleConditionKey;
  value?: string;
}

/** AÇÕES, executadas em ordem. */
export const RULE_ACTIONS = [
  { key: "send_message", label: "Mandar mensagem ao paciente" },
  { key: "create_task", label: "Criar tarefa" },
  { key: "move_stage", label: "Mover para a etapa" },
  { key: "add_tag", label: "Colocar etiqueta" },
  { key: "remove_tag", label: "Tirar etiqueta" },
  { key: "set_owner", label: "Definir responsável" },
  { key: "reopen_conversation", label: "Devolver a conversa para a equipe" },
  { key: "internal_note", label: "Nota interna na conversa" },
] as const;
export type RuleActionKey = (typeof RULE_ACTIONS)[number]["key"];
export interface RuleAction {
  type: RuleActionKey;
  /** send_message / internal_note: texto com variáveis; create_task: título */
  text?: string;
  /** send_message: é um modelo aprovado pela Meta (pode sair fora da janela de 24h) */
  approved?: boolean;
  /** create_task: prazo em dias a partir da execução */
  dueInDays?: number;
  /** create_task / set_owner: "owner" (responsável do contato) ou id da pessoa */
  assignee?: string;
  /** move_stage */
  stage?: string;
  /** add_tag / remove_tag */
  tag?: string;
}

export interface RuleDefinition {
  name: string;
  trigger: RuleTrigger;
  filter: RuleFilter;
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Espera antes de executar, em minutos (0 = na hora) */
  delayMinutes: number;
  /** No máximo uma execução por contato */
  oncePerContact: boolean;
}

/** O evento passa no filtro do gatilho? (conferido ao entrar na fila) */
export function matchesFilter(filter: RuleFilter, data: Record<string, unknown>): boolean {
  if (filter.stage && data.para !== filter.stage) return false;
  if (filter.status && data.para !== filter.status) return false;
  if (filter.channel && data.canal !== filter.channel && data.origem !== filter.channel) return false;
  if (filter.keywords?.trim()) {
    const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const text = plain(String(data.texto ?? ""));
    const words = filter.keywords
      .split(",")
      .map((w) => plain(w.trim()))
      .filter(Boolean);
    if (words.length && !words.some((w) => text.includes(w))) return false;
  }
  const nota = typeof data.nota === "number" ? data.nota : null;
  if (filter.minScore !== undefined && (nota === null || nota < filter.minScore)) return false;
  if (filter.maxScore !== undefined && (nota === null || nota > filter.maxScore)) return false;
  return true;
}

/** Tempo de espera legível: "na hora", "2 horas", "3 dias". */
export function describeDelay(minutes: number): string {
  if (!minutes) return "na hora";
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "dia" : "dias"} depois`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hora" : "horas"} depois`;
  return `${minutes} min depois`;
}

/**
 * RECEITAS: regras prontas para começar (a clínica ajusta e liga).
 * Cobrem os processos que mais costumam escapar da recepção.
 */
export const RULE_RECIPES: { id: string; title: string; why: string; rule: RuleDefinition }[] = [
  {
    id: "lead_sem_agendamento",
    title: "Contato novo que não marcou em 2 dias",
    why: "Lead esquecido é paciente perdido. A recepção recebe a tarefa de ligar.",
    rule: {
      name: "Retomar contato novo sem consulta",
      trigger: "contact_created",
      filter: {},
      conditions: [{ type: "no_future_appointment" }, { type: "stage_in", value: "em_conversa" }],
      actions: [{ type: "create_task", text: "Ligar para {{primeiro_nome}}: chegou há 2 dias e ainda não marcou", dueInDays: 0, assignee: "owner" }],
      delayMinutes: 2880,
      oncePerContact: true,
    },
  },
  {
    id: "sem_resposta_equipe",
    title: "Paciente esperando resposta há 30 min",
    why: "Quem espera muito procura outra clínica. A conversa volta ao topo com uma nota.",
    rule: {
      name: "Alerta de espera na conversa",
      trigger: "message_in",
      filter: {},
      conditions: [{ type: "team_silent" }],
      actions: [{ type: "internal_note", text: "Paciente aguardando resposta há 30 minutos." }, { type: "reopen_conversation" }],
      delayMinutes: 30,
      oncePerContact: false,
    },
  },
  {
    id: "orcamento",
    title: "Pediu orçamento ou valores",
    why: "Etiqueta para acompanhar e tarefa para enviar a proposta no mesmo dia.",
    rule: {
      name: "Pedido de orçamento",
      trigger: "message_in",
      filter: { keywords: "orçamento, valor, preço, quanto custa" },
      conditions: [{ type: "not_tag", value: "orçamento" }],
      actions: [
        { type: "add_tag", tag: "orçamento" },
        { type: "create_task", text: "Enviar orçamento para {{primeiro_nome}}", dueInDays: 0, assignee: "owner" },
      ],
      delayMinutes: 0,
      oncePerContact: false,
    },
  },
  {
    id: "faltou_remarcar",
    title: "Faltou e não remarcou em 3 dias",
    why: "Segunda tentativa automática antes de a pessoa sumir.",
    rule: {
      name: "Faltou e não remarcou",
      trigger: "appointment_status",
      filter: { status: "faltou" },
      conditions: [{ type: "no_future_appointment" }],
      actions: [{ type: "send_message", text: "Oi, {{primeiro_nome}}! Ainda dá tempo de remarcar sua consulta. Quer que a gente encontre um horário?", approved: true }],
      delayMinutes: 4320,
      oncePerContact: false,
    },
  },
  {
    id: "promotor_avaliacao",
    title: "Nota 9 ou 10: etiqueta de promotor",
    why: "Quem ama a clínica é quem mais indica. Identifique para campanhas de indicação.",
    rule: {
      name: "Marcar promotores",
      trigger: "nps",
      filter: { minScore: 9, maxScore: 10 },
      conditions: [],
      actions: [{ type: "add_tag", tag: "promotor" }],
      delayMinutes: 0,
      oncePerContact: false,
    },
  },
  {
    id: "perdido_reativar",
    title: "Marcado como perdido: nova tentativa em 60 dias",
    why: "Às vezes o “agora não” vira “agora sim”.",
    rule: {
      name: "Reabordar perdidos",
      trigger: "stage_changed",
      filter: { stage: "perdido" },
      conditions: [{ type: "stage_in", value: "perdido" }],
      actions: [{ type: "create_task", text: "Tentar de novo com {{primeiro_nome}} (perdido há 60 dias)", dueInDays: 0, assignee: "owner" }],
      delayMinutes: 86400,
      oncePerContact: true,
    },
  },
  {
    id: "primeira_consulta",
    title: "Primeira consulta marcada",
    why: "Etiqueta para dar atenção especial a quem vem pela primeira vez.",
    rule: {
      name: "Primeira consulta",
      trigger: "appointment_created",
      filter: {},
      conditions: [
        { type: "stage_in", value: "agendado" },
        { type: "not_tag", value: "paciente-antigo" },
      ],
      actions: [{ type: "add_tag", tag: "primeira-consulta" }],
      delayMinutes: 0,
      oncePerContact: true,
    },
  },
  {
    id: "urgencia_avisar",
    title: "Urgência: avisar a gestão",
    why: "Além do alerta na conversa, alguém responsável recebe uma tarefa imediata.",
    rule: {
      name: "Urgência para a gestão",
      trigger: "urgency_flag",
      filter: {},
      conditions: [],
      actions: [{ type: "create_task", text: "URGENTE: ver a conversa de {{primeiro_nome}} agora", dueInDays: 0, assignee: "owner" }],
      delayMinutes: 0,
      oncePerContact: false,
    },
  },
];
