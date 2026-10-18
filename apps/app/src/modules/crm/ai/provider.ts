import "server-only";
import { ruleFromTextRules } from "@ecosaude/core/crm";

/**
 * PROVEDOR DE IA (Gemini) com proteções
 *
 *  - Tempo limite por chamada (AbortController): IA lenta não trava a recepção.
 *  - Duas tentativas em MODELOS DIFERENTES: o principal e um reserva mais leve
 *    (instabilidade costuma ser por modelo/cota). Só tenta de novo em erro
 *    "passageiro" (429, 5xx, tempo esgotado, rede).
 *  - Disjuntor (circuit breaker): depois de 3 falhas seguidas, para de chamar a
 *    IA por 2 minutos e vai direto ao plano B, sem fazer cada atendente esperar
 *    o tempo limite. O estado fica na memória do servidor (cada instância tem o
 *    seu; numa instância nova ele recomeça fechado, o que é seguro).
 *
 * Variáveis de ambiente (veja .env.example):
 *   GEMINI_API_KEY          chave do Google AI Studio (ou da conta paga)
 *   GEMINI_MODEL            padrão gemini-3.6-flash
 *   GEMINI_FALLBACK_MODEL   padrão gemini-3.5-flash-lite
 *   GEMINI_CLASSIFY_MODEL   padrão gemini-3.5-flash-lite (classificar é simples: modelo leve e barato)
 *   AI_TIMEOUT_MS           padrão 9000 (por tentativa)
 *   AI_PROVIDER             gemini (padrão) | mock (testes sem internet)
 */

export interface AiRequest {
  system: string;
  user: string;
  /** Formato JSON exigido da resposta (subconjunto OpenAPI do Gemini) */
  schema: object;
  temperature?: number;
}

export interface AiResponse {
  text: string;
  model: string;
  provider: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class AiError extends Error {
  constructor(
    message: string,
    /** Vale tentar de novo (outro modelo) ou é definitivo (chave inválida, bloqueio)? */
    public retryable: boolean,
    /** Motivo em português para o registro e para a tela */
    public reason: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const env = () => ({
  provider: process.env.AI_PROVIDER ?? "gemini",
  key: process.env.GEMINI_API_KEY ?? "",
  // Padrão: o Flash estável mais recente (out/2026). Troque pelo .env sem mexer no código.
  model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  fallback: process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite",
  classify: process.env.GEMINI_CLASSIFY_MODEL || "gemini-3.5-flash-lite",
  timeout: Number(process.env.AI_TIMEOUT_MS) || 9000,
  /**
   * LGPD: quem administra o servidor CONFIRMA que a chave é de um projeto com
   * faturamento ativo (nível pago: o Google não usa os dados para treinar).
   * A API não informa o nível da chave, por isso a confirmação é explícita.
   */
  paidTier: /^(sim|true|1)$/i.test(process.env.GEMINI_PAID_TIER ?? ""),
});

/**
 * A IA está configurada no servidor? Sem chave, ou com chave sem a confirmação
 * de conta paga, é sempre plano B (nenhum dado de paciente sai do sistema).
 */
export function aiConfigured(): boolean {
  const e = env();
  return e.provider === "mock" || (e.key.length > 10 && e.paidTier);
}

/** Situação para a tela de Ajustes (sem expor a chave). */
export function aiStatus() {
  const e = env();
  return {
    configured: aiConfigured(),
    /** Tem chave, mas falta confirmar a conta paga (GEMINI_PAID_TIER=sim) */
    keyWithoutPaidTier: e.provider !== "mock" && e.key.length > 10 && !e.paidTier,
    provider: e.provider === "mock" ? "Simulado (testes)" : "Google Gemini",
    models: { draft: e.model, fallback: e.fallback, classify: e.classify },
    timeoutS: Math.round(e.timeout / 1000),
    breakerOpen: breakerOpen(),
  };
}

/* --------------------------------- Disjuntor -------------------------------- */

const breaker = { failures: 0, openUntil: 0 };
const BREAK_AFTER = 3;
const BREAK_MS = 2 * 60_000;

export function breakerOpen(now = Date.now()): boolean {
  return breaker.openUntil > now;
}
function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordFailure(now = Date.now()) {
  breaker.failures++;
  if (breaker.failures >= BREAK_AFTER) breaker.openUntil = now + BREAK_MS;
}
/** Só para testes */
export function resetBreaker() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}

/* --------------------------------- Gemini ----------------------------------- */

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

async function callGemini(model: string, req: AiRequest, key: string, timeoutMs: number): Promise<AiResponse> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      // Chave no cabeçalho (não na URL: URLs costumam ir para logs)
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.4,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema: req.schema,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const aborted = (error as Error).name === "AbortError";
    throw new AiError((error as Error).message, true, aborted ? `a IA não respondeu em ${Math.round(timeoutMs / 1000)} s` : "sem conexão com a IA");
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429) throw new AiError(msg, true, "limite de uso da IA atingido");
    if (res.status >= 500) throw new AiError(msg, true, "IA instável no momento");
    // O Gemini responde chave inválida com 400 ("API key not valid"), não só 401/403
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[_ ]?key/i.test(msg))) throw new AiError(msg, false, "chave da IA inválida ou sem permissão");
    if (res.status === 404) throw new AiError(msg, true, `modelo ${model} indisponível`);
    throw new AiError(msg, false, "a IA recusou o pedido");
  }
  if (data.promptFeedback?.blockReason) throw new AiError(data.promptFeedback.blockReason, false, "a IA bloqueou o conteúdo por segurança");
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text)
    throw new AiError(
      `sem texto (${cand?.finishReason ?? "?"})`,
      cand?.finishReason !== "SAFETY",
      cand?.finishReason === "SAFETY" ? "a IA bloqueou o conteúdo por segurança" : "a IA não devolveu texto",
    );
  return {
    text,
    model,
    provider: "gemini",
    latencyMs: Date.now() - started,
    inputTokens: data.usageMetadata?.promptTokenCount ?? null,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
  };
}

