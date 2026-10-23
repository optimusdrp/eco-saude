/**
 * RITMO DE ENVIO DO WHATSAPP DO CELULAR (QR code / código pela Evolution)
 *
 * O WhatsApp do celular não é a API oficial: um número que dispara muitas mensagens seguidas
 * (confirmações e lembretes em massa) corre risco de bloqueio. O Tropi espaça os envios
 * AUTOMÁTICOS como uma pessoa faria.
 *
 * Decisões (23/10/2026):
 *  - Só as mensagens automáticas (sem autor: confirmações, lembretes, retornos em lote, regras,
 *    respostas automáticas) esperam a vez. A resposta que a equipe digita sai na hora: ela já
 *    tem o ritmo de uma pessoa e não pode ficar presa atrás de uma fila de lembretes. Mas ela
 *    CONTA nos limites (o WhatsApp vê o número inteiro, não quem digitou).
 *  - Intervalo aleatório entre envios automáticos e limites por minuto e por hora, com três
 *    sugestões prontas e a opção de personalizar (Ajustes > Canais).
 *  - Mensagem automática que perdeu o sentido enquanto esperava (lembrete ou confirmação de
 *    consulta que já começou; oferta de horário que expirou) NÃO sai: fica "não enviada:
 *    venceu na fila" e aparece na tela de Canais.
 *  - A API oficial e os outros canais não mudam (a Meta controla o ritmo lá).
 *
 * Nenhuma chamada fica "dormindo" 4 a 12 s: a vez de enviar é marcada no banco
 * (channel_connections.pace_next_at) e quem chega antes da hora deixa a mensagem na fila.
 */

export interface PacingLimits {
  /** Intervalo aleatório entre dois envios automáticos, em segundos */
  minGapS: number;
  maxGapS: number;
  /** Máximo de mensagens (automáticas + digitadas) por minuto e por hora */
  perMinute: number;
  perHour: number;
}

export const PACING_PRESET_IDS = ["cauteloso", "aquecido", "maxima"] as const;
export type PacingPresetId = (typeof PACING_PRESET_IDS)[number];
export type PacingChoice = PacingPresetId | "personalizado";

export interface PacingPreset extends PacingLimits {
  label: string;
  /** Para quem serve, em uma frase */
  description: string;
}

export const PACING_PRESETS: Record<PacingPresetId, PacingPreset> = {
  cauteloso: {
    label: "Número novo (cauteloso)",
    description: "Para número recém-conectado ou que nunca mandou mensagens em volume. É o padrão.",
    minGapS: 4,
    maxGapS: 12,
    perMinute: 6,
    perHour: 60,
  },
  aquecido: {
    label: "Número aquecido",
    description: "Para número que conversa com pacientes há meses, sem bloqueios nem denúncias.",
    minGapS: 4,
    maxGapS: 12,
    perMinute: 8,
    perHour: 120,
  },
  maxima: {
    label: "Máxima cautela",
    description: "Depois de um aviso ou bloqueio temporário do WhatsApp, ou para número muito novo.",
    minGapS: 8,
    maxGapS: 20,
    perMinute: 4,
    perHour: 40,
  },
};

export interface PacingConfig extends PacingLimits {
  preset: PacingChoice;
}

export const DEFAULT_PACING: PacingConfig = { preset: "cauteloso", ...limitsOf(PACING_PRESETS.cauteloso) };

function limitsOf(p: PacingLimits): PacingLimits {
  return { minGapS: p.minGapS, maxGapS: p.maxGapS, perMinute: p.perMinute, perHour: p.perHour };
}

/** Faixas aceitas no "personalizado" (nada que deixe o número tão exposto quanto antes) */
export const PACING_BOUNDS = {
  minGapS: { min: 2, max: 120 },
  maxGapS: { min: 2, max: 300 },
  perMinute: { min: 1, max: 20 },
  perHour: { min: 1, max: 600 },
} as const;

/** Erros do ritmo personalizado (vazio = válido) */
export function validatePacing(c: PacingLimits): string[] {
  const errors: string[] = [];
  const range = (k: keyof typeof PACING_BOUNDS, label: string) => {
    const v = c[k];
    const b = PACING_BOUNDS[k];
    if (!Number.isInteger(v) || v < b.min || v > b.max) errors.push(`${label}: de ${b.min} a ${b.max}`);
  };
  range("minGapS", "Intervalo mínimo (s)");
  range("maxGapS", "Intervalo máximo (s)");
  range("perMinute", "Por minuto");
  range("perHour", "Por hora");
  if (!errors.length && c.maxGapS < c.minGapS) errors.push("O intervalo máximo não pode ser menor que o mínimo");
  if (!errors.length && c.perHour < c.perMinute) errors.push("O limite por hora não pode ser menor que o limite por minuto");
  return errors;
}

/**
 * Ritmo guardado no banco (jsonb) -> ritmo em uso. Sugestão pronta usa SEMPRE os números da
 * sugestão (se o Tropi ajustar uma sugestão, todas as clínicas que a escolheram acompanham).
 * Vazio ou inválido: o padrão (cauteloso).
 */
