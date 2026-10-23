"use client";

/**
 * CANAIS: assistente de conexão (roda no navegador)
 *
 * WhatsApp: escolhe a forma (celular por QR code/código, API oficial via Evolution ou direto
 * na Meta). No celular, a tela mostra o QR (ou o código de 8 caracteres) e consulta a cada
 * 3 segundos até o WhatsApp confirmar; o QR é renovado sozinho antes de expirar.
 * Messenger, Instagram e Telegram: cola o token; o Tropi confere e liga o webhook.
 *
 * Tokens: campo de senha, enviados uma vez ao servidor, guardados criptografados e nunca
 * devolvidos para a tela.
 */
import { CONNECTION_KIND_LABEL, type Channel, type ConnectionKind } from "@ecosaude/core/crm";
import { AlertTriangle, CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui";
import { Badge } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import type { ActionState } from "@/lib/server";
import type { WhatsAppQueueStats } from "@/modules/crm/pacing";
import { PacingForm, WhatsAppQueue } from "./PacingPanel";
import { connectTokenChannelAction, connectWhatsAppAction, disconnectChannelAction, toggleChannelAction, whatsAppProgressAction, type WhatsAppProgress } from "@/modules/crm/actions/channels";

export interface ChannelView {
  channel: Channel;
  kind: ConnectionKind | null;
  mode: "simulacao" | "real";
  state: "desconectado" | "conectando" | "conectado" | "erro";
  active: boolean;
  display: string | null;
  lastError: string | null;
  /** Formas de conexão e o que falta no servidor para cada uma */
  kinds: { kind: ConnectionKind; missing: string[] }[];
  /** Endereços que a clínica precisa colar no provedor */
  webhooks: { tropi: string | null; evolution: string | null };
  /** WhatsApp: fila e ritmo de envio */
  queue?: WhatsAppQueueStats;
}

/* ------------------------------- Passo a passo ------------------------------- */

const STEPS: Record<ConnectionKind, string[]> = {
  evolution_qr: [
    "No celular da clínica, abra o WhatsApp (o comum ou o Business).",
    "Toque em Mais opções (⋮) ou Configurações e depois em Aparelhos conectados > Conectar um aparelho.",
    'QR code: aponte a câmera para o código desta tela. Código: toque em "Conectar com número de telefone" e digite as 8 letras.',
    "Mantenha o celular com internet. Se ele ficar dias desligado, o WhatsApp desconecta e o Tropi avisa aqui.",
  ],
  evolution_cloud: [
    "No Meta Business, crie um app do tipo Empresa com o produto WhatsApp e registre o número da clínica.",
    "Crie um usuário do sistema com as permissões whatsapp_business_messaging e whatsapp_business_management e gere um token PERMANENTE.",
    "Copie o Phone number ID e o ID da conta do WhatsApp Business (WABA) em WhatsApp > Configuração da API.",
    "No app da Meta, em Webhooks, use a URL da Evolution indicada abaixo, o token de verificação WA_BUSINESS_TOKEN_WEBHOOK da Evolution e assine o campo messages.",
    "Cadastre os modelos (confirmação, lembrete) no Gerenciador do WhatsApp: fora da janela de 24h só eles saem.",
  ],
  meta_cloud: [
    "No Meta Business, crie o app (tipo Empresa) com o produto WhatsApp e registre o número.",
    "Gere um token PERMANENTE de usuário do sistema (whatsapp_business_messaging e whatsapp_business_management).",
    "Cole aqui o Phone number ID e o token. O Tropi confere o número com a Meta.",
    "No app da Meta, em Webhooks, use a URL do Tropi indicada abaixo, o META_VERIFY_TOKEN do servidor e assine o campo messages.",
  ],
  page: [
    "No app da Meta do Tropi, adicione o produto Messenger.",
    "Gere o token DA PÁGINA da clínica (permissões pages_messaging e pages_manage_metadata).",
    "Cole aqui: o Tropi confere a página e liga os eventos de mensagem dela ao app.",
    "Webhook do app (uma vez para todas as clínicas): a URL do Tropi abaixo, campo messages.",
  ],
  instagram_login: [
    "A conta do Instagram precisa ser profissional (Empresa ou Criador de conteúdo).",
    "No app da Meta, produto Instagram > API com login do Instagram: gere o token da conta (instagram_business_basic e instagram_business_manage_messages).",
    "No Instagram: Configurações > Mensagens e respostas > Ferramentas conectadas > Permitir acesso às mensagens.",
    "Cole o token aqui. Webhook do app: a URL do Tropi abaixo, campo messages.",
  ],
  facebook_login: [
    "Ligue a conta profissional do Instagram a uma página do Facebook (Central de Contas).",
    "Gere o token DA PÁGINA com instagram_basic, instagram_manage_messages e pages_manage_metadata.",
    "No Instagram: Configurações > Mensagens e respostas > Ferramentas conectadas > Permitir acesso às mensagens.",
    "Cole o token da página aqui: o Tropi acha a conta do Instagram ligada a ela.",
  ],
  bot: [
    "No Telegram, abra o @BotFather, envie /newbot e escolha o nome e o usuário do bot da clínica.",
    "Copie o token que o @BotFather enviar e cole aqui.",
    "Pronto: o Tropi confere o token e registra o webhook com um segredo só deste bot.",
    "Divulgue o link t.me/UsuarioDoBot (site, Instagram, assinatura de e-mail). Gratuito, sem janela de 24h.",
  ],
};

const STATE_BADGE: Record<ChannelView["state"], { tone: "success" | "warning" | "neutral" | "alert"; label: string }> = {
  conectado: { tone: "success", label: "conectado" },
  conectando: { tone: "warning", label: "conectando" },
  desconectado: { tone: "neutral", label: "simulação" },
  erro: { tone: "alert", label: "erro" },
};

function useRefreshOnOk(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
}

export function StatusBadges({ v }: { v: ChannelView }) {
  const b = STATE_BADGE[v.state];
  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone={b.tone}>{v.state === "desconectado" && v.mode === "real" ? "desconectado" : b.label}</Badge>
      {!v.active ? <Badge tone="alert">pausado</Badge> : null}
    </div>
  );
}

