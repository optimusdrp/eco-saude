/**
 * Entendimento das mensagens dos pacientes, sem IA externa.
 *
 * Regras locais em português: rodam no servidor, sem enviar dados de saúde
 * a terceiros (LGPD). A interface é a mesma que um modelo de IA (ex.: Gemini)
 * poderá implementar no futuro: texto -> intenção / urgência.
 */

/** Minúsculas, sem acentos e sem pontuação repetida: "Não  CONSIGO!!" -> "nao consigo!" */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------- Intenção --------------------------------- */

export const INTENTS = ["agendar", "remarcar", "cancelar", "confirmar", "preco", "endereco", "resultado"] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABEL: Record<Intent, string> = {
  agendar: "Quer agendar",
  remarcar: "Quer remarcar",
  cancelar: "Quer cancelar",
  confirmar: "Confirmou",
  preco: "Pergunta valores",
  endereco: "Pergunta endereço",
  resultado: "Pergunta sobre exame",
};

/**
 * Ordem importa:
 * - "remarcar" antes de "agendar" (remarcar contém "marcar")
 * - "agendar" por último: palavras como "consulta" aparecem em perguntas de preço, endereço etc.
 */
const INTENT_PATTERNS: [Intent, RegExp][] = [
  ["remarcar", /\b(remarc|reagend|mudar (o |a |meu |minha )?(horario|dia|data|consulta)|trocar (o |de )?(horario|dia)|adiar|outro (dia|horario))/],
  ["cancelar", /\b(cancel|desmarc|nao (vou|vai) (poder|conseguir) (ir|comparecer)|nao poderei)/],
  ["confirmar", /^(sim|confirmo|confirmado|confirmada|ok|certo|combinado|1)\b/],
  ["preco", /\b(valor|preco|quanto (custa|fica|e)|convenio|particular|plano de saude|aceita[m]? )/],
  ["endereco", /\b(endereco|onde (fica|e)|localizacao|como chego|estacionamento)/],
  ["resultado", /\b(resultado|exame|laudo)/],
  // Genérico por último: "consulta" aparece em quase toda mensagem
  ["agendar", /\b(agendar|agendamento|agendo|marcar|marcacao|consulta|horario|vaga|encaixe|encaixar|disponibilidade|atendimento)/],
];

export function detectIntent(text: string): Intent | null {
  const t = normalizeText(text);
  for (const [intent, pattern] of INTENT_PATTERNS) if (pattern.test(t)) return intent;
  return null;
}

/* -------------------------------- Urgência --------------------------------- */

/**
 * Sinais de possível urgência. NUNCA respondem sozinhos: só destacam a conversa
 * para uma pessoa agir. O chat não é canal de emergência.
 */
const URGENCY_PATTERNS: { kind: "clinica" | "emocional"; label: string; pattern: RegExp }[] = [
  { kind: "clinica", label: "dor no peito", pattern: /dor (forte )?no peito|aperto no peito/ },
  { kind: "clinica", label: "falta de ar", pattern: /falta de ar|nao consigo respirar|dificuldade (para|de|pra) respirar/ },
  { kind: "clinica", label: "desmaio", pattern: /desmai/ },
  { kind: "clinica", label: "sangramento", pattern: /sangramento|sangrando muito|hemorragia/ },
  { kind: "clinica", label: "convulsão", pattern: /convuls/ },
  { kind: "clinica", label: "sinais de AVC", pattern: /\bavc\b|boca torta|perdi a forca|dormencia (no|na) (rosto|braco)/ },
  { kind: "clinica", label: "reação alérgica grave", pattern: /garganta fechando|inchaco na (garganta|lingua)|choque anafil/ },
  { kind: "clinica", label: "febre alta em bebê", pattern: /(bebe|recem.nascido).{0,40}febre|febre.{0,40}(bebe|recem.nascido)/ },
  { kind: "emocional", label: "risco à vida", pattern: /suicid|me matar|tirar minha (propria )?vida|nao quero (mais )?viver/ },
];

export interface UrgencySignal {
  urgent: boolean;
  kind: "clinica" | "emocional" | null;
  labels: string[];
}

export function detectUrgency(text: string): UrgencySignal {
  const t = normalizeText(text);
  const hits = URGENCY_PATTERNS.filter((p) => p.pattern.test(t));
  if (hits.length === 0) return { urgent: false, kind: null, labels: [] };
  return {
    urgent: true,
    kind: hits.some((h) => h.kind === "emocional") ? "emocional" : "clinica",
    labels: hits.map((h) => h.label),
  };
}