/* ---------------------------------- Mock ------------------------------------ */

/**
 * Provedor de TESTE (AI_PROVIDER=mock): responde sem internet.
 * AI_MOCK_MODE: ok (padrão) | fail | slow | clinical | bad
 */
async function callMock(model: string, req: AiRequest, timeoutMs: number): Promise<AiResponse> {
  const mode = process.env.AI_MOCK_MODE ?? "ok";
  const started = Date.now();
  if (mode === "fail") throw new AiError("mock fail", true, "IA instável no momento");
  if (mode === "slow") {
    await new Promise((r) => setTimeout(r, timeoutMs + 50));
    throw new AiError("mock timeout", true, `a IA não respondeu em ${Math.round(timeoutMs / 1000)} s`);
  }
  const keys = "properties" in req.schema ? Object.keys((req.schema as { properties: object }).properties) : [];
  const ok = (v: unknown, out = 30) => ({
    text: typeof v === "string" ? v : JSON.stringify(v),
    model: `mock:${model}`,
    provider: "mock" as const,
    latencyMs: Date.now() - started,
    inputTokens: req.user.length / 4,
    outputTokens: out,
  });
  const patientLines = req.user
    .split("\n")
    .filter((l) => l.startsWith("- ") || l.startsWith("PACIENTE:"))
    .map((l) => l.replace(/^(- |PACIENTE: )/, ""));
  // Regra pela frase (formato com "gatilho"): imita a IA usando as regras + nome melhor
  if (keys.includes("gatilho")) {
    if (mode === "bad") return ok({ gatilho: "message_in", esperaMinutos: 0, acoes: [{ tipo: "send_message", texto: "Promoção: 30% de desconto só hoje!" }] });
    if (mode === "clinical") return ok({ gatilho: "message_in", esperaMinutos: 0, acoes: [{ tipo: "send_message", texto: "Tome 500 mg de dipirona" }] });
    const pedido = /PEDIDO: (.+)/.exec(req.user)?.[1] ?? "";
    const team = (/EQUIPE: (.+)/.exec(req.user)?.[1] ?? "")
      .split("; ")
      .filter(Boolean)
      .map((n) => ({ id: n, name: n }));
    const d = ruleFromTextRules(pedido, { team, tags: [] });
    if (!d) return ok({ gatilho: "contact_created", esperaMinutos: 0, acoes: [], duvidas: ["Não entendi o pedido."] });
    const r = d.rule;
    return ok({
      nome: r.filter.keywords?.startsWith("orçamento") ? "Retomar orçamentos parados" : r.name,
      gatilho: r.trigger,
      palavras: r.filter.keywords ?? "",
      etapa: r.filter.stage ?? "",
      status: r.filter.status ?? "",
      canal: r.filter.channel ?? "",
      notaMin: r.filter.minScore ?? -1,
      notaMax: r.filter.maxScore ?? -1,
      esperaMinutos: r.delayMinutes,
      condicoes: r.conditions.map((c) => ({ tipo: c.type, valor: c.value ?? "" })),
      acoes: r.actions.map((a) => ({
        tipo: a.type,
        texto: a.text ?? "",
        responsavel: a.assignee === "owner" || !a.assignee ? "owner" : a.assignee,
        prazoDias: a.dueInDays ?? 0,
        etapa: a.stage ?? "",
        etiqueta: a.tag ?? "",
      })),
      umaVezPorContato: r.oncePerContact,
      entendido: d.understood,
      // Como a IA real: explica o que não achou no catálogo (ex.: pessoa fora da equipe)
      duvidas: d.warnings.filter((w) => !w.includes("janela de 24h")),
    });
  }
  // Respostas rápidas sugeridas (formato com "sugestoes"): limpa a 1ª variação de cada grupo
  if (keys.includes("sugestoes")) {
    const groups = req.user.split(/\n\n(?=GRUPO )/).map(
      (g) =>
        g
          .split("\n")
          .find((l) => l.startsWith("- "))
          ?.slice(2) ?? "",
    );
    const sugestoes = groups.map((first, i) => {
      if (mode === "bad") return { grupo: i + 1, util: true, atalho: "x", titulo: "X", texto: `${first} Ligue 3333-9999.` };
      const personal = /\bseu exame\b|\bsua cirurgia\b/i.test(first);
      return {
        grupo: i + 1,
        util: !personal,
        atalho: /endere|rua/i.test(first) ? "endereco" : /estaciona/i.test(first) ? "estacionamento" : "",
        titulo: /endere|rua/i.test(first) ? "Endereço e como chegar" : "",
        texto: first.replace(/\s+/g, " ").trim(),
      };
    });
    return ok({ sugestoes });
  }
  // Auditoria de atendimento (formato com "cordialidade"): lê só as falas da atendente
  if (keys.includes("cordialidade")) {
    if (mode === "bad") return ok({ cordialidade: 15, clareza: 8, ofereceuHorario: "sim", confianca: 90 });
    const team = req.user
      .split("\n")
      .filter((l) => l.startsWith("ATENDENTE:"))
      .map((l) => l.slice(11));
    const said = team.join(" ").toLowerCase();
    const greeted = /\b(oi|olá|ola|bom dia|boa tarde)\b/.test(said);
    const offered = /\b\d{1,2}h|\b(segunda|terça|quarta|quinta|sexta|sábado)\b/.test(said);
    const wanted = /pediu para marcar ou remarcar: sim/.test(req.user);
    return ok({
      cordialidade: greeted ? 9 : 5,
      clareza: team.some((t) => t.length > 40) ? 8 : 5,
      ofereceuHorario: offered ? "sim" : wanted ? "nao" : "nao_se_aplica",
      pontoForte: greeted ? "Cumprimentou e foi gentil do início ao fim." : "Respondeu o que foi perguntado.",
      dica: offered || !wanted ? "Confirme ao final se ficou alguma dúvida." : "Quando o paciente quiser marcar, ofereça dois horários.",
      trecho: (team[0] ?? "").split(" ").slice(0, 8).join(" "),
      confianca: mode === "clinical" ? 30 : 85,
    });
  }
  // Duplicados (formato com "veredito"): apelido + mesmo e-mail = mesma pessoa
  if (keys.includes("veredito")) {
    if (mode === "bad") return ok({ veredito: "mesma_pessoa", motivo: "tanto faz", confianca: 99 });
    const yes = (label: string) => new RegExp(`${label}: sim`).test(req.user);
    const a = /Cadastro A: (.+)/.exec(req.user)?.[1] ?? "";
    const b = /Cadastro B: (.+)/.exec(req.user)?.[1] ?? "";
    const nick = /^bia\b/i.test(a) || /^bia\b/i.test(b);
    const v =
      yes("Mesmo e-mail") && nick
        ? { veredito: "mesma_pessoa", motivo: "“Bia” é apelido comum de Beatriz e os dois usam o mesmo e-mail", confianca: 88 }
        : a.split(" ").slice(-1)[0] === b.split(" ").slice(-1)[0] && a.split(" ")[0] !== b.split(" ")[0]
          ? { veredito: "familia", motivo: "mesmo sobrenome com primeiros nomes diferentes: provável parente", confianca: 70 }
          : { veredito: "incerto", motivo: "poucos sinais em comum", confianca: mode === "clinical" ? 30 : 55 };
    return ok(v);
  }
  // Motivo da perda (formato com "categoria")
  if (keys.includes("categoria")) {
    if (mode === "bad") return ok({ categoria: "astrologia", confianca: 90 });
    const said = patientLines.join(" ").toLowerCase();
    const staff = /Motivo digitado pela equipe: (.+)/.exec(req.user)?.[1] ?? "";
    const quote = (re: RegExp) =>
      patientLines
        .find((l) => re.test(l.toLowerCase()))
        ?.split(" ")
        .slice(0, 12)
        .join(" ") ?? "";
    const v = /longe|mudei|outra cidade/.test(said)
      ? { categoria: "distancia", trecho: quote(/longe|mudei|outra cidade/), confianca: 90 }
      : /caro|desconto|parcel/.test(said)
        ? { categoria: "preco", trecho: quote(/caro|desconto|parcel/), confianca: 88 }
        : /plano|conv[eê]nio|unimed/.test(said)
          ? { categoria: "convenio", trecho: quote(/plano|conv[eê]nio|unimed/), confianca: 86 }
          : /hor[aá]rio|trabalho/.test(said)
            ? { categoria: "horario", trecho: quote(/hor[aá]rio|trabalho/), confianca: 84 }
            : { categoria: staff && staff !== "(nenhum)" ? "outro" : "sem_resposta", trecho: "", confianca: mode === "clinical" ? 30 : 70 };
    return ok(v);
  }
  // Etiquetas de comportamento (formato com "etiquetas")
  if (keys.includes("etiquetas")) {
    if (mode === "bad") return ok({ etiquetas: [{ etiqueta: "sensível a preço", trecho: "frase que não existe na conversa" }] });
    const out: { etiqueta: string; trecho: string }[] = [];
    const find = (re: RegExp) => patientLines.find((l) => re.test(l.toLowerCase()));
    const anx = find(/medo|nervos|ansios/);
    if (anx) out.push({ etiqueta: "ansioso com procedimento", trecho: anx.slice(0, 80) });
    const fam = find(/meu marido|minha esposa|minha m[ãa]e|vou ver com/);
    if (fam) out.push({ etiqueta: "decide com a família", trecho: fam.slice(0, 80) });
    const fast = find(/urgente|o quanto antes|hoje ainda/);
    if (fast) out.push({ etiqueta: "quer resolver rápido", trecho: fast.slice(0, 80) });
    return ok({ etiquetas: out });
  }
  // Cadastro pela conversa (formato com "nascimento")
  if (keys.includes("nascimento")) {
    if (mode === "bad") return ok({ nascimento: "2099-13-45", nascimentoTrecho: "nasci ontem" });
    const find = (re: RegExp) => patientLines.find((l) => re.test(l.toLowerCase())) ?? "";
    const birth = find(/nasci|anivers/);
    const dm = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(birth);
    const ins = find(/unimed|plano|conv[eê]nio/);
    const ref = find(/indic|me falou/);
    const who = /(?:\b[aAoO]) ([A-ZÁÉÍÓÚ][a-záéíóúãõç]+) (?:me )?(?:indicou|falou)/.exec(ref)?.[1] ?? "";
    return ok({
      nascimento: dm ? `${dm[3]}-${dm[2]!.padStart(2, "0")}-${dm[1]!.padStart(2, "0")}` : "",
      nascimentoTrecho: dm ? birth.slice(0, 80) : "",
      convenio: /unimed/i.test(ins) ? "Unimed" : "",
      convenioTrecho: /unimed/i.test(ins) ? ins.slice(0, 80) : "",
      indicacao: who,
      indicacaoTrecho: who ? ref.slice(0, 80) : "",
    });
  }
  // Mensagem: retorno personalizado ("TEXTO DA CLÍNICA") ou próximo passo ("OBJETIVO:")
  if (keys.includes("mensagem")) {
    const name = /Paciente: (.+)/.exec(req.user)?.[1] ?? "";
    if (mode === "clinical") return ok({ mensagem: `Oi, ${name}! Tome 500 mg de dipirona antes de vir.` });
    if (/TEXTO DA CLÍNICA:/.test(req.user)) {
      if (mode === "bad") return ok({ mensagem: `Oi, ${name}! Só hoje: 30% de desconto, R$ 99.` });
      const proc = /Último procedimento: (.+)/.exec(req.user)?.[1];
      const months = /Meses desde a última visita: (\d+)/.exec(req.user)?.[1];
      return ok({
        mensagem: `Oi, ${name}! Já faz ${months ?? "um tempo"} ${months === "1" ? "mês" : "meses"}${proc ? ` desde o seu ${proc.toLowerCase()}` : " desde a sua última visita"}. Que tal marcar o retorno? É só responder aqui que vemos o melhor horário.`,
      });
    }
    if (mode === "bad") return ok({ mensagem: `Oi, ${name}! Temos a promoção de R$ 150 só hoje às 18:00.` });
    const goal = /OBJETIVO: (.+)/.exec(req.user)?.[1]?.toLowerCase() ?? "";
    const txt = /sem resposta|follow/.test(goal)
      ? `Oi, ${name}! Passando para saber se ficou alguma dúvida. Se quiser, já vejo um horário para você.`
      : /confirm/.test(goal)
        ? `Oi, ${name}! Tudo certo para a sua consulta? Pode confirmar por aqui.`
        : `Oi, ${name}! Como posso te ajudar? Se quiser, vejo um horário para você.`;
    return ok({ mensagem: txt });
  }
  // Resumo da manhã (formato com "texto"): redige com os números recebidos
  if ("properties" in req.schema && "texto" in (req.schema as { properties: object }).properties) {
    const get = (label: string) => new RegExp(`${label}: (\\d+)`).exec(req.user)?.[1] ?? "0";
    const fit = /encaixes possíveis: (\d+) na (manhã|tarde) de (.+?)(;|\n|$)/.exec(req.user);
    const texto =
      mode === "bad"
        ? `Hoje 99 consultas.`
        : [
            `Hoje são ${get("consultas hoje")} consultas, ${get("com alto risco de falta")} com alto risco de falta.`,
            fit ? `Dá para encaixar ${fit[1]} na ${fit[2]} de ${fit[3]}.` : "",
            Number(get("conversas esperando há mais de 1 hora")) ? `${get("conversas esperando há mais de 1 hora")} conversas esperam há mais de 1 hora.` : "",
          ]
            .filter(Boolean)
            .join(" ");
    return { text: JSON.stringify({ texto }), model: `mock:${model}`, provider: "mock", latencyMs: Date.now() - started, inputTokens: req.user.length / 4, outputTokens: 40 };
  }
  // Pedido de promessas (formato com "promessas"): entende o prazo pelo calendário
  if ("properties" in req.schema && "promessas" in (req.schema as { properties: object }).properties) {
    if (mode === "bad")
      return {
        text: JSON.stringify({ promessas: [{ quem: "clinica", oQue: "mandar", prazo: "2099-01-01" }], confianca: 90 }),
        model: `mock:${model}`,
        provider: "mock",
        latencyMs: 1,
        inputTokens: 1,
        outputTokens: 1,
      };
    const lines = req.user.split("\n");
    const msg = lines
      .slice(lines.findIndex((l) => l.startsWith("MENSAGEM A ANALISAR")) + 1)
      .join(" ")
      .toLowerCase();
    const cal = lines.filter((l) => /^\d{4}-\d{2}-\d{2} = /.test(l));
    const due = /amanh[ãa]/.test(msg)
      ? cal[1]?.slice(0, 10)
      : /sexta/.test(msg)
        ? cal
            .slice(1)
            .find((l) => l.includes("sexta"))
            ?.slice(0, 10)
        : "";
    const v = /or[çc]amento/.test(msg)
      ? { promessas: [{ quem: "clinica", oQue: "Enviar o orçamento do clareamento", prazo: due ?? "" }], confianca: 93 }
      : /doutora|dra\.?/.test(msg) && /aviso|retorno/.test(msg)
        ? { promessas: [{ quem: "clinica", oQue: "Verificar com a doutora e dar retorno", prazo: due ?? "" }], confianca: 90 }
        : /exames/.test(msg) && /te mando/.test(msg)
          ? { promessas: [{ quem: "paciente", oQue: "mandar os exames", prazo: due ?? "" }], confianca: 88 }
          : { promessas: [], confianca: mode === "clinical" ? 30 : 92 };
    return { text: JSON.stringify(v), model: `mock:${model}`, provider: "mock", latencyMs: Date.now() - started, inputTokens: req.user.length / 4, outputTokens: 30 };
  }
  // Pedido de sentimento (formato com "sentimento"): entende ironia e "processo" de procedimento
  if ("properties" in req.schema && "sentimento" in (req.schema as { properties: object }).properties) {
    if (mode === "bad") return { text: JSON.stringify({ sentimento: "furioso", confianca: 90 }), model: `mock:${model}`, provider: "mock", latencyMs: 1, inputTokens: 1, outputTokens: 1 };
    const last =
      req.user
        .split("\n")
        .filter((l) => l.startsWith("PACIENTE:"))
        .pop()
        ?.toLowerCase() ?? "";
    const v = /procon|processar|reclame aqui|advogad/.test(last)
      ? { sentimento: "ameaca", confianca: 95, motivo: "fala em Procon/processo", avaliacaoNegativa: true }
      : /parab[eé]ns pela rapidez|obrigad[oa] por nada/.test(last)
        ? { sentimento: "ironico", confianca: 88, motivo: "elogio irônico pela demora" }
        : /processo de/.test(last)
          ? { sentimento: "calmo", confianca: 92, motivo: "pergunta sobre o procedimento" }
          : /absurdo|p[eé]ssim|descaso/.test(last)
            ? { sentimento: "irritado", confianca: 90, motivo: "reclama com força" }
            : { sentimento: "calmo", confianca: mode === "clinical" ? 30 : 80, motivo: "conversa normal" };
    return { text: JSON.stringify(v), model: `mock:${model}`, provider: "mock", latencyMs: Date.now() - started, inputTokens: req.user.length / 4, outputTokens: 20 };
  }
  // Pedido de agendamento (formato com "datas"): imita a IA lendo calendário e profissionais
  if ("properties" in req.schema && "datas" in (req.schema as { properties: object }).properties) {
    if (mode === "bad")
      return { text: JSON.stringify({ datas: ["2099-01-01"], periodo: "tarde", confianca: 90 }), model: `mock:${model}`, provider: "mock", latencyMs: 1, inputTokens: 1, outputTokens: 1 };
    const lines = req.user.split("\n");
    const said = lines
      .filter((l) => l.startsWith("PACIENTE:"))
      .join(" ")
      .toLowerCase();
    const cal = lines.filter((l) => /^\d{4}-\d{2}-\d{2} = /.test(l)).slice(1); // a partir de amanhã
    // Como a IA de verdade: a última mensagem do paciente vale mais
    const lastSaid =
      lines
        .filter((l) => l.startsWith("PACIENTE:"))
        .pop()
        ?.toLowerCase() ?? "";
    const days = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const day = days.find((d) => lastSaid.includes(d)) ?? days.find((d) => said.includes(d));
    const date = day ? cal.find((l) => l.includes(`= ${day}`))?.slice(0, 10) : undefined;
    const pro = lines
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).replace(/ \(.*\)$/, ""))
      .find((n) => said.includes(n.split(" ")[1]!.toLowerCase()));
    const body = {
      datas: date ? [date] : [],
      periodo: /tarde|\d{2}h/.test(lastSaid) ? "tarde" : /manh[ãa]/.test(lastSaid) ? "manha" : "qualquer",
      horario: /(\d{1,2})h/.exec(lastSaid)?.[1] ? `${/(\d{1,2})h/.exec(lastSaid)![1]!.padStart(2, "0")}:00` : "",
      profissional: pro ?? "",
      procedimento: /clareamento/.test(said) ? "Clareamento" : "",
      confianca: mode === "clinical" ? 20 : 90,
      trecho: lastSaid.replace("paciente:", "").trim().slice(0, 60),
    };
    return { text: JSON.stringify(body), model: `mock:${model}`, provider: "mock", latencyMs: Date.now() - started, inputTokens: req.user.length / 4, outputTokens: 40 };
  }
  // Pedido de classificação de intenção (formato com "confianca")
  if ("properties" in req.schema && "confianca" in (req.schema as { properties: object }).properties) {
    if (mode === "bad") return { text: "{}", model: `mock:${model}`, provider: "mock", latencyMs: 1, inputTokens: 1, outputTokens: 1 };
    const last = req.user.trim().split("\n").pop()?.toLowerCase() ?? "";
    const verdict = /semana que vem|passar pra|outro dia|adiar|trocar o hor/.test(last)
      ? { intencao: "remarcar", confianca: 92, motivo: "pede para mudar a data" }
      : /quanto|valor|pre[cç]o/.test(last)
        ? { intencao: "preco", confianca: 88, motivo: "pergunta valor" }
        : /agenda/.test(last)
          ? { intencao: "outro", confianca: 55, motivo: "menciona agenda pessoal" }
          : { intencao: "outro", confianca: 80, motivo: "sem pedido específico" };
    return { text: JSON.stringify(verdict), model: `mock:${model}`, provider: "mock", latencyMs: Date.now() - started, inputTokens: req.user.length / 4, outputTokens: 20 };
  }
  // Pedido de resumo (formato com "pontos")
  if ("properties" in req.schema && "pontos" in (req.schema as { properties: object }).properties) {
    const convo = req.user.toLowerCase();
    const body =
      mode === "clinical"
        ? { resumo: "relatou dor, tome 500 mg de dipirona", pontos: [] }
        : mode === "bad"
          ? "isto não é json"
          : {
              resumo: [
                /clareamento/.test(convo) ? "quer clareamento" : "quer atendimento",
                /quanto|valor|pre[cç]o/.test(convo) ? "pediu valor" : null,
                /s[aá]bado/.test(convo) ? "prefere sábado de manhã" : null,
                /situacao: paciente aguardando/.test(convo) ? "ainda sem resposta" : "aguardando o paciente",
              ]
                .filter(Boolean)
                .join(", "),
              pontos: ["Perguntou o valor do clareamento", "Prefere sábado de manhã", "A clínica ainda não respondeu"],
              proximoPasso: "Responder com o valor e oferecer horários de sábado de manhã",
            };
    return {
      text: typeof body === "string" ? body : JSON.stringify(body),
      model: `mock:${model}`,
      provider: "mock",
      latencyMs: Date.now() - started,
      inputTokens: req.user.length / 4,
      outputTokens: 60,
    };
  }
  const name = /Paciente: (.+)/.exec(req.user)?.[1] ?? "";
  const slots =
    /HORARIOS_LIVRES[^:]*: (.+)/
      .exec(req.user)?.[1]
      ?.split("; ")
      .filter((s) => !s.startsWith("(")) ?? [];
  const body =
    mode === "clinical"
      ? { resposta: `Oi, ${name}! Tome 500 mg de dipirona e descanse.`, precisaHumano: false }
      : mode === "bad"
        ? "isto não é json"
        : {
            resposta: `Oi, ${name}! Claro, posso te ajudar.${slots.length ? ` Tenho ${slots.slice(0, 2).join(" ou ")}. Algum fica bom?` : " Qual dia e período ficam melhores para você?"}`,
            intencao: "agendar",
            precisaHumano: false,
          };
  return {
    text: typeof body === "string" ? body : JSON.stringify(body),
    model: `mock:${model}`,
    provider: "mock",
    latencyMs: Date.now() - started,
    inputTokens: req.user.length / 4,
    outputTokens: 40,
  };
}