export function pacingFrom(raw: unknown): PacingConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PacingConfig>;
  if (r.preset && r.preset !== "personalizado" && PACING_PRESET_IDS.includes(r.preset)) return { preset: r.preset, ...limitsOf(PACING_PRESETS[r.preset]) };
  if (r.preset === "personalizado") {
    const c = { minGapS: Number(r.minGapS), maxGapS: Number(r.maxGapS), perMinute: Number(r.perMinute), perHour: Number(r.perHour) };
    if (!validatePacing(c).length) return { preset: "personalizado", ...c };
  }
  return { ...DEFAULT_PACING };
}

/** Próximo intervalo, sorteado entre o mínimo e o máximo (em ms) */
export function nextGapMs(c: PacingLimits, random: () => number = Math.random): number {
  const span = Math.max(0, c.maxGapS - c.minGapS);
  return Math.round((c.minGapS + random() * span) * 1000);
}

export type PacingBlock = "intervalo" | "minuto" | "hora";

/** Já é a vez de mandar a próxima automática? */
export function pacingCheck(p: { now: Date; nextAt: Date | null; sentLastMinute: number; sentLastHour: number; config: PacingLimits }): { ok: true } | { ok: false; reason: PacingBlock } {
  if (p.sentLastHour >= p.config.perHour) return { ok: false, reason: "hora" };
  if (p.sentLastMinute >= p.config.perMinute) return { ok: false, reason: "minuto" };
  if (p.nextAt && p.nextAt.getTime() > p.now.getTime()) return { ok: false, reason: "intervalo" };
  return { ok: true };
}

export const PACING_BLOCK_LABEL: Record<PacingBlock, string> = {
  intervalo: "esperando o intervalo entre mensagens",
  minuto: "limite por minuto atingido",
  hora: "limite por hora atingido",
};

/** Mensagem que entra no ritmo: automática (sem autor). A digitada pela equipe sai na hora. */
export function isPacedMessage(m: { authorId: string | null }): boolean {
  return m.authorId === null;
}

/* ------------------------------ Venceu na fila ------------------------------ */

/** Modelos ligados a uma consulta que ainda VAI acontecer: depois do início, não fazem sentido */
const BEFORE_APPOINTMENT = new Set(["confirmacao", "lembrete"]);

/**
 * Motivo para NÃO mandar uma automática que esperou demais (null = ainda vale).
 *  - confirmação e lembrete: a consulta já começou (ou foi apagada);
 *  - oferta de vaga da lista de espera: a oferta não está mais aberta.
 */
export function staleReason(
  m: { templateKey: string | null; meta: unknown },
  ctx: { now: Date; appointmentStartsAt?: Date | null; appointmentExists?: boolean; offerOpen?: boolean | null },
): string | null {
  const meta = (m.meta && typeof m.meta === "object" ? m.meta : {}) as Record<string, unknown>;
  if (m.templateKey && BEFORE_APPOINTMENT.has(m.templateKey) && typeof meta.appointmentId === "string") {
    if (ctx.appointmentExists === false) return "a consulta não existe mais";
    if (ctx.appointmentStartsAt && ctx.appointmentStartsAt.getTime() <= ctx.now.getTime()) return "a consulta já começou";
  }
  if (m.templateKey === "oferta" && typeof meta.offerId === "string" && ctx.offerOpen === false) return "a oferta de horário já expirou";
  return null;
}

export const STALE_PREFIX = "Não enviada: venceu na fila";

/* --------------------------------- Previsão --------------------------------- */

/**
 * Quanto tempo a fila automática leva para sair, em minutos (aproximado, para a tela).
 * Usa o mais lento entre o intervalo médio e o limite por minuto, e respeita o limite por
 * hora (o que passar dele espera a hora seguinte).
 */
export function drainMinutes(p: { queued: number; sentLastHour: number; config: PacingLimits }): number {
  if (p.queued <= 0) return 0;
  const c = p.config;
  const secondsEach = Math.max((c.minGapS + c.maxGapS) / 2, 60 / c.perMinute);
  const fitsThisHour = Math.max(0, c.perHour - p.sentLastHour);
  if (p.queued <= fitsThisHour) return Math.ceil((p.queued * secondsEach) / 60);
  // O que não cabe nesta hora espera a janela de 1 hora andar: lotes de até "por hora" a cada hora
  const perHourReal = Math.min(c.perHour, Math.floor(3600 / secondsEach));
  const rest = p.queued - fitsThisHour;
  const batches = Math.ceil(rest / perHourReal);
  const last = rest - perHourReal * (batches - 1);
  return Math.ceil(60 * batches + (last * secondsEach) / 60);
}

/** Características de um ritmo para a tela comparar as opções */
export function pacingTraits(c: PacingLimits): string[] {
  return [
    c.minGapS === c.maxGapS ? `Intervalo de ${c.minGapS} s` : `Intervalo de ${c.minGapS} a ${c.maxGapS} s`,
    `Até ${c.perMinute} por minuto e ${c.perHour} por hora`,
    `200 confirmações levam ${formatDrain(drainMinutes({ queued: 200, sentLastHour: 0, config: c }))}`,
  ];
}

/** "cerca de 25 min", "cerca de 3h20" */
export function formatDrain(minutes: number): string {
  if (minutes <= 0) return "nada na fila";
  if (minutes < 60) return `cerca de ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round((minutes % 60) / 5) * 5;
  return m ? `cerca de ${h}h${String(m).padStart(2, "0")}` : `cerca de ${h}h`;
}
