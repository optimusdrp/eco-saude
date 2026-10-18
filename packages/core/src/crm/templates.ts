/**
 * MENSAGENS AUTOMÁTICAS (catálogo)
 *
 * Todo texto que o CRM manda SOZINHO para o paciente está aqui, com o texto
 * padrão. A clínica pode reescrever cada um (Ajustes > Mensagens automáticas);
 * o texto da clínica fica na tabela message_templates e vale no lugar do padrão.
 *
 *  - `optional`: pode ser desligada (ex.: "obrigado pela nota"). As de LGPD
 *    (SAIR/VOLTAR) nunca desligam: o paciente precisa da confirmação.
 *  - `outsideWindow`: costuma sair mais de 24h depois da última mensagem do
 *    paciente. No WhatsApp oficial precisa ser um MODELO APROVADO pela Meta
 *    com o mesmo texto (a tela avisa).
 *  - `variables`: as variáveis que fazem sentido nesta mensagem.
 */
import { TEMPLATE_VARIABLES } from "./messages";

export const TEMPLATE_GROUPS = ["agenda", "espera", "pesquisa", "relacionamento", "lgpd"] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];

export const TEMPLATE_GROUP_LABEL: Record<TemplateGroup, string> = {
  agenda: "Consultas",
  espera: "Lista de espera",
  pesquisa: "Pesquisa de satisfação",
  relacionamento: "Relacionamento",
  lgpd: "LGPD (SAIR e VOLTAR)",
};

type Var = (typeof TEMPLATE_VARIABLES)[number];
const BASE: Var[] = ["nome", "primeiro_nome", "clinica"];
const APPT: Var[] = [...BASE, "data", "hora", "profissional"];

