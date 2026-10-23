"use server";

import {
  ChannelError,
  connectEvolutionInstance,
  connectFacebookPage,
  connectInstagram,
  connectTelegramBot,
  createEvolutionInstance,
  deleteEvolutionInstance,
  disconnectTelegramBot,
  evolutionInstanceInfo,
  evolutionState,
  evolutionWebhookSecret,
  logoutEvolutionInstance,
  whatsAppNumberInfo,
  type EvolutionQr,
} from "@ecosaude/channels";
import { CHANNEL_CONNECTION_KINDS, CHANNELS, CONNECTION_KIND_LABEL, PACING_PRESET_IDS, PACING_PRESETS, pacingFrom, validatePacing, type Channel, type ConnectionKind, type PacingChoice, type PacingPresetId } from "@ecosaude/core/crm";
import { eq, schema } from "@ecosaude/db";
import { revalidatePath } from "next/cache";
import { authorizeCrm } from "@/lib/auth/dal";
import { appUrl } from "@/lib/email";
import { field, isUniqueViolation, NOT_ALLOWED, toActionError, type ActionState } from "@/lib/server";
import { connectionCredentials, encryptCredentials, evolutionConfig, evolutionWebhookUrl, newInstanceName, serverRequirements } from "../channels";
import { logEvent } from "../journey";
import { runCrm } from "../run";
import type { CrmContext } from "@/lib/auth/dal";

/**
 * CONECTAR OS CANAIS (Ajustes > Canais)
 *
 * WhatsApp, três caminhos:
 *  - QR code ou código de 8 caracteres (Evolution, WhatsApp do celular): a instância é criada
 *    na Evolution, a tela mostra o QR/código e acompanha até conectar. Só então o canal vira "real".
 *  - API oficial via Evolution: a Evolution recebe o token da Meta (o Tropi não guarda esse token).
 *  - API oficial direto na Meta: Phone number ID + token (guardado criptografado).
 * Messenger, Instagram e Telegram: a clínica cola o token; o Tropi confere com o provedor,
 * liga o webhook e guarda o token criptografado.
 *
 * Erros do provedor viram mensagem clara na tela (ChannelError); nada de stack trace.
 */

type Conn = typeof schema.channelConnections.$inferSelect;

async function currentConnection(ctx: CrmContext, channel: Channel): Promise<Conn | null> {
  return runCrm(ctx, async (tx) => (await tx.select().from(schema.channelConnections).where(eq(schema.channelConnections.channel, channel)))[0] ?? null);
}

/** Grava a conexão da clínica (insert ou update da linha do canal) */
async function saveConnection(ctx: CrmContext, channel: Channel, values: Partial<typeof schema.channelConnections.$inferInsert>, event?: { type: string; data?: Record<string, unknown> }) {
  await runCrm(ctx, async (tx, scope) => {
    const set = { ...values, updatedAt: new Date() };
    await tx
      .insert(schema.channelConnections)
      .values({ channel, ...values })
      .onConflictDoUpdate({ target: [schema.channelConnections.clinicId, schema.channelConnections.channel], set });
    if (event) await logEvent(tx, { actorId: scope.actorId, type: event.type, data: { canal: channel, ...event.data } });
  });
  revalidatePath("/configuracoes/canais");
  revalidatePath("/", "layout");
}

function failure(error: unknown): ActionState {
  if (error instanceof ChannelError) return { ok: false, message: error.message };
  if (isUniqueViolation(error)) return { ok: false, message: "Esta conta já está ligada a outra clínica no Tropi." };
  return toActionError(error);
}

function requireServer(kind: ConnectionKind): ActionState | null {
  const r = serverRequirements(kind);
  return r.ok ? null : { ok: false, message: `O servidor ainda não está pronto para "${CONNECTION_KIND_LABEL[kind]}". Falta configurar: ${r.missing.join(", ")}.` };
}

/** Só dígitos, com DDI. Aceita "(51) 99999-0000" e completa o 55. */
function phoneDigits(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const full = d.length === 10 || d.length === 11 ? `55${d}` : d;
  return full.length >= 12 && full.length <= 15 ? full : null;
}