/** Orientação exibida à equipe quando há sinal de urgência. */
export const URGENCY_GUIDANCE: Record<"clinica" | "emocional", string> = {
  clinica:
    "Possível urgência. Não dê orientação clínica pelo chat: oriente procurar o pronto-socorro mais próximo ou ligar para o SAMU (192) e avise o profissional responsável.",
  emocional:
    "Possível risco à vida. Responda com acolhimento, informe o CVV (ligue 188, 24h) e o SAMU (192), e avise a gestão imediatamente.",
};

/* ------------------------- Respostas curtas do paciente --------------------- */

/** "sim", "1", "confirmo", "pode ser", "quero"... */
export function isAffirmative(text: string): boolean {
  const t = normalizeText(text).replace(/[!.?]+$/, "");
  return /^(1|sim|s|confirmo|confirmado|confirmada|quero|pode ser|pode|ok|beleza|claro|aceito|com certeza|sim,? (eu )?quero|sim,? confirmo)$/.test(t);
}

/** "2", "não", "remarcar"... */
export function isDecline(text: string): boolean {
  const t = normalizeText(text).replace(/[!.?]+$/, "");
  return /^(2|nao|n|nao posso|nao vou poder|remarcar|quero remarcar|preciso remarcar)$/.test(t);
}

/** Pedido de descadastro de mensagens (LGPD): SAIR, PARAR, STOP... */
export function isOptOut(text: string): boolean {
  const t = normalizeText(text).replace(/[!.?]+$/, "");
  return /^(sair|parar|stop|descadastrar|nao quero (mais )?receber( mensagens)?)$/.test(t);
}

/** Pedido para VOLTAR a receber mensagens depois de ter enviado SAIR. */
export function isOptIn(text: string): boolean {
  const t = normalizeText(text).replace(/[!.?]+$/, "");
  return /^(voltar|voltar a receber|quero (voltar a )?receber( mensagens)?|reativar|start)$/.test(t);
}

/** Nota de 0 a 10 da pesquisa de satisfação: "9", "nota 9", "10!" */
export function parseNpsScore(text: string): number | null {
  const t = normalizeText(text);
  const m = /^(?:nota\s*)?(\d{1,2})(?:\s*[!.]*)?(?:\s.*)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 10 ? n : null;
}

/* --------------------------------- Modelos ---------------------------------- */

export const TEMPLATE_VARIABLES = ["nome", "primeiro_nome", "data", "hora", "profissional", "clinica", "horario_atendimento", "link_avaliacao", "local", "endereco", "consultorio"] as const;
export type TemplateVariables = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/** Troca {{variavel}} pelo valor. Variáveis sem valor somem (não aparece "{{data}}" para o paciente). */
export function fillTemplate(body: string, vars: TemplateVariables): string {
  return body
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => vars[key as keyof TemplateVariables] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Sugestões de resposta conforme a intenção detectada.
 * `slots` são horários livres já formatados ("qui, 09/10 às 14:00").
 */
export function suggestReplies(intent: Intent | null, ctx: { firstName: string; slots: string[]; clinicName: string }): string[] {
  const name = ctx.firstName;
  const slotText =
    ctx.slots.length > 0 ? `Tenho estes horários: ${ctx.slots.slice(0, 3).join("; ")}. Algum fica bom para você?` : "";
  switch (intent) {
    case "agendar":
      return [
        `Olá, ${name}! Claro, vamos agendar. ${slotText}`.trim(),
        `Olá, ${name}! Qual período fica melhor para você: manhã ou tarde?`,
      ];
    case "remarcar":
      return [
        `Sem problemas, ${name}! Vamos remarcar. ${slotText}`.trim(),
        `Tudo bem, ${name}. Qual dia e período ficam melhores para você?`,
      ];
    case "cancelar":
      return [
        `Tudo bem, ${name}. Posso cancelar e já deixar um novo horário reservado para você?`,
        `Entendido, ${name}. Cancelamos sua consulta. Quando quiser remarcar, é só chamar aqui.`,
      ];
    case "confirmar":
      return [`Perfeito, ${name}! Está confirmado. Até lá!`];
    case "preco":
      return [`Olá, ${name}! Os valores dependem do tipo de consulta. Você tem convênio ou seria particular?`];
    case "endereco":
      return [`Olá, ${name}! Vou te enviar o endereço e a localização da ${ctx.clinicName}.`];
    case "resultado":
      return [`Olá, ${name}! Vou verificar seu exame com a equipe e já te retorno por aqui.`];
    default:
      return [`Olá, ${name}! Como podemos ajudar?`];
  }
}