export const MESSAGE_TEMPLATES = [
  // Consultas
  { key: "agendamento", group: "agenda", label: "Consulta marcada", when: "Ao marcar uma consulta com a opção “avisar o paciente”.", optional: false, outsideWindow: true, variables: APPT,
    body: "Olá, {{primeiro_nome}}! Sua consulta está marcada para {{data}} às {{hora}} com {{profissional}}. Se precisar remarcar, é só responder aqui." },
  { key: "confirmacao", group: "agenda", label: "Pedido de confirmação", when: "Confirmação automática (véspera) ou botão “Pedir confirmação”.", optional: false, outsideWindow: true, variables: APPT,
    body: "Olá, {{primeiro_nome}}! Confirmando sua consulta {{data}} às {{hora}} com {{profissional}}. Responda 1 para confirmar ou 2 para remarcar." },
  { key: "confirmacao_ok", group: "agenda", label: "Resposta: confirmou", when: "O paciente respondeu 1 (ou “sim”) ao pedido de confirmação.", optional: true, outsideWindow: false, variables: APPT,
    body: "Confirmado, {{primeiro_nome}}! Te esperamos {{data}} às {{hora}}." },
  { key: "confirmacao_remarcar", group: "agenda", label: "Resposta: quer remarcar", when: "O paciente respondeu 2 (ou “não”). A conversa também fica marcada para a recepção.", optional: true, outsideWindow: false, variables: APPT,
    body: "Tudo bem, {{primeiro_nome}}! Alguém da equipe já vai te ajudar a remarcar." },
  { key: "lembrete", group: "agenda", label: "Lembrete no dia", when: "Algumas horas antes da consulta (automação “Lembrete no dia”).", optional: false, outsideWindow: true, variables: APPT,
    body: "Oi, {{primeiro_nome}}! Lembrete: sua consulta é hoje às {{hora}} com {{profissional}}. Até já!" },
  { key: "remarcacao", group: "agenda", label: "Consulta remarcada", when: "Ao remarcar com a opção “avisar o paciente”.", optional: false, outsideWindow: true, variables: APPT,
    body: "Olá, {{primeiro_nome}}! Sua consulta foi remarcada para {{data}} às {{hora}} com {{profissional}}. Se não puder, é só responder aqui." },
  { key: "cancelamento", group: "agenda", label: "Consulta cancelada", when: "A clínica cancelou a consulta (automação “Avisar cancelamento”).", optional: false, outsideWindow: true, variables: APPT,
    body: "Olá, {{primeiro_nome}}. Sua consulta de {{data}} às {{hora}} com {{profissional}} foi cancelada. Quer marcar outro horário? É só responder aqui." },
  { key: "falta", group: "agenda", label: "Faltou à consulta", when: "Depois de marcar “Faltou” (automação “Mensagem após falta”).", optional: false, outsideWindow: true, variables: APPT,
    body: "Oi, {{primeiro_nome}}, sentimos sua falta hoje. Está tudo bem? Se quiser remarcar, responda aqui que encontramos outro horário." },
  { key: "pos_consulta", group: "agenda", label: "Depois da consulta", when: "Algumas horas depois de marcar “Compareceu” (automação “Mensagem pós-consulta”).", optional: false, outsideWindow: true, variables: APPT,
    body: "Obrigado pela visita, {{primeiro_nome}}! Se tiver qualquer dúvida sobre as orientações de hoje, é só escrever aqui." },
  // Lista de espera
  { key: "oferta", group: "espera", label: "Horário oferecido", when: "Um horário liberado é oferecido a quem está na lista de espera.", optional: false, outsideWindow: true, variables: APPT,
    body: "Olá, {{primeiro_nome}}! Abriu um horário {{data}} às {{hora}} com {{profissional}}. Quer ficar com ele? Responda SIM. Quem responder primeiro garante a vaga." },
  { key: "oferta_aceita", group: "espera", label: "Horário garantido", when: "O paciente respondeu SIM primeiro e ficou com a vaga.", optional: false, outsideWindow: false, variables: APPT,
    body: "Horário garantido, {{primeiro_nome}}! {{data}} às {{hora}} com {{profissional}}. Te esperamos!" },
  { key: "oferta_recusada", group: "espera", label: "Recusou o horário", when: "O paciente respondeu NÃO à oferta.", optional: true, outsideWindow: false, variables: BASE,
    body: "Tudo bem, {{primeiro_nome}}! Você continua na lista de espera e avisaremos no próximo horário." },
  { key: "oferta_perdida", group: "espera", label: "Chegou tarde", when: "Respondeu SIM, mas outra pessoa já tinha ficado com o horário.", optional: false, outsideWindow: false, variables: BASE,
    body: "Que pena, {{primeiro_nome}}: esse horário já foi preenchido. Você continua na lista de espera e avisaremos no próximo!" },
  // Pesquisa
  { key: "nps", group: "pesquisa", label: "Pergunta da pesquisa", when: "Depois do atendimento (marcou “Compareceu”).", optional: false, outsideWindow: true, variables: BASE,
    body: "Olá, {{primeiro_nome}}! Obrigado pela visita à {{clinica}}. De 0 a 10, quanto você nos recomendaria a um amigo ou familiar?" },
  { key: "nps_obrigado", group: "pesquisa", label: "Agradecimento (nota boa)", when: "Respondeu a pesquisa com nota acima do limite de alerta.", optional: true, outsideWindow: false, variables: [...BASE, "link_avaliacao"],
    body: "Obrigado, {{primeiro_nome}}! Sua opinião nos ajuda muito." },
  { key: "nps_detrator", group: "pesquisa", label: "Nota baixa", when: "Nota no limite de alerta ou abaixo: a gestão recebe uma tarefa para ligar.", optional: true, outsideWindow: false, variables: BASE,
    body: "Obrigado pela sinceridade, {{primeiro_nome}}. Sentimos muito que a experiência não foi boa: alguém da gestão vai falar com você hoje." },
  // Relacionamento
  { key: "boas_vindas", group: "relacionamento", label: "Boas-vindas", when: "Primeira mensagem de um contato novo (automação “Boas-vindas”).", optional: false, outsideWindow: false, variables: BASE,
    body: "Olá! Aqui é da {{clinica}}. Recebemos sua mensagem e já vamos te responder." },
  { key: "fora_horario", group: "relacionamento", label: "Fora do horário", when: "Mensagem recebida fora do horário de atendimento (automação “Fora do horário”).", optional: false, outsideWindow: false, variables: [...BASE, "horario_atendimento"],
    body: "Olá, {{primeiro_nome}}! Nosso atendimento é {{horario_atendimento}}. Recebemos sua mensagem e respondemos assim que abrirmos." },
  { key: "aniversario", group: "relacionamento", label: "Aniversário", when: "No dia do aniversário do paciente (automação “Aniversário”).", optional: false, outsideWindow: true, variables: BASE,
    body: "Feliz aniversário, {{primeiro_nome}}! Toda a equipe da {{clinica}} deseja um novo ano cheio de saúde." },
  // LGPD
  { key: "descadastro", group: "lgpd", label: "Confirmação do SAIR", when: "O paciente escreveu SAIR ou PARAR. Não pode ser desligada (LGPD).", optional: false, outsideWindow: false, variables: BASE,
    body: "Tudo certo, {{primeiro_nome}}. Você não receberá mais mensagens de lembrete e campanhas. Para falar com a clínica, é só escrever aqui. Se mudar de ideia, envie VOLTAR." },
  { key: "reativacao", group: "lgpd", label: "Confirmação do VOLTAR", when: "O paciente que tinha saído escreveu VOLTAR. Não pode ser desligada.", optional: false, outsideWindow: false, variables: BASE,
    body: "Pronto, {{primeiro_nome}}! Você voltará a receber lembretes e avisos da {{clinica}}." },
] as const satisfies readonly {
  key: string;
  group: TemplateGroup;
  label: string;
  when: string;
  optional: boolean;
  outsideWindow: boolean;
  variables: readonly Var[];
  body: string;
}[];