function Steps({ kind, webhooks }: { kind: ConnectionKind; webhooks: ChannelView["webhooks"] }) {
  const url = kind === "evolution_cloud" ? webhooks.evolution : kind === "evolution_qr" || kind === "bot" ? null : webhooks.tropi;
  return (
    <details className="rounded-xl bg-fog px-3" open={kind === "evolution_qr"}>
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Passo a passo</summary>
      <ol className="list-decimal space-y-1.5 pb-3 pl-5 text-sm">
        {STEPS[kind].map((s) => (
          <li key={s} className="break-words">
            {s}
          </li>
        ))}
      </ol>
      {url ? (
        <p className="pb-3 text-xs break-all text-ink-soft">
          URL do webhook: <code className="rounded bg-paper px-1 ring-1 ring-line">{url}</code>
        </p>
      ) : null}
    </details>
  );
}

function MissingServer({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <p className="rounded-xl bg-erp-tint px-3 py-2 text-sm text-erp-ink">
      O servidor ainda não está pronto para esta forma. Falta configurar:{" "}
      {missing.map((m) => (
        <code key={m} className="mr-1 rounded bg-paper/70 px-1">
          {m}
        </code>
      ))}
    </p>
  );
}

/** Ações de quem já está conectado: pausar e desconectar */
function ConnectedActions({ v, pairing = false }: { v: ChannelView; pairing?: boolean }) {
  const [dState, disconnect] = useActionState(disconnectChannelAction, {});
  const [tState, toggle] = useActionState(toggleChannelAction, {});
  useRefreshOnOk(dState);
  useRefreshOnOk(tState);
  return (
    <div className="space-y-2">
      <FormMessage state={dState.message ? dState : tState} />
      <div className="flex flex-wrap gap-2">
        {pairing ? null : (
          <form action={toggle}>
            <input type="hidden" name="channel" value={v.channel} />
            <input type="hidden" name="active" value={v.active ? "false" : "true"} />
            <SubmitButton variant="secondary" pendingText="Salvando...">
              {v.active ? "Pausar canal" : "Ativar canal"}
            </SubmitButton>
          </form>
        )}
        <form
          action={disconnect}
          onSubmit={(e) => {
            if (!pairing && !window.confirm("Desconectar? O canal volta para a simulação e para de enviar e receber de verdade.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="channel" value={v.channel} />
          <SubmitButton variant="danger" pendingText={pairing ? "Cancelando..." : "Desconectando..."}>
            {pairing ? "Cancelar conexão" : "Desconectar"}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

function KindPicker({ v, value, onChange }: { v: ChannelView; value: ConnectionKind; onChange: (k: ConnectionKind) => void }) {
  if (v.kinds.length < 2) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-semibold">Como conectar</legend>
      {v.kinds.map(({ kind }) => (
        <label
          key={kind}
          className={cn("flex min-h-11 cursor-pointer items-start gap-2 rounded-xl px-3 py-2 ring-1", value === kind ? "bg-crm-tint ring-crm" : "bg-paper ring-line hover:ring-ink/30")}
        >
          <input type="radio" name={`kind-${v.channel}`} value={kind} checked={value === kind} onChange={() => onChange(kind)} className="mt-1 accent-crm" />
          <span className="text-sm">
            <span className="font-semibold">{CONNECTION_KIND_LABEL[kind]}</span>
            {kind === "evolution_qr" ? <span className="block text-ink-soft">Rápido e sem burocracia. Não oficial: veja o aviso.</span> : null}
            {kind === "evolution_cloud" ? <span className="block text-ink-soft">Oficial, exige conta Meta Business verificada. A Evolution centraliza.</span> : null}
            {kind === "meta_cloud" ? <span className="block text-ink-soft">Oficial, sem servidor intermediário.</span> : null}
            {kind === "instagram_login" ? <span className="block text-ink-soft">Mais simples: não precisa de página do Facebook.</span> : null}
            {kind === "facebook_login" ? <span className="block text-ink-soft">Para quem já tem a página ligada ao Instagram.</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/* --------------------------------- WhatsApp ---------------------------------- */

export function WhatsAppCard({ v }: { v: ChannelView }) {
  const [kind, setKind] = useState<ConnectionKind>(v.kind ?? "evolution_qr");
  const [method, setMethod] = useState<"qr" | "codigo">("qr");
  const [state, action] = useActionState(connectWhatsAppAction, {});
  const missing = v.kinds.find((k) => k.kind === kind)?.missing ?? [];
  const progress = state.ok && state.data && "state" in state.data ? (state.data as unknown as WhatsAppProgress) : null;
  const pairing = progress?.state === "conectando" && (progress.qr || progress.pairingCode) ? progress : null;
  useRefreshOnOk(pairing ? {} : state);

  if (v.state === "conectado" && !pairing) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-5 text-ok" aria-hidden />
          <span>
            <b>{v.display ?? "WhatsApp conectado"}</b>
            <span className="block text-ink-soft">{v.kind ? CONNECTION_KIND_LABEL[v.kind] : ""}</span>
          </span>
        </p>
        {v.kind === "evolution_qr" ? <QrRiskNote compact /> : null}
        {v.queue ? <WhatsAppQueue q={v.queue} paced={v.kind === "evolution_qr" && v.mode === "real"} /> : null}
        {v.queue && v.kind === "evolution_qr" ? <PacingForm config={v.queue.config} /> : null}
        <ConnectedActions v={v} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {v.state === "desconectado" && v.lastError ? (
        <p role="alert" className="flex gap-2 rounded-xl bg-alert-tint px-3 py-2 text-sm text-alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {v.lastError}
        </p>
      ) : null}
      {/* Desconectado com mensagens esperando: mostra quantas saem quando reconectar */}
      {v.queue && v.queue.queued > 0 && v.mode === "real" ? <WhatsAppQueue q={v.queue} paced={false} /> : null}
      {pairing ? (
        <PairingPanel initial={pairing} method={method} />
      ) : (
        <>
          <KindPicker v={v} value={kind} onChange={setKind} />
          <MissingServer missing={missing} />
          <form action={action} className="space-y-3" noValidate>
            <input type="hidden" name="kind" value={kind} />
            <FormMessage state={state.ok ? {} : state} />
            {kind === "evolution_qr" ? (
              <>
                <QrRiskNote />
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de parear">
                  {(["qr", "codigo"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={method === m}
                      onClick={() => setMethod(m)}
                      className={cn(
                        "flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold ring-1",
                        method === m ? "bg-crm-tint text-crm ring-crm" : "bg-paper ring-line",
                      )}
                    >
                      {m === "qr" ? <QrCode className="size-4" aria-hidden /> : <Smartphone className="size-4" aria-hidden />}
                      {m === "qr" ? "QR code" : "Código no celular"}
                    </button>
                  ))}
                </div>
                <input type="hidden" name="method" value={method} />
                {method === "codigo" ? (
                  <Field
                    label="Número do WhatsApp da clínica"
                    name="phone"
                    id="wa-phone"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="(51) 99999-0000"
                    hint="O mesmo número do celular que vai receber o código."
                    error={state.errors?.phone}
                  />
                ) : null}
              </>
            ) : null}
            {kind === "evolution_cloud" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone number ID" name="phoneNumberId" id="wa-pnid" inputMode="numeric" error={state.errors?.phoneNumberId} />
                <Field label="ID da conta do WhatsApp Business (WABA)" name="businessId" id="wa-waba" inputMode="numeric" error={state.errors?.businessId} />
                <Field
                  label="Token permanente da Meta"
                  name="token"
                  id="wa-token"
                  type="password"
                  autoComplete="off"
                  className="sm:col-span-2"
                  hint="Vai direto para a Evolution: o Tropi não guarda este token."
                  error={state.errors?.token}
                />
              </div>
            ) : null}
            {kind === "meta_cloud" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone number ID" name="phoneNumberId" id="wa-pnid2" inputMode="numeric" error={state.errors?.phoneNumberId} />
                <Field
                  label="Token permanente da Meta"
                  name="token"
                  id="wa-token2"
                  type="password"
                  autoComplete="off"
                  hint="Guardado criptografado. Vazio = usa o do servidor."
                  error={state.errors?.token}
                />
              </div>
            ) : null}
            <SubmitButton variant="sun" disabled={missing.length > 0} pendingText="Conectando...">
              {kind === "evolution_qr" ? (method === "qr" ? "Gerar QR code" : "Gerar código") : "Conectar WhatsApp"}
            </SubmitButton>
          </form>
          <Steps kind={kind} webhooks={v.webhooks} />
        </>
      )}
      {v.state !== "desconectado" || v.mode === "real" || pairing ? <ConnectedActions v={v} pairing={!!pairing || v.state === "conectando"} /> : null}
    </div>
  );
}

function QrRiskNote({ compact = false }: { compact?: boolean }) {
  return (
    <p className="flex gap-2 rounded-xl bg-erp-tint px-3 py-2 text-sm text-erp-ink">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <b>Conexão não oficial.</b>{" "}
        {compact
          ? "Use só para responder pacientes; mensagens em massa podem bloquear o número."
          : "Funciona como o WhatsApp Web: o número pode ser bloqueado pela Meta se mandar mensagens para quem não falou antes. O Tropi segue a regra de 24h para reduzir o risco. Para volume ou campanhas, use a API oficial."}
      </span>
    </p>
  );
}

/** QR code/código na tela + acompanhamento até o celular confirmar */
function PairingPanel({ initial, method }: { initial: WhatsAppProgress; method: "qr" | "codigo" }) {
  const router = useRouter();
  const [p, setP] = useState<WhatsAppProgress>(initial);
  const [pending, start] = useTransition();
  const ticks = useRef(0);

  useEffect(() => {
    // Consulta a cada 3 s; renova o QR a cada ~30 s (o do WhatsApp expira em ~40 s)
    const timer = setInterval(() => {
      ticks.current += 1;
      const refresh = method === "qr" && ticks.current % 10 === 0;
      whatsAppProgressAction(refresh, method)
        .then((r) => {
          // O código de pareamento muda junto com o QR: mostra sempre o mais recente
          setP((old) => ({ ...old, ...r, qr: r.qr ?? old.qr, pairingCode: r.pairingCode ?? old.pairingCode }));
          if (r.state === "conectado") {
            clearInterval(timer);
            router.refresh();
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [method, router]);

  if (p.state === "conectado") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl bg-ok-tint px-3 py-3 text-sm font-semibold text-ok-ink">
        <CheckCircle2 className="size-5" aria-hidden /> WhatsApp conectado{p.display ? `: ${p.display}` : ""}. As mensagens já chegam nas Conversas.
      </p>
    );
  }
  // A Evolution desistiu (QR/código expirou sem leitura) ou o celular recusou: não fica "esperando" à toa
  if (p.state === "desconectado" && p.error) {
    return (
      <div className="space-y-3">
        <p role="alert" className="flex gap-2 rounded-xl bg-alert-tint px-3 py-2 text-sm text-alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {p.error}
        </p>
        <button type="button" onClick={() => window.location.reload()} className={buttonStyles("secondary", "text-sm")}>
          <RefreshCw className="size-4" aria-hidden /> Começar de novo
        </button>
      </div>
    );
  }
  const code = p.pairingCode ? `${p.pairingCode.slice(0, 4)}-${p.pairingCode.slice(4)}` : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-fog p-4 text-center">
        {method === "qr" && p.qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagem em data URL gerada pela Evolution
          <img src={p.qr} alt="QR code para conectar o WhatsApp da clínica" className="size-64 max-w-full rounded-xl bg-white p-2 ring-1 ring-line" />
        ) : null}
        {method === "codigo" && code ? (
          <p className="font-display text-4xl font-extrabold tracking-[0.15em] tabular" aria-label={`Código: ${code.split("").join(" ")}`}>
            {code}
          </p>
        ) : null}
        <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {method === "qr" ? "Aponte a câmera do WhatsApp para o código. Esperando o celular..." : "No celular: Aparelhos conectados > Conectar com número de telefone. Esperando..."}
        </p>
        {p.error ? <p className="text-sm text-alert">{p.error}</p> : null}
        {method === "qr" ? (
          <button type="button" disabled={pending} onClick={() => start(async () => setP(await whatsAppProgressAction(true)))} className={buttonStyles("ghost", "text-sm")}>
            <RefreshCw className={cn("size-4", pending && "animate-spin")} aria-hidden /> Gerar outro QR code
          </button>
        ) : null}
      </div>
      <Steps kind="evolution_qr" webhooks={{ tropi: null, evolution: null }} />
    </div>
  );
}

/* ----------------------- Messenger, Instagram e Telegram ---------------------- */

export function TokenChannelCard({ v }: { v: ChannelView }) {
  const [kind, setKind] = useState<ConnectionKind>(v.kind ?? v.kinds[0]!.kind);
  const [state, action] = useActionState(connectTokenChannelAction, {});
  useRefreshOnOk(state);
  const missing = v.kinds.find((k) => k.kind === kind)?.missing ?? [];

  if (v.state === "conectado") {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-5 text-ok" aria-hidden />
          <span>
            <b>{v.display ?? "Conectado"}</b>
            <span className="block text-ink-soft">{v.kind ? CONNECTION_KIND_LABEL[v.kind] : ""}</span>
          </span>
        </p>
        <ConnectedActions v={v} />
      </div>
    );
  }
  const tokenLabel = v.channel === "telegram" ? "Token do bot (@BotFather)" : kind === "instagram_login" ? "Token do Instagram" : "Token da página do Facebook";
  return (
    <div className="space-y-4">
      <KindPicker v={v} value={kind} onChange={setKind} />
      <MissingServer missing={missing} />
      <form action={action} className="space-y-3" noValidate>
        <input type="hidden" name="channel" value={v.channel} />
        <input type="hidden" name="kind" value={kind} />
        <FormMessage state={state} />
        <Field label={tokenLabel} name="token" id={`tok-${v.channel}`} type="password" autoComplete="off" hint="Guardado criptografado; nunca aparece de novo na tela." error={state.errors?.token} />
        <SubmitButton variant="secondary" disabled={missing.length > 0} pendingText="Conferindo...">
          Conectar {v.channel === "telegram" ? "bot" : v.channel === "facebook" ? "página" : "Instagram"}
        </SubmitButton>
      </form>
      <Steps kind={kind} webhooks={v.webhooks} />
    </div>
  );
}
