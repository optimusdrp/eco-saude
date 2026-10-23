import "server-only";
import { clinicTimeZone } from "@ecosaude/core/crm";
import { inSequence, schema, sql, type Tx } from "@ecosaude/db";
import { lastReports } from "../ml/models";
import { aiConfigured } from "./provider";

/**
 * NÚMEROS DA IA (últimos 7 dias) para Ajustes > Inteligência artificial
 *
 * Cada funcionalidade de IA mostra o que fez de verdade na clínica: quantas
 * vezes rodou, quanto a IA decidiu x plano B e o que a equipe fez com isso.
 * É o que permite ao gestor decidir, com dados, se vale manter ligada.
 */

export interface AiFeatureStats {
  /** Quantas vezes a funcionalidade rodou na semana */
  week: number;
  /** Frase pronta para o cartão (vazia = nada a dizer) */
  note: string;
}

/** "menos de 1", "2,4" (segundos) */
const seconds = (ms: number) => (ms < 1000 ? "menos de 1" : (ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

export async function aiFeatureStats(tx: Tx): Promise<Record<string, AiFeatureStats>> {
  const [drafts, intents, summaries, schedules, sentiments, promises] = await inSequence([
    // Rascunhos: origem e o que o atendente fez com eles
    () =>
      tx
        .select({
          total: sql<number>`count(*)::int`,
          ia: sql<number>`count(*) filter (where ${schema.aiDrafts.source} = 'ia')::int`,
          usado: sql<number>`count(*) filter (where ${schema.aiDrafts.outcome} = 'usado')::int`,
          editado: sql<number>`count(*) filter (where ${schema.aiDrafts.outcome} = 'editado')::int`,
          descartado: sql<number>`count(*) filter (where ${schema.aiDrafts.outcome} = 'descartado')::int`,
          latencia: sql<
            number | null
          >`(percentile_cont(0.5) within group (order by ${schema.aiDrafts.latencyMs}) filter (where ${schema.aiDrafts.source} = 'ia' and ${schema.aiDrafts.latencyMs} > 0))::int`,
        })
        .from(schema.aiDrafts)
        .where(sql`${schema.aiDrafts.createdAt} > now() - interval '7 days'`),
    // Intenções: quem decidiu, quando a IA discordou das palavras-chave, correções da equipe
    () =>
      tx
        .select({
          ia: sql<number>`count(*) filter (where ${schema.aiClassifications.source} = 'ia')::int`,
          regras: sql<number>`count(*) filter (where ${schema.aiClassifications.source} = 'regras')::int`,
          mudou: sql<number>`count(*) filter (where ${schema.aiClassifications.source} = 'ia' and coalesce(${schema.aiClassifications.finalIntent}, '-') <> coalesce(${schema.aiClassifications.rulesIntent}, '-'))::int`,
          corrigidas: sql<number>`count(*) filter (where ${schema.aiClassifications.source} = 'equipe' and ${schema.aiClassifications.aiIntent} is not null)::int`,
        })
        .from(schema.aiClassifications)
        .where(sql`${schema.aiClassifications.createdAt} > now() - interval '7 days'`),
    // Resumos: origem e a avaliação da equipe ("Ajudou?")
    () =>
      tx
        .select({
          total: sql<number>`count(*)::int`,
          ia: sql<number>`count(*) filter (where ${schema.aiSummaries.source} = 'ia')::int`,
          ajudou: sql<number>`count(*) filter (where ${schema.aiSummaries.helpful} = true)::int`,
          naoAjudou: sql<number>`count(*) filter (where ${schema.aiSummaries.helpful} = false)::int`,
          latencia: sql<
            number | null
          >`(percentile_cont(0.5) within group (order by ${schema.aiSummaries.latencyMs}) filter (where ${schema.aiSummaries.source} = 'ia' and ${schema.aiSummaries.latencyMs} > 0))::int`,
        })
        .from(schema.aiSummaries)
        .where(sql`${schema.aiSummaries.createdAt} > now() - interval '7 days'`),
    // Agendar pelo pedido: virou consulta? com o horário sugerido?
    () =>
      tx
        .select({
          total: sql<number>`count(*)::int`,
          ia: sql<number>`count(*) filter (where ${schema.aiScheduleSuggestions.source} = 'ia')::int`,
          marcadas: sql<number>`count(*) filter (where ${schema.aiScheduleSuggestions.appointmentId} is not null)::int`,
          sugerido: sql<number>`count(*) filter (where ${schema.aiScheduleSuggestions.usedSuggestion} = true)::int`,
        })
        .from(schema.aiScheduleSuggestions)
        .where(sql`${schema.aiScheduleSuggestions.createdAt} > now() - interval '7 days'`),
    // Sentimento: quem decidiu, quantos avisos à gestão, correções da equipe
    () =>
      tx
        .select({
          ia: sql<number>`count(*) filter (where ${schema.aiSentiments.source} = 'ia')::int`,
          regras: sql<number>`count(*) filter (where ${schema.aiSentiments.source} = 'regras')::int`,
          mudou: sql<number>`count(*) filter (where ${schema.aiSentiments.source} = 'ia' and ${schema.aiSentiments.finalSentiment} <> coalesce(${schema.aiSentiments.rulesSentiment}, '-'))::int`,
          avisos: sql<number>`count(*) filter (where ${schema.aiSentiments.alerted})::int`,
          corrigidas: sql<number>`count(*) filter (where ${schema.aiSentiments.source} = 'equipe')::int`,
        })
        .from(schema.aiSentiments)
        .where(sql`${schema.aiSentiments.createdAt} > now() - interval '7 days'`),
    // Promessas: mensagens lidas, tarefas criadas, apagadas como "não era promessa"
    () =>
      tx
        .select({
          lidas: sql<number>`count(*) filter (where ${schema.aiPromises.status} = 'feita')::int`,
          ia: sql<number>`count(*) filter (where ${schema.aiPromises.source} = 'ia')::int`,
          tarefas: sql<number>`coalesce(sum(jsonb_array_length(${schema.aiPromises.taskIds})), 0)::int`,
          desfeitas: sql<number>`coalesce(sum(${schema.aiPromises.undone}), 0)::int`,
        })
        .from(schema.aiPromises)
        .where(sql`${schema.aiPromises.createdAt} > now() - interval '7 days'`),
  ] as const);

  // Modelos aprendidos: último treino (aprovado ou o motivo do plano B) e medições
  const reports = await lastReports(tx);
  const [measured] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.appointments)
    .where(sql`${schema.appointments.finishedAt} is not null and ${schema.appointments.startsAt} > now() - interval '6 months'`);
  const [brief] = await tx
    .select({ source: schema.dayBriefs.source, reason: schema.dayBriefs.fallbackReason })
    .from(schema.dayBriefs)
    .orderBy(sql`${schema.dayBriefs.date} desc`)
    .limit(1);
  const modelNote = (r: Awaited<ReturnType<typeof lastReports>>["risco"], what: string) => {
    if (!r) return `Ainda não treinou: o treino roda sozinho uma vez por dia (ou em “Treinar agora”). Enquanto isso vale ${what}.`;
    const rep = r.report as { n?: number; auc?: number | null; aucFormula?: number | null; reason?: string | null };
    const when = r.at.toLocaleDateString("pt-BR", { timeZone: clinicTimeZone(), day: "2-digit", month: "2-digit" });
    return r.active
      ? `Modelo da clínica em uso (treinado em ${when} com ${rep.n} registros; acerto no teste ${Math.round((rep.auc ?? 0) * 100)}%${rep.aucFormula ? `, contra ${Math.round(rep.aucFormula * 100)}% da regra antiga` : ""}).`
      : `Usando ${what} (plano B): ${rep.reason ?? "modelo não aprovado"}. Último treino em ${when}.`;
  };

  // Relacionamento (jornada, cadastro, etiquetas, duplicados, retorno, melhor horário)
  const [jobs] = await tx
    .select({
      perdaIa: sql<number>`count(*) filter (where ${schema.aiJobs.kind} = 'perda' and ${schema.aiJobs.source} = 'ia')::int`,
      perda: sql<number>`count(*) filter (where ${schema.aiJobs.kind} = 'perda' and ${schema.aiJobs.status} = 'feita')::int`,
      cadastro: sql<number>`count(*) filter (where ${schema.aiJobs.kind} = 'cadastro' and ${schema.aiJobs.status} = 'feita')::int`,
      etiquetas: sql<number>`count(*) filter (where ${schema.aiJobs.kind} = 'etiquetas' and ${schema.aiJobs.status} = 'feita')::int`,
      retorno: sql<number>`count(*) filter (where ${schema.aiJobs.kind} = 'retorno' and ${schema.aiJobs.status} = 'feita')::int`,
      retornoIa: sql<number>`count(*) filter (where ${schema.aiJobs.kind} = 'retorno' and ${schema.aiJobs.source} = 'ia')::int`,
      retornoMotivo: sql<
        string | null
      >`(array_agg(${schema.aiJobs.fallbackReason} order by ${schema.aiJobs.createdAt} desc) filter (where ${schema.aiJobs.kind} = 'retorno' and ${schema.aiJobs.fallbackReason} is not null))[1]`,
    })
    .from(schema.aiJobs)
    .where(sql`${schema.aiJobs.createdAt} > now() - interval '7 days'`);
  const [sugs] = await tx
    .select({
      campoAplicada: sql<number>`count(*) filter (where ${schema.contactSuggestions.kind} = 'campo' and ${schema.contactSuggestions.status} = 'aplicada')::int`,
      campoDescartada: sql<number>`count(*) filter (where ${schema.contactSuggestions.kind} = 'campo' and ${schema.contactSuggestions.status} = 'descartada')::int`,
      campoPendente: sql<number>`count(*) filter (where ${schema.contactSuggestions.kind} = 'campo' and ${schema.contactSuggestions.status} = 'pendente')::int`,
      etqAplicada: sql<number>`count(*) filter (where ${schema.contactSuggestions.kind} = 'etiqueta' and ${schema.contactSuggestions.status} = 'aplicada')::int`,
      etqDescartada: sql<number>`count(*) filter (where ${schema.contactSuggestions.kind} = 'etiqueta' and ${schema.contactSuggestions.status} = 'descartada')::int`,
      etqPendente: sql<number>`count(*) filter (where ${schema.contactSuggestions.kind} = 'etiqueta' and ${schema.contactSuggestions.status} = 'pendente')::int`,
    })
    .from(schema.contactSuggestions)
    .where(sql`${schema.contactSuggestions.createdAt} > now() - interval '7 days'`);
  const [dups] = await tx
    .select({ total: sql<number>`count(*)::int`, ia: sql<number>`count(*) filter (where ${schema.duplicateReviews.source} = 'ia')::int` })
    .from(schema.duplicateReviews)
    .where(sql`${schema.duplicateReviews.createdAt} > now() - interval '7 days'`);
  const [timed] = await tx
    .select({
      agendadas: sql<number>`count(*) filter (where ${schema.messages.sendAfter} is not null)::int`,
      revertidas: sql<number>`count(*) filter (where ${schema.messages.meta} ? 'revertedReason')::int`,
    })
    .from(schema.messages)
    .where(sql`${schema.messages.direction} = 'out' and ${schema.messages.createdAt} > now() - interval '7 days'`);
  const [nextSent] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(sql`${schema.messages.direction} = 'out' and ${schema.messages.meta}->>'kind' = 'next_step' and ${schema.messages.createdAt} > now() - interval '7 days'`);

  // Regra pela frase: quem leu e quantas viraram regra
  const [ruleTexts] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      ia: sql<number>`count(*) filter (where ${schema.aiRuleDrafts.source} = 'ia')::int`,
      salvas: sql<number>`count(*) filter (where ${schema.aiRuleDrafts.ruleId} is not null)::int`,
      motivo: sql<string | null>`(array_agg(${schema.aiRuleDrafts.fallbackReason} order by ${schema.aiRuleDrafts.createdAt} desc) filter (where ${schema.aiRuleDrafts.fallbackReason} is not null))[1]`,
    })
    .from(schema.aiRuleDrafts)
    .where(sql`${schema.aiRuleDrafts.createdAt} > now() - interval '30 days'`);
  // Respostas sugeridas: pendentes, aceitas e descartadas
  const [qrs] = await tx
    .select({
      pendente: sql<number>`count(*) filter (where ${schema.quickReplySuggestions.status} = 'pendente')::int`,
      aceita: sql<number>`count(*) filter (where ${schema.quickReplySuggestions.status} = 'aceita')::int`,
      descartada: sql<number>`count(*) filter (where ${schema.quickReplySuggestions.status} = 'descartada')::int`,
    })
    .from(schema.quickReplySuggestions);
  // Auditoria: esta semana e a origem
  const [aud] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      ia: sql<number>`count(*) filter (where ${schema.serviceAudits.source} = 'ia')::int`,
      media: sql<number | null>`round(avg(${schema.serviceAudits.total})::numeric, 1)::float`,
    })
    .from(schema.serviceAudits)
    .where(sql`${schema.serviceAudits.createdAt} > now() - interval '7 days'`);

  const noKey = !aiConfigured();
  const d = drafts[0];
  const i = intents[0];
  const r = summaries[0];
  const g = schedules[0];
  const m = sentiments[0];
  const pr = promises[0];
  const join = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" ");

  return {
    ia_rascunho: {
      week: d?.total ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: por enquanto só sugestões por regras.",
        !!d?.total &&
          `Últimos 7 dias: ${d.total} rascunhos (${d.ia} da IA, ${d.total - d.ia} por regras). Usados como vieram: ${d.usado}; editados: ${d.editado}; descartados: ${d.descartado}.${d.latencia ? ` Tempo típico da IA: ${seconds(d.latencia)} s.` : ""}`,
      ]),
    },
    ia_intencao: {
      week: (i?.ia ?? 0) + (i?.regras ?? 0),
      note: join([
        noKey && "Sem a chave do Gemini no servidor: por enquanto só palavras-chave.",
        i &&
          i.ia + i.regras > 0 &&
          `Últimos 7 dias: ${i.ia + i.regras} mensagens revisadas; a IA decidiu ${i.ia} (corrigiu as palavras-chave em ${i.mudou}); ficaram as palavras-chave em ${i.regras}. A equipe corrigiu a IA ${i.corrigidas} ${i.corrigidas === 1 ? "vez" : "vezes"}.`,
      ]),
    },
    ia_agendar: {
      week: g?.total ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: por enquanto o pedido é lido pelas regras.",
        !!g?.total && `Últimos 7 dias: ${g.total} pedidos lidos (${g.ia} pela IA, ${g.total - g.ia} pelas regras). Viraram consulta: ${g.marcadas}, sendo ${g.sugerido} em um horário sugerido.`,
      ]),
    },
    ia_promessas: {
      week: pr?.tarefas ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: por enquanto as promessas são lidas pelas regras.",
        !!pr?.lidas && `Últimos 7 dias: ${pr.lidas} mensagens com jeito de promessa lidas (${pr.ia} pela IA); ${pr.tarefas} tarefas criadas; ${pr.desfeitas} marcadas como “não era promessa”.`,
      ]),
    },
    ia_risco: { week: 0, note: modelNote(reports.risco, "a fórmula de sempre") },
    ia_encaixe: { week: 0, note: modelNote(reports.encaixe, "a nota com pesos fixos") },
    ia_duracao: {
      week: measured?.n ?? 0,
      note: `${measured?.n ?? 0} atendimentos medidos (chegada e saída) nos últimos 6 meses. Os números por profissional e procedimento estão em Ajustes > Duração das consultas.`,
    },
    ia_resumo_dia: {
      week: 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: o resumo sai montado pelas regras.",
        brief && (brief.source === "ia" ? "Último resumo: redigido pela IA." : `Último resumo: pelas regras${brief.reason ? ` (${brief.reason})` : ""}.`),
      ]),
    },
    ia_sentimento: {
      week: (m?.ia ?? 0) + (m?.regras ?? 0),
      note: join([
        noKey && "Sem a chave do Gemini no servidor: por enquanto só palavras-chave e sinais.",
        !!m &&
          m.ia + m.regras > 0 &&
          `Últimos 7 dias: ${m.ia + m.regras} mensagens analisadas; a IA decidiu ${m.ia} (corrigiu as palavras-chave em ${m.mudou}). Avisos à gestão: ${m.avisos}. Correções da equipe: ${m.corrigidas}.`,
      ]),
    },
    ia_resumo: {
      week: r?.total ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: por enquanto só resumos por regras.",
        !!r?.total &&
          `Últimos 7 dias: ${r.total} resumos (${r.ia} da IA, ${r.total - r.ia} por regras). A equipe marcou “ajudou” em ${r.ajudou} e “não ajudou” em ${r.naoAjudou}.${r.latencia ? ` Tempo típico da IA: ${seconds(r.latencia)} s.` : ""}`,
      ]),
    },
    ia_proximo_passo: {
      week: nextSent?.n ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: o rascunho sai pronto pelas regras.",
        `Últimos 7 dias: ${nextSent?.n ?? 0} mensagens enviadas pelo “próximo passo”. O passo é sempre decidido pelas regras; a IA só escreve o texto.`,
      ]),
    },
    ia_motivo_perda: {
      week: jobs?.perda ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: os motivos saem pelas palavras-chave e pelo motivo digitado pela equipe.",
        !!jobs?.perda && `Últimos 7 dias: ${jobs.perda} perdas lidas (${jobs.perdaIa} pela IA, ${jobs.perda - jobs.perdaIa} pelas regras). O resumo agrupado fica no Funil da Jornada.`,
      ]),
    },
    ia_cadastro: {
      week: (sugs?.campoAplicada ?? 0) + (sugs?.campoDescartada ?? 0) + (sugs?.campoPendente ?? 0),
      note: join([
        noKey && "Sem a chave do Gemini no servidor: só e-mail, datas e convênios conhecidos pelas regras.",
        `Últimos 7 dias: ${jobs?.cadastro ?? 0} conversas lidas; sugestões aplicadas ${sugs?.campoAplicada ?? 0}, descartadas ${sugs?.campoDescartada ?? 0}, esperando ${sugs?.campoPendente ?? 0}.`,
      ]),
    },
    ia_duplicados: {
      week: dups?.total ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: a opinião vem das regras (apelidos e sinais iguais).",
        !!dups?.total && `Últimos 7 dias: ${dups.total} pares consultados (${dups.ia} com opinião da IA). Unificar continua manual.`,
      ]),
    },
    ia_etiquetas: {
      week: (sugs?.etqAplicada ?? 0) + (sugs?.etqDescartada ?? 0) + (sugs?.etqPendente ?? 0),
      note: `Últimos 7 dias: ${jobs?.etiquetas ?? 0} contatos analisados; etiquetas aplicadas ${sugs?.etqAplicada ?? 0}, descartadas ${sugs?.etqDescartada ?? 0}, esperando ${sugs?.etqPendente ?? 0}.`,
    },
    ia_retorno: {
      week: jobs?.retornoIa ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: vai o texto aprovado de sempre.",
        !!jobs?.retorno && `Últimos 7 dias: ${jobs.retorno} lembretes de retorno, ${jobs.retornoIa} personalizados pela IA.`,
        !!timed?.revertidas && `${timed.revertidas} voltaram ao texto aprovado porque a janela de 24h fechou antes do envio.`,
        jobs?.retornoMotivo && `Último plano B: ${jobs.retornoMotivo}.`,
      ]),
    },
    ia_melhor_horario: {
      week: timed?.agendadas ?? 0,
      note: `Últimos 7 dias: ${timed?.agendadas ?? 0} mensagens agendadas para o melhor horário do paciente. Calculado no servidor, sem IA.`,
    },
    ia_regra_texto: {
      week: ruleTexts?.total ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: as regras do Tropi entendem os pedidos mais comuns.",
        !!ruleTexts?.total && `Últimos 30 dias: ${ruleTexts.total} pedidos (${ruleTexts.ia} lidos pela IA); ${ruleTexts.salvas} viraram regra depois da revisão.`,
        ruleTexts?.motivo && `Último plano B: ${ruleTexts.motivo}.`,
      ]),
    },
    ia_respostas_sugeridas: {
      week: qrs?.pendente ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: a sugestão é a variação mais usada.",
        `Sugestões esperando revisão: ${qrs?.pendente ?? 0}; viraram atalho: ${qrs?.aceita ?? 0}; descartadas: ${qrs?.descartada ?? 0}.`,
      ]),
    },
    ia_auditoria: {
      week: aud?.total ?? 0,
      note: join([
        noKey && "Sem a chave do Gemini no servidor: as notas saem pelos sinais objetivos.",
        !!aud?.total && `Últimos 7 dias: ${aud.total} conversas avaliadas (${aud.ia} pela IA), nota média ${String(aud.media ?? "-").replace(".", ",")}.`,
      ]),
    },
  };
}