export type MessageTemplateKey = (typeof MESSAGE_TEMPLATES)[number]["key"];
export type MessageTemplateDef = (typeof MESSAGE_TEMPLATES)[number];

const BY_KEY = new Map<string, MessageTemplateDef>(MESSAGE_TEMPLATES.map((t) => [t.key, t]));
export const templateDef = (key: string): MessageTemplateDef | undefined => BY_KEY.get(key);
export const isTemplateKey = (key: string): key is MessageTemplateKey => BY_KEY.has(key);

/** Atalhos de respostas rápidas que já valiam como modelo antes desta tela (compatibilidade). */
export const LEGACY_QUICK_REPLY_SHORTCUT: Partial<Record<MessageTemplateKey, string>> = {
  confirmacao: "confirmar",
  nps: "pesquisa",
  remarcacao: "remarcar",
  oferta: "oferta",
};

export const VARIABLE_LABEL: Record<Var, string> = {
  nome: "Nome completo",
  primeiro_nome: "Primeiro nome",
  clinica: "Nome da clínica",
  data: "Data da consulta",
  hora: "Hora da consulta",
  profissional: "Profissional",
  horario_atendimento: "Horário de atendimento",
  link_avaliacao: "Link de avaliação",
};

/** Valores de exemplo para a prévia. */
export const SAMPLE_VARIABLES: Record<Var, string> = {
  nome: "Maria Souza",
  primeiro_nome: "Maria",
  clinica: "Clínica Exemplo",
  data: "qui, 23/10",
  hora: "14:30",
  profissional: "Dra. Beatriz Lemos",
  horario_atendimento: "de segunda a sexta, das 8h às 18h",
  link_avaliacao: "https://g.page/r/clinica-exemplo/review",
};

/** Variáveis usadas no texto que esta mensagem não preenche (aviso na tela). */
export function unknownVariables(body: string, allowed: readonly string[]): string[] {
  const used = [...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(used.filter((v) => !allowed.includes(v)))];
}
