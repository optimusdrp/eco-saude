import { parseWebhook, telegramWebhookSecret, verifyMetaSignature, verifyMetaSubscription, verifyTelegramSecret } from "@ecosaude/channels";
import { CHANNELS, type Channel } from "@ecosaude/core/crm";
import { withTenant } from "@ecosaude/db";
import { after, NextResponse, type NextRequest } from "next/server";
import { runAiQueues } from "@/modules/crm/ai/queue";
import { processPendingAttachments } from "@/modules/crm/files/attachments";
import { runDueAutomations } from "@/modules/crm/automations";
import { ingestInbound } from "@/modules/crm/ingest";
import { applyStatusUpdate, dispatchQueued } from "@/modules/crm/messaging";
import { clinicForAccount, clinicForMessage, systemScope } from "@/modules/crm/system";

/**
 * WEBHOOK DOS CANAIS (integração real)
 *   /api/webhooks/whatsapp | instagram | facebook | telegram
 *
 * Fluxo: confere a assinatura -> lê o JSON oficial (parseWebhook, o MESMO
 * leitor usado pelo simulador) -> descobre a clínica pela conta que recebeu
 * -> ingestInbound (mesmas automações da simulação) -> despacha respostas.
 *
 * Gravar a mesma mensagem duas vezes é impossível (ID externo único), então
 * reenvios do provedor são seguros: em caso de erro devolvemos 500 e a Meta
 * tenta de novo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isChannel = (c: string): c is Channel => (CHANNELS as readonly string[]).includes(c);

/** Verificação da assinatura do webhook pela Meta (feita uma vez, ao cadastrar a URL). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!isChannel(channel) || channel === "telegram") return new NextResponse("Not found", { status: 404 });
  const challenge = verifyMetaSubscription(req.nextUrl.searchParams, process.env.META_VERIFY_TOKEN ?? "");
  return challenge ? new NextResponse(challenge, { status: 200 }) : new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!isChannel(channel)) return new NextResponse("Not found", { status: 404 });

  // A assinatura é calculada sobre o corpo CRU: ler como texto antes de converter
  const raw = await req.text();
  let telegramAccount: string | null = null;
  if (channel === "telegram") {
    // O Telegram não diz qual bot recebeu: vai na URL cadastrada (?conta=UsuarioDoBot)
    telegramAccount = req.nextUrl.searchParams.get("conta");
    const server = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    // Segredo DO BOT (bots conectados pela tela) ou o segredo único antigo (bot configurado à mão)
    const ok = !!server && ((!!telegramAccount && verifyTelegramSecret(header, telegramWebhookSecret(server, telegramAccount))) || verifyTelegramSecret(header, server));
    if (!ok) return new NextResponse("Unauthorized", { status: 401 });
  } else {
    // Instagram com login do Instagram assina com o segredo do app do Instagram
    const signature = req.headers.get("x-hub-signature-256");
    const secrets = [process.env.META_APP_SECRET, channel === "instagram" ? process.env.INSTAGRAM_APP_SECRET : undefined].filter((s): s is string => !!s);
    if (!secrets.some((s) => verifyMetaSignature(raw, signature, s))) return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const { messages, statuses } = parseWebhook(channel, body, telegramAccount);
  const touched = new Set<string>();

  try {
    for (const msg of messages) {
      const conn = await clinicForAccount(channel, msg.accountId);
      // Conta desconhecida, canal desligado ou ainda em simulação: ignora (sem erro, para a Meta não reenviar)
      if (!conn || !conn.active || conn.mode !== "real") continue;
      const scope = await systemScope(conn.clinicId);
      if (!scope) continue;
      await withTenant(scope.clinicId, (tx) => ingestInbound(tx, scope, msg));
      touched.add(scope.clinicId);
    }
    for (const st of statuses) {
      const clinicId = await clinicForMessage(channel, st.externalMessageId);
      if (!clinicId) continue;
      await withTenant(clinicId, (tx) => applyStatusUpdate(tx, channel, st.externalMessageId, st.status, st.error));
    }
  } catch (error) {
    console.error("[webhook]", channel, error);
    return new NextResponse("Erro ao processar", { status: 500 });
  }

  // Respostas automáticas (confirmação, oferta de vaga...) saem depois de gravar
  for (const clinicId of touched) {
    // Regras da clínica "na hora" (ex.: pediu orçamento -> etiqueta e tarefa), depois o envio
    const scope = await systemScope(clinicId);
    if (scope) await runDueAutomations(scope).catch((e) => console.error("[webhook automações]", e));
    await dispatchQueued(clinicId).catch((e) => console.error("[webhook dispatch]", e));
    // Intenção com IA DEPOIS de responder à Meta (a resposta do webhook não espera a IA)
    after(() => runAiQueues(clinicId).then(() => undefined));
    // Anexos: baixados do provedor DEPOIS de responder (o link da Meta dura poucos minutos)
    after(() => processPendingAttachments(clinicId).then(() => undefined));
  }
  return NextResponse.json({ ok: true });
}
