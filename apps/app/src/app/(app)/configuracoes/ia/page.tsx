import { AI_FEATURES, automationConfig } from "@ecosaude/core/crm";
import { inSequence, schema, withTenant } from "@ecosaude/db";
import { CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { aiStatus } from "@/modules/crm/ai/provider";
import { aiFeatureStats } from "@/modules/crm/ai/stats";
import { BuiltinCard, TestAi, type BuiltinView } from "../automacoes/AutomationsWorkspace";
import { TrainNow } from "./TrainNow";

/** Funcionalidades que aprendem com os dados da clínica, no servidor (sem Gemini) */
const LOCAL = ["ia_risco", "ia_encaixe", "ia_duracao", "ia_melhor_horario"];

export const metadata: Metadata = { title: "Inteligência artificial" };
export const dynamic = "force-dynamic";

/**
 * AJUSTES > INTELIGÊNCIA ARTIFICIAL (exige "config.ia")
 *
 * Um lugar só para TODAS as funcionalidades com IA. Regras da casa:
 *  - tudo vem DESLIGADO: a clínica escolhe o que quer usar (consentimento explícito);
 *  - cada funcionalidade mostra o que fez nos últimos 7 dias, para decidir com dados;
 *  - o painel ao lado diz se a IA está configurada no servidor, o que é enviado
 *    e as proteções que valem sempre (não dá para desligar).
 * Nova funcionalidade de IA = novo item do grupo "ia" no catálogo de automações
 * (packages/core/src/crm/automations.ts): ela aparece aqui sozinha.
 */
export default async function AiSettingsPage() {
  const ctx = await requireCrm("config.ia");
  const [settings, stats] = await withTenant(ctx.user.clinicId, (tx) =>
    inSequence([() => tx.select({ automations: schema.crmSettings.automations }).from(schema.crmSettings).limit(1), () => aiFeatureStats(tx)] as const),
  );
  const cfg = automationConfig(settings[0]?.automations);
  const status = aiStatus();

  const features: BuiltinView[] = AI_FEATURES.map((a) => ({
    key: a.key,
    group: a.group,
    title: a.title,
    what: a.what,
    locked: !!a.locked,
    inPlan: !a.feature || ctx.has(a.feature),
    config: cfg[a.key]!,
    params: a.params,
    templates: a.templates,
    href: a.href,
    where: a.where,
    week: stats[a.key]?.week ?? 0,
    note: stats[a.key]?.note || undefined,
  }));
  const on = features.filter((f) => f.config.enabled && f.inPlan).length;

  return (
    <>
      <PageHeader
        title="Inteligência artificial"
        description="Escolha quais funcionalidades com IA a clínica usa. Tudo começa desligado, a IA só sugere (quem decide e envia é sempre a equipe) e, se ela falhar, o Tropi segue pelas regras."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="ia-funcoes">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ia-funcoes" className="text-lg font-bold">
              Funcionalidades
            </h2>
            <span className="text-sm text-ink-soft">
              {on} de {features.length} {on === 1 ? "ligada" : "ligadas"}
            </span>
          </div>
          {/* Duas famílias: as que usam o Gemini e as que aprendem com os dados da clínica (sem enviar nada) */}
          <h3 className="mt-1 mb-2 text-sm font-bold text-ink-soft">Com o Gemini (texto e linguagem)</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {features
              .filter((b) => !LOCAL.includes(b.key))
              .map((b) => (
                <BuiltinCard key={b.key} b={b} canMessages={false} />
              ))}
          </ul>
          <h3 className="mt-6 mb-2 text-sm font-bold text-ink-soft">Aprendidas com os dados da clínica (rodam no servidor, nada é enviado)</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {features
              .filter((b) => LOCAL.includes(b.key))
              .map((b) => (
                <BuiltinCard key={b.key} b={b} canMessages={false} />
              ))}
          </ul>
        </section>

        <div className="space-y-5">
          <Panel title="Situação da IA">
            <dl className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                {status.configured ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden />}
                <div>
                  <dt className="font-semibold">{status.configured ? "Configurada no servidor" : status.keyWithoutPaidTier ? "Chave sem confirmação de conta paga" : "Sem chave no servidor"}</dt>
                  <dd className="text-ink-soft">
                    {status.configured
                      ? status.provider
                      : status.keyWithoutPaidTier
                        ? "A chave existe, mas falta GEMINI_PAID_TIER=sim no servidor. Isso confirma que o projeto do Google tem faturamento ativo (na conta gratuita, o Google pode usar os dados para treinar). Até lá, só as regras do Tropi."
                        : "Falta a GEMINI_API_KEY no servidor. Mesmo ligadas, as funcionalidades usam só as regras do Tropi até a chave ser configurada."}
                  </dd>
                </div>
              </div>
              {status.breakerOpen ? (
                <div className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden />
                  <div>
                    <dt className="font-semibold">Instável agora</dt>
                    <dd className="text-ink-soft">A IA falhou várias vezes seguidas. Por alguns minutos o Tropi usa o plano B direto, sem fazer ninguém esperar.</dd>
                  </div>
                </div>
              ) : null}
              <div>
                <dt className="font-semibold">Modelos</dt>
                <dd className="text-ink-soft">
                  Rascunho e resumo: {status.models.draft} (reserva {status.models.fallback}). Intenção, agendamento, sentimento e promessas: {status.models.classify}. Tempo limite: {status.timeoutS}{" "}
                  s por tentativa.
                </dd>
              </div>
            </dl>
            <TestAi />
          </Panel>

          <Panel title="Modelos aprendidos">
            <p className="text-sm text-ink-soft">
              Risco de falta e encaixe treinam sozinhos uma vez por dia com o histórico da clínica. Um modelo só substitui a regra antiga se acertar mais que ela num teste com as consultas mais
              recentes; o resultado aparece em cada cartão.
            </p>
            <TrainNow />
          </Panel>

          <Panel title="O que é enviado para a IA">
            <ul className="space-y-1.5 text-sm text-ink-soft">
              <li>
                Só o necessário para cada tarefa: as últimas mensagens da conversa, o primeiro nome, a etapa e as etiquetas do contato e a próxima consulta. O rascunho leva também os horários livres e
                as respostas rápidas; o agendamento, os nomes dos profissionais e dos serviços (sem o nome do paciente).
              </li>
              <li>CPF, cartão, e-mail e telefone são ocultados antes de sair do sistema.</li>
              <li>Nunca vai prontuário, diagnóstico, exame ou dado financeiro.</li>
              <li>
                Risco de falta, encaixe, duração real e melhor horário de envio não enviam nada: são calculados no servidor da clínica. O resumo da manhã envia só números e nomes de profissionais.
              </li>
              <li>Duplicados: a IA recebe só os dois nomes e sinais sim/não (mesmo e-mail, mesmo celular, mesmo nascimento), nunca o e-mail ou o número.</li>
              <li>Cadastro pela conversa: o e-mail é lido pelas regras no servidor; a IA só vê as mensagens com e-mail e telefone ocultados.</li>
              <li>Retorno personalizado: vai o primeiro nome, o nome do último procedimento (se a clínica permitir) e o texto aprovado. Nada do prontuário.</li>
              <li>Regra pela frase: vai só a frase do gestor, os nomes da equipe e as etiquetas. Nenhum dado de paciente.</li>
              <li>Respostas sugeridas: vão só textos da EQUIPE já padronizados (nome do paciente trocado por variável, dados pessoais ocultados).</li>
              <li>Auditoria: vão as falas sem o nome do paciente (vira [paciente]) e sem horários; o tempo de resposta é medido no servidor.</li>
              <li>Conversa com sinal de urgência não vai para a IA: rascunho, resumo e agendamento saem das regras do Tropi.</li>
              <li>Cada uso fica registrado (o que a IA sugeriu, o modelo, o tempo e o que a equipe fez).</li>
            </ul>
          </Panel>

          <Panel title="Proteções que valem sempre">
            <ul className="space-y-1.5 text-sm text-ink-soft">
              {[
                "Nada sai sozinho: a IA sugere e a equipe revisa e envia. Única exceção: o retorno personalizado, que só reescreve o texto aprovado dentro dos limites da clínica e só com a janela de 24h do WhatsApp aberta (fora dela vai o modelo aprovado).",
                "Nada muda a ficha sozinho: dados e etiquetas tirados da conversa aparecem como sugestão e só entram com “Aplicar”.",
                "Nada clínico: resposta com orientação de saúde é recusada; urgência segue as regras fixas do Tropi.",
                "Plano B: IA desligada, lenta ou instável, o Tropi continua pelas regras e palavras-chave.",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-xl bg-fog p-3 text-xs text-ink-soft">
              <p className="font-semibold text-ink">Antes de usar com pacientes reais</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Projeto do Google com faturamento ativo (nível pago) e GEMINI_PAID_TIER=sim no servidor.</li>
                <li>Registro de conversas (logs) do projeto desligado no Google AI Studio, ou com retenção mínima (7 dias).</li>
                <li>
                  A API processa fora do Brasil: o contrato com o Google precisa cobrir a transferência internacional (cláusulas-padrão da ANPD, Resolução 19/2024). Confira no termo de tratamento de
                  dados do Google com o seu jurídico.
                </li>
                <li>Informe na política de privacidade da clínica que um fornecedor de IA apoia o atendimento.</li>
              </ul>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
