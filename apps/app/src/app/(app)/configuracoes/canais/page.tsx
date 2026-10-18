import { hasRealCredentials } from "@ecosaude/channels";
import { CHANNEL_LABEL, CHANNELS, type Channel } from "@ecosaude/core/crm";
import { schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { Badge, channelDot, PageHeader, Panel } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { ChannelForm } from "../forms";

export const metadata: Metadata = { title: "Canais" };
export const dynamic = "force-dynamic";

/**
 * O que falta para cada canal sair da simulação.
 * Os segredos (tokens) ficam em variáveis de ambiente do servidor (Vercel /
 * AWS Secrets Manager), nunca no banco nem na tela.
 */
const HOW_TO: Record<Channel, { env: string[]; steps: string[] }> = {
  whatsapp: {
    env: ["WHATSAPP_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN"],
    steps: [
      "Crie um app em developers.facebook.com (tipo Empresa) e adicione o produto WhatsApp.",
      "Gere um token de usuário do sistema com as permissões whatsapp_business_messaging e whatsapp_business_management.",
      "Copie o Phone number ID e informe aqui; o token vai para WHATSAPP_ACCESS_TOKEN no servidor.",
      "Em Webhooks, use a URL https://SEU-DOMINIO/api/webhooks/whatsapp, o token META_VERIFY_TOKEN e assine o campo messages.",
      "Cadastre os modelos (confirmação, retorno) no Gerenciador do WhatsApp e marque-os como \"modelo aprovado\" nas Respostas rápidas.",
    ],
  },
  instagram: {
    env: ["INSTAGRAM_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN"],
    steps: [
      "Conecte a conta profissional do Instagram a uma página do Facebook.",
      "No mesmo app da Meta, adicione Instagram (Messaging) e peça a permissão instagram_manage_messages.",
      "Informe aqui o ID da conta; o token vai para INSTAGRAM_ACCESS_TOKEN.",
      "Webhook: https://SEU-DOMINIO/api/webhooks/instagram, campo messages.",
    ],
  },
  facebook: {
    env: ["MESSENGER_PAGE_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN"],
    steps: [
      "No app da Meta, adicione Messenger e gere o token da página (pages_messaging).",
      "Informe aqui o ID da página; o token vai para MESSENGER_PAGE_TOKEN.",
      "Webhook: https://SEU-DOMINIO/api/webhooks/facebook, campo messages.",
    ],
  },
  telegram: {
    env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
    steps: [
      "Fale com o @BotFather no Telegram, crie o bot (/newbot) e copie o token para TELEGRAM_BOT_TOKEN.",
      "Informe aqui o usuário do bot (sem @).",
      "Registre o webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://SEU-DOMINIO/api/webhooks/telegram%3Fconta%3DUsuarioDoBot&secret_token=<TELEGRAM_WEBHOOK_SECRET> (o ?conta= diz ao EcoSaúde de qual clínica é o bot)",
    ],
  },
};

/** Canais de atendimento: modo simulação hoje, real quando houver credenciais. */
export default async function ChannelsPage() {
  const ctx = await requireCrm("config.canais");
  const rows = await withTenant(ctx.user.clinicId, (tx) => tx.select().from(schema.channelConnections));

  return (
    <>
      <PageHeader
        title="Canais"
        description="Em simulação, tudo funciona igual ao real (fila, janela de 24h, confirmações), mas as mensagens não saem: use o Simulador de canais para responder como paciente."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        {CHANNELS.map((c) => {
          const row = rows.find((r) => r.channel === c);
          const ready = hasRealCredentials(c);
          return (
            <Panel
              key={c}
              title={
                <span className="flex items-center gap-2">
                  <span className={cn("size-3 rounded-full", channelDot[c])} aria-hidden />
                  {CHANNEL_LABEL[c]}
                </span>
              }
              actions={
                <div className="flex flex-wrap gap-1">
                  {row?.mode === "real" ? <Badge tone="success">real</Badge> : <Badge tone="warning">simulação</Badge>}
                  {row && !row.active ? <Badge tone="alert">desativado</Badge> : null}
                </div>
              }
            >
              <ChannelForm
                initial={{
                  channel: c,
                  mode: row?.mode ?? "simulacao",
                  active: row?.active ?? true,
                  displayName: row?.displayName ?? "",
                  externalAccountId: row?.externalAccountId ?? "",
                  serverReady: ready,
                }}
              />
              <details className="mt-4 rounded-xl bg-fog px-3">
                <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Como ativar o modo real</summary>
                <ol className="list-decimal space-y-1.5 pb-3 pl-5 text-sm">
                  {HOW_TO[c].steps.map((s) => (
                    <li key={s} className="break-words">
                      {s}
                    </li>
                  ))}
                </ol>
                <p className="pb-3 text-xs text-ink-soft">
                  Variáveis no servidor:{" "}
                  {HOW_TO[c].env.map((e) => (
                    <code key={e} className="mr-1 rounded bg-paper px-1 ring-1 ring-line">
                      {e}
                    </code>
                  ))}
                  {ready ? <span className="font-semibold text-pep-ink"> (credencial encontrada)</span> : <span className="font-semibold text-alert"> (credencial ausente)</span>}
                </p>
              </details>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