/* ------------------------------ Orquestração -------------------------------- */

/**
 * Pede a resposta: modelo principal; em falha passageira, o modelo reserva.
 * Lança AiError (com o motivo em português) se nenhum responder.
 */
export async function generate(req: AiRequest, opts: { task?: "draft" | "classify" } = {}): Promise<AiResponse> {
  const e = env();
  if (!aiConfigured()) throw new AiError("sem chave", false, "IA não configurada no servidor");
  if (breakerOpen()) throw new AiError("disjuntor aberto", false, "IA instável: usando o plano B por alguns minutos");
  // Classificar: modelo leve primeiro, o principal como reserva. Rascunho: o principal, o leve como reserva.
  const order = opts.task === "classify" ? [e.classify, e.model] : [e.model, e.fallback];
  const models = [...new Set(order)];
  let last: AiError | null = null;
  for (const model of models) {
    try {
      const out = e.provider === "mock" ? await callMock(model, req, e.timeout) : await callGemini(model, req, e.key, e.timeout);
      recordSuccess();
      return out;
    } catch (error) {
      last = error instanceof AiError ? error : new AiError((error as Error).message, true, "falha inesperada na IA");
      if (!last.retryable) break;
    }
  }
  recordFailure();
  throw last ?? new AiError("falha", false, "falha inesperada na IA");
}
