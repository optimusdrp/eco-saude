import { timingSafeEqual } from "node:crypto";
import { withClinicTimeZone, withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { runServiceAudit } from "@/modules/crm/ai/audit";
import { runAiQueues } from "@/modules/crm/ai/queue";
import { processPendingAttachments, processStorageDeletions } from "@/modules/crm/files/attachments";
import { mineQuickReplies } from "@/modules/crm/ai/quick-replies";
import { automationSettings } from "@/modules/crm/automation-settings";
import { trainClinicModels } from "@/modules/crm/ml/models";
import { refreshForecast } from "@/modules/crm/ml/weather";
import { runDueAutomations } from "@/modules/crm/automations";
import { recalcReactivation } from "@/modules/crm/journey";
import { dispatchQueued } from "@/modules/crm/messaging";
import { expireOffers, runAutoConfirmations } from "@/modules/crm/scheduling";
import { runScheduledAutomations } from "@/modules/crm/scheduled-automations";
import { crmClinicIds, systemScope } from "@/modules/crm/system";
import { cleanupAuthRecords } from "@/lib/auth/recovery-core";

/**
 * ROTINA AGENDADA (Vercel Cron, ver vercel.json)
 *   - reenvia mensagens que ficaram na fila (erro temporário do provedor)
 *   - expira ofertas da lista de espera sem resposta
 *   - move para "Para reativar" quem passou muito tempo sem voltar
 *   - pede confirmação automática das consultas (Ajustes > Automações)
 *   - lembrete no dia, pós-consulta e aniversário (se ligados)
 *   - executa as regras da clínica cuja espera venceu (ex.: "2 dias depois")
 *   - (se ligados em Ajustes > IA) procura respostas repetidas, 1x por semana,
 *     e completa a amostra semanal da auditoria de atendimento, em lotes
 *
 * Protegida por CRON_SECRET: a Vercel envia "Authorization: Bearer <CRON_SECRET>".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const report: Record<string, Record<string, number> | { error: string }> = {};
  for (const clinicId of await crmClinicIds()) {
    // Todo o trabalho desta clínica roda no fuso DELA (lembrete "no dia", aniversário, treino...)
    await withClinicTimeZone(clinicId, async () => {
      try {
        const scope = await systemScope(clinicId);
        if (!scope) return;
        const counts = await withTenant(clinicId, async (tx) => {
          await expireOffers(tx);
          const reactivated = await recalcReactivation(tx);
          const auto = await runAutoConfirmations(tx, scope);
          const timed = await runScheduledAutomations(tx, scope);
          return { reactivated, confirmations: auto.sent, ...timed };
        });
        const rules = await runDueAutomations(scope, 200);
        // Modelos aprendidos (Ajustes > IA): previsão de chuva (a cada 6 h) e treino diário
        const ml = await withTenant(clinicId, (tx) => automationSettings(tx));
        const forecast = ml.ia_risco?.enabled && ml.ia_risco.usarChuva !== false ? await refreshForecast(clinicId).catch(() => false) : false;
        const trained = ml.ia_risco?.enabled || ml.ia_encaixe?.enabled ? await trainClinicModels(clinicId).catch((e) => (console.error("[treino]", e), null)) : null;
        // Intenções e sentimentos que a IA ainda não revisou (falha passageira ou "after" que não rodou)
        const { intents, sentiments, promises } = await runAiQueues(clinicId, 50);
        // Semanais da IA (cada uma confere se está ligada e se já rodou)
        const mined = await mineQuickReplies(clinicId).catch((e) => (console.error("[respostas sugeridas]", e), null));
        const audit = await runServiceAudit(clinicId).catch((e) => (console.error("[auditoria]", e), null));
        // Anexos que ainda não baixaram (provedor fora) e arquivos a remover (fichas apagadas)
        const files = await processPendingAttachments(clinicId, 50).catch((e) => (console.error("[anexos]", e), { ready: 0, failed: 0 }));
        const removed = await processStorageDeletions(clinicId).catch((e) => (console.error("[remoção de arquivos]", e), 0));
        // Envia tudo o que ficou na fila (confirmações, lembretes, mensagens das regras...)
        const { sent, failed } = await dispatchQueued(clinicId);
        report[clinicId] = {
          sent,
          failed,
          rules,
          intentsAi: intents.ai,
          intentsRules: intents.rules,
          sentimentsAi: sentiments.ai,
          sentimentAlerts: sentiments.alerts,
          promiseTasks: promises.tasks,
          forecast: forecast ? 1 : 0,
          trained: trained ? 1 : 0,
          replySuggestions: mined?.saved ?? 0,
          audited: audit?.audited ?? 0,
          attachmentsReady: files.ready,
          filesRemoved: removed,
          ...counts,
        };
      } catch (error) {
        // Uma clínica com problema não impede as outras
        console.error("[cron]", clinicId, error);
        report[clinicId] = { error: (error as Error).message };
      }
    });
  }
  // Limpeza da autenticação (limites de tentativa vencidos, links de recuperação antigos)
  const auth = await cleanupAuthRecords().catch((e) => (console.error("[limpeza de acesso]", e), null));
  return NextResponse.json({ ok: true, clinics: report, auth });
}