/** "+55 51 99999-0000" a partir dos dígitos (outros países: só o +) */
function formatWaNumber(digits: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${digits}`;
}

export interface WhatsAppProgress {
  state: "desconectado" | "conectando" | "conectado" | "erro";
  qr?: string;
  pairingCode?: string;
  display?: string | null;
  error?: string | null;
}

/* --------------------------------- WhatsApp --------------------------------- */

/** Espera entre as perguntas pelo código de pareamento (menor nos testes) */
const PAIRING_RETRY_MS = Number(process.env.EVOLUTION_PAIRING_RETRY_MS ?? 1500);

export async function connectWhatsAppAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.canais");
  if (!ctx) return NOT_ALLOWED;
  const kind = field(form, "kind") as ConnectionKind;
  if (!CHANNEL_CONNECTION_KINDS.whatsapp.includes(kind)) return { ok: false, message: "Escolha como conectar o WhatsApp." };
  const blocked = requireServer(kind);
  if (blocked) return blocked;
  const current = await currentConnection(ctx, "whatsapp");
  const evo = evolutionConfig();

  try {
    /* ---------- WhatsApp do celular: QR code ou código de pareamento ---------- */
    if (kind === "evolution_qr") {
      const method = field(form, "method") === "codigo" ? "codigo" : "qr";
      const number = method === "codigo" ? phoneDigits(field(form, "phone")) : null;
      if (method === "codigo" && !number) return { ok: false, errors: { phone: "Informe o número do WhatsApp da clínica com DDD, ex.: (51) 99999-0000." } };
      let qr: EvolutionQr | null = null;
      let instance = current?.kind === "evolution_qr" ? current.externalAccountId : null;
      // Código de pareamento com uma tentativa ainda aberta (estado "connecting"): a Evolution
      // ignora o número nesse estado e devolve o QR antigo (instance.controller.ts, v2.3.7).
      // A instância nunca conectou nessa tentativa: apaga e cria outra já com o número.
      if (instance && method === "codigo" && (await evolutionState(evo!, instance).catch(() => null)) === "connecting") {
        await deleteEvolutionInstance(evo!, instance);
        instance = null;
      }
      if (instance) {
        try {
          const r = await connectEvolutionInstance(evo!, instance, number ?? undefined);
          if (r.state === "open") {
            await saveConnection(ctx, "whatsapp", { kind, connectionState: "conectado", mode: "real", stateAt: new Date(), lastError: null });
            return { ok: true, message: "O WhatsApp já está conectado.", data: { state: "conectado" } };
          }
          qr = r.qr;
        } catch (e) {
          // Instância apagada na Evolution: cria outra
          if (!(e instanceof ChannelError) || e.retryable || !/não encontrada/.test(e.message)) throw e;
          instance = null;
        }
      }
      if (!instance) {
        // Trocando de forma de conexão: remove a instância antiga (Cloud via Evolution)
        if (current?.kind === "evolution_cloud" && current.externalAccountId) await deleteEvolutionInstance(evo!, current.externalAccountId);
        instance = newInstanceName(ctx.user.clinicId);
        const created = await createEvolutionInstance(evo!, {
          instanceName: instance,
          type: "qrcode",
          ...(number ? { number } : {}),
          webhookUrl: evolutionWebhookUrl()!,
          webhookSecret: evolutionWebhookSecret(process.env.EVOLUTION_WEBHOOK_SECRET!, instance),
        });
        qr = created.qr;
      }
      // O código sai ~1 s depois do primeiro QR (requestPairingCode): pergunta de novo algumas vezes
      for (let i = 0; number && !qr?.pairingCode && i < 3; i++) {
        await new Promise((r) => setTimeout(r, PAIRING_RETRY_MS));
        qr = (await connectEvolutionInstance(evo!, instance, number)).qr ?? qr;
      }
      await saveConnection(
        ctx,
        "whatsapp",
        // Continua em simulação até o celular confirmar: nenhuma mensagem se perde no meio do caminho
        {
          kind,
          externalAccountId: instance,
          connectionState: "conectando",
          stateAt: new Date(),
          lastError: null,
          credentialsEnc: null,
          mode: current?.connectionState === "conectado" && current.kind === kind ? current.mode : "simulacao",
        },
        { type: "channel_connecting", data: { forma: method === "codigo" ? "código de pareamento" : "QR code" } },
      );
      const progress: WhatsAppProgress = {
        state: "conectando",
        ...(qr?.base64 && method === "qr" ? { qr: qr.base64 } : {}),
        ...(qr?.pairingCode && method === "codigo" ? { pairingCode: qr.pairingCode } : {}),
      };
      if (method === "codigo" && !progress.pairingCode) return { ok: false, message: "A Evolution não devolveu o código de pareamento. Confira o número ou tente pelo QR code." };
      return { ok: true, data: progress as unknown as Record<string, unknown> };
    }

    /* ------------------- API oficial (Cloud API) via Evolution ------------------ */
    if (kind === "evolution_cloud") {
      const token = field(form, "token").trim();
      const phoneNumberId = field(form, "phoneNumberId").replace(/\D/g, "");
      const businessId = field(form, "businessId").replace(/\D/g, "");
      const errors: Record<string, string> = {};
      if (token.length < 20) errors.token = "Cole o token permanente do usuário do sistema (Meta Business).";
      if (!phoneNumberId) errors.phoneNumberId = "Informe o Phone number ID.";
      if (!businessId) errors.businessId = "Informe o ID da conta do WhatsApp Business (WABA).";
      if (Object.keys(errors).length) return { ok: false, errors };
      if (current?.kind?.startsWith("evolution") && current.externalAccountId) await deleteEvolutionInstance(evo!, current.externalAccountId);
      const instance = newInstanceName(ctx.user.clinicId);
      await createEvolutionInstance(evo!, {
        instanceName: instance,
        type: "cloud",
        cloud: { token, phoneNumberId, businessId },
        webhookUrl: evolutionWebhookUrl()!,
        webhookSecret: evolutionWebhookSecret(process.env.EVOLUTION_WEBHOOK_SECRET!, instance),
      });
      const state = await evolutionState(evo!, instance).catch(() => "connecting" as const);
      // O token da Meta fica SÓ na Evolution (o Tropi não guarda)
      await saveConnection(
        ctx,
        "whatsapp",
        {
          kind,
          externalAccountId: instance,
          displayName: `API oficial (${phoneNumberId})`,
          connectionState: state === "open" ? "conectado" : "conectando",
          mode: state === "open" ? "real" : "simulacao",
          stateAt: new Date(),
          lastError: null,
          credentialsEnc: null,
        },
        { type: "channel_connected", data: { forma: "API oficial via Evolution" } },
      );
      return {
        ok: true,
        message: "API oficial ligada pela Evolution. Falta apontar o webhook do app da Meta para a Evolution (passo a passo abaixo).",
        data: { state: state === "open" ? "conectado" : "conectando" },
      };
    }

    /* ---------------------- API oficial direto na Meta ---------------------- */
    const phoneNumberId = field(form, "phoneNumberId").replace(/\D/g, "");
    const token = field(form, "token").trim();
    if (!phoneNumberId) return { ok: false, errors: { phoneNumberId: "Informe o Phone number ID." } };
    const creds = { ...connectionCredentials(null, "whatsapp"), phoneNumberId, ...(token ? { accessToken: token } : {}) };
    if (!creds.accessToken) return { ok: false, errors: { token: "Cole o token permanente (ou defina WHATSAPP_ACCESS_TOKEN no servidor)." } };
    const info = await whatsAppNumberInfo(creds);
    if (current?.kind?.startsWith("evolution") && current.externalAccountId && evo) await deleteEvolutionInstance(evo, current.externalAccountId);
    await saveConnection(
      ctx,
      "whatsapp",
      {
        kind,
        externalAccountId: phoneNumberId,
        displayName: info.displayPhone,
        connectionState: "conectado",
        mode: "real",
        stateAt: new Date(),
        lastError: null,
        credentialsEnc: token ? encryptCredentials({ accessToken: token }) : null,
      },
      { type: "channel_connected", data: { forma: "API oficial direto na Meta" } },
    );
    return { ok: true, message: `WhatsApp ${info.displayPhone} conectado pela API oficial.` };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Acompanha a conexão do WhatsApp do celular (a tela chama a cada poucos segundos).
 * `refresh`: pede um QR novo (o do WhatsApp expira em ~40 s).
 */
export async function whatsAppProgressAction(refresh = false, method: "qr" | "codigo" = "qr"): Promise<WhatsAppProgress> {
  const ctx = await authorizeCrm("config.canais");
  if (!ctx) return { state: "erro", error: "Sem permissão." };
  const conn = await currentConnection(ctx, "whatsapp");
  if (!conn?.kind?.startsWith("evolution") || !conn.externalAccountId) return { state: (conn?.connectionState as WhatsAppProgress["state"]) ?? "desconectado", display: conn?.displayName ?? null };
  const evo = evolutionConfig();
  if (!evo) return { state: "erro", error: "Evolution API não configurada no servidor." };
  try {
    const state = await evolutionState(evo, conn.externalAccountId);
    if (state === "open") {
      const info = await evolutionInstanceInfo(evo, conn.externalAccountId).catch(() => null);
      const display = info?.number ? `${formatWaNumber(info.number)}${info.profileName ? ` (${info.profileName})` : ""}` : conn.displayName;
      if (conn.connectionState !== "conectado" || conn.mode !== "real") {
        await saveConnection(
          ctx,
          "whatsapp",
          { connectionState: "conectado", mode: "real", stateAt: new Date(), lastError: null, displayName: display },
          { type: "channel_connected", data: { forma: CONNECTION_KIND_LABEL[conn.kind as ConnectionKind] } },
        );
      }
      return { state: "conectado", display };
    }
    if (conn.kind === "evolution_qr" && refresh) {
      const r = await connectEvolutionInstance(evo, conn.externalAccountId);
      return { state: r.state === "open" ? "conectado" : "conectando", ...(r.qr?.base64 ? { qr: r.qr.base64 } : {}) };
    }
    // Código de pareamento: a Evolution gera um código NOVO a cada QR (a cada ~20-40 s) e o
    // antigo deixa de valer. Com a tentativa aberta, o "connect" só devolve o código atual
    // (não reinicia nada); sem tentativa aberta, não chama (reiniciaria sem o número).
    if (conn.kind === "evolution_qr" && method === "codigo" && state === "connecting") {
      const r = await connectEvolutionInstance(evo, conn.externalAccountId);
      return { state: "conectando", display: conn.displayName, ...(r.qr?.pairingCode ? { pairingCode: r.qr.pairingCode } : {}) };
    }
    return { state: state === "connecting" ? "conectando" : "desconectado", display: conn.displayName, error: conn.lastError };
  } catch (error) {
    return { state: "erro", error: error instanceof ChannelError ? error.message : "Não foi possível consultar a Evolution." };
  }
}

/* ---------------------- Messenger, Instagram e Telegram ---------------------- */

export async function connectTokenChannelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.canais");
  if (!ctx) return NOT_ALLOWED;
  const channel = field(form, "channel") as Channel;
  const kind = field(form, "kind") as ConnectionKind;
  if (!CHANNELS.includes(channel) || channel === "whatsapp" || !CHANNEL_CONNECTION_KINDS[channel].includes(kind)) return { ok: false, message: "Escolha como conectar." };
  const token = field(form, "token").trim();
  if (token.length < 10) return { ok: false, errors: { token: channel === "telegram" ? "Cole o token que o @BotFather enviou." : "Cole o token de acesso." } };
  const blocked = requireServer(kind);
  if (blocked) return blocked;
  const base = { ...connectionCredentials(null, channel), kind };
  try {
    let account: string;
    let display: string;
    let stored: { accessToken?: string; botToken?: string };
    if (channel === "telegram") {
      const bot = await connectTelegramBot({ ...base, botToken: token }, appUrl()!, process.env.TELEGRAM_WEBHOOK_SECRET!);
      account = bot.username;
      display = `@${bot.username}`;
      stored = { botToken: token };
    } else if (channel === "facebook") {
      const page = await connectFacebookPage({ ...base, accessToken: token });
      account = page.pageId;
      display = page.name;
      stored = { accessToken: token };
    } else {
      const ig = await connectInstagram({ ...base, accessToken: token });
      account = ig.accountId;
      display = `@${ig.username}`;
      stored = { accessToken: token };
    }
    await saveConnection(
      ctx,
      channel,
      { kind, externalAccountId: account, displayName: display, credentialsEnc: encryptCredentials(stored), connectionState: "conectado", mode: "real", stateAt: new Date(), lastError: null },
      { type: "channel_connected", data: { forma: CONNECTION_KIND_LABEL[kind], conta: display } },
    );
    return { ok: true, message: `${display} conectado. As mensagens já chegam nas Conversas.` };
  } catch (error) {
    return failure(error);
  }
}

/* -------------------------------- Desconectar -------------------------------- */

/**
 * Volta o canal para a simulação.
 *  - WhatsApp do celular: sai da sessão (a instância fica, para conectar de novo rápido)
 *  - Cloud via Evolution: apaga a instância
 *  - Telegram: desliga o webhook do bot
 *  - Tokens guardados são apagados
 */
export async function disconnectChannelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.canais");
  if (!ctx) return NOT_ALLOWED;
  const channel = field(form, "channel") as Channel;
  if (!CHANNELS.includes(channel)) return { ok: false, message: "Canal inválido." };
  const conn = await currentConnection(ctx, channel);
  if (!conn) return { ok: true, message: "Nada para desconectar." };
  const evo = evolutionConfig();
  try {
    if (conn.kind === "evolution_qr" && conn.externalAccountId && evo) await logoutEvolutionInstance(evo, conn.externalAccountId);
    if (conn.kind === "evolution_cloud" && conn.externalAccountId && evo) await deleteEvolutionInstance(evo, conn.externalAccountId);
    if (conn.kind === "bot") await disconnectTelegramBot(connectionCredentials(conn, "telegram")).catch(() => undefined);
  } catch (error) {
    // Provedor fora do ar: desconecta no Tropi mesmo assim e avisa
    console.error("[desconectar canal]", error);
  }
  await saveConnection(
    ctx,
    channel,
    {
      mode: "simulacao",
      connectionState: "desconectado",
      stateAt: new Date(),
      credentialsEnc: null,
      lastError: null,
      // QR code: mantém a instância para reconectar; o resto libera a conta
      ...(conn.kind === "evolution_qr" ? {} : { externalAccountId: null }),
    },
    { type: "channel_disconnected", data: { manual: true } },
  );
  return { ok: true, message: "Canal desconectado. Ele volta a funcionar em simulação." };
}

/** Liga/desliga o canal sem desconectar (ex.: pausar o Instagram nas férias). */
export async function toggleChannelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.canais");
  if (!ctx) return NOT_ALLOWED;
  const channel = field(form, "channel") as Channel;
  if (!CHANNELS.includes(channel)) return { ok: false, message: "Canal inválido." };
  const active = field(form, "active") === "true";
  try {
    await runCrm(ctx, async (tx, scope) => {
      await tx
        .insert(schema.channelConnections)
        .values({ channel, active })
        .onConflictDoUpdate({ target: [schema.channelConnections.clinicId, schema.channelConnections.channel], set: { active, updatedAt: new Date() } });
      await logEvent(tx, { actorId: scope.actorId, type: "channel_updated", data: { canal: channel, ativo: active } });
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/configuracoes/canais");
  return { ok: true, message: active ? "Canal ativado." : "Canal pausado: não envia nem recebe até ativar de novo." };
}

/* ------------------------ Ritmo do WhatsApp do celular ----------------------- */

/**
 * Salva o ritmo de envio das mensagens automáticas (Ajustes > Canais > WhatsApp).
 * Sugestão pronta guarda só o nome (os números vêm do Tropi); "personalizado" guarda os números,
 * conferidos com as faixas de PACING_BOUNDS.
 */
export async function savePacingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.canais");
  if (!ctx) return NOT_ALLOWED;
  const preset = field(form, "preset") as PacingChoice;
  if (preset !== "personalizado" && !PACING_PRESET_IDS.includes(preset as PacingPresetId)) return { ok: false, message: "Escolha um ritmo." };
  let pacing: Record<string, unknown> = { preset };
  if (preset === "personalizado") {
    const limits = { minGapS: Number(field(form, "minGapS")), maxGapS: Number(field(form, "maxGapS")), perMinute: Number(field(form, "perMinute")), perHour: Number(field(form, "perHour")) };
    const errors = validatePacing(limits);
    if (errors.length) return { ok: false, message: `Confira: ${errors.join("; ")}.` };
    pacing = { preset, ...limits };
  }
  try {
    const current = await currentConnection(ctx, "whatsapp");
    if (current?.kind !== "evolution_qr") return { ok: false, message: "O ritmo vale só para o WhatsApp do celular (QR code ou código)." };
    const config = pacingFrom(pacing);
    await saveConnection(ctx, "whatsapp", { pacing }, { type: "pacing_updated", data: { ritmo: preset === "personalizado" ? "personalizado" : PACING_PRESETS[preset as PacingPresetId].label, por_hora: config.perHour } });
  } catch (error) {
    return failure(error);
  }
  return { ok: true, message: "Ritmo de envio salvo. Vale a partir da próxima mensagem automática." };
}
