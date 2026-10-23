import { EVOLUTION_HEADER, evolutionConnectionStatus, parseEvolutionWebhook, verifyEvolutionWebhook } from "@ecosaude/channels";
import { withTenant } from "@ecosaude/db";
import { after, NextResponse, type NextRequest } from "next/server";
import { runAiQueues } from "@/modules/crm/ai/queue";
import { runDueAutomations } from "@/modules/crm/automations";
import { processPendingAttachments } from "@/modules/crm/files/attachments";
import { captureEvolutionWebhook } from "@/modules/crm/evolution-capture";
import { ingestInbound, ingestPhoneEcho } from "@/modules/crm/ingest";
import { applyStatusUpdate, dispatchQueued } from "@/modules/crm/messaging";
import { clinicForAccount, clinicForMessage, systemScope, updateConnectionFromProvider } from "@/modules/crm/system";

/**
 * WEBHOOK DA EVOLUTION API (WhatsApp por QR code/código e Cloud API via Evolution)
 *   POST /api/webhooks/evolution
 *
 * 1. Confere o cabeçalho secreto DA INSTÂNCIA (a Evolution não assina o corpo).
 * 2. A instância diz de qual clínica é (channel_connections.external_account_id).
 * 3. Mensagem -> mesmo ingestInbound dos outros canais; enviada pelo celular da clínica ->
 *    ingestPhoneEcho (vira saída "enviada pelo celular"); status -> entrega/leitura;
 *    conexão -> estado na tela de Canais (e registro quando o celular desconecta).
 *
 * Repetições são seguras (ID externo único). Erro ao gravar: 500, e a Evolution tenta de novo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const parsed = parseEvolutionWebhook(body);
  if (!parsed.instance) return new NextResponse("Bad request", { status: 400 });
  if (!verifyEvolutionWebhook(req.headers.get(EVOLUTION_HEADER), process.env.EVOLUTION_WEBHOOK_SECRET ?? "", parsed.instance)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  // Piloto: grava o webhook real, sem dados pessoais, para virar fixture (EVOLUTION_CAPTURE_DIR)
  await captureEvolutionWebhook(body);

  // Estado da conexão (o celular conectou, caiu ou saiu do WhatsApp Web)
  if (parsed.connection) {
    const c = parsed.connection;
    const { state, error } = evolutionConnectionStatus(c);
    const updated = await updateConnectionFromProvider("whatsapp", parsed.instance, {
      state,
      ...(c.number ? { displayName: c.number.startsWith("55") && c.number.length >= 12 ? `+55 ${c.number.slice(2, 4)} ${c.number.slice(4, -4)}-${c.number.slice(-4)}` : `+${c.number}` } : {}),
      error,
    }).catch((e) => {
      console.error("[evolution conexão]", e);
      return null;
    });
    // Reconectou: manda na hora o que ficou na fila enquanto estava fora (sem esperar a rotina)
    if (updated?.changed && state === "conectado") after(() => dispatchQueued(updated.clinicId).then(() => undefined));
    return NextResponse.json({ ok: true });
  }

  const touched = new Set<string>();
  const touchedFiles = new Set<string>();
  try {
    for (const msg of parsed.messages) {
      const conn = await clinicForAccount("whatsapp", msg.accountId);
      // Instância desconhecida, canal desligado ou ainda não conectado: ignora sem erro
      if (!conn || !conn.active || conn.mode !== "real") continue;
      const scope = await systemScope(conn.clinicId);
      if (!scope) continue;
      await withTenant(scope.clinicId, (tx) => ingestInbound(tx, scope, msg));
      touched.add(scope.clinicId);
    }
    // Respostas da equipe direto no celular: entram em Conversas (sem automações nem IA)
    for (const msg of parsed.sentFromPhone) {
      const conn = await clinicForAccount("whatsapp", msg.accountId);
      if (!conn || !conn.active || conn.mode !== "real") continue;
      await withTenant(conn.clinicId, (tx) => ingestPhoneEcho(tx, msg));
      // Foto ou documento enviado pelo celular: baixa depois, como os recebidos
      if (msg.attachments?.length) touchedFiles.add(conn.clinicId);
    }
    for (const st of parsed.statuses) {
      const clinicId = await clinicForMessage("whatsapp", st.externalMessageId);
      if (!clinicId) continue;
      await withTenant(clinicId, (tx) => applyStatusUpdate(tx, "whatsapp", st.externalMessageId, st.status, st.error));
    }
  } catch (error) {
    console.error("[webhook evolution]", error);
    return new NextResponse("Erro ao processar", { status: 500 });
  }

  for (const clinicId of touched) {
    const scope = await systemScope(clinicId);
    if (scope) await runDueAutomations(scope).catch((e) => console.error("[webhook automações]", e));
    await dispatchQueued(clinicId).catch((e) => console.error("[webhook dispatch]", e));
    after(() => runAiQueues(clinicId).then(() => undefined));
    // Anexos: pedidos à Evolution DEPOIS de responder (o webhook não traz o arquivo)
    after(() => processPendingAttachments(clinicId).then(() => undefined));
  }
  for (const clinicId of touchedFiles) if (!touched.has(clinicId)) after(() => processPendingAttachments(clinicId).then(() => undefined));
  return NextResponse.json({ ok: true });
}
