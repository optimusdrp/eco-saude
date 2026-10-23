import { CHANNEL_CONNECTION_KINDS, CHANNEL_LABEL, CHANNELS, type ConnectionKind } from "@ecosaude/core/crm";
import { schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { channelDot, PageHeader, Panel } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { appUrl } from "@/lib/email";
import { serverRequirements } from "@/modules/crm/channels";
import { whatsappQueueStats } from "@/modules/crm/pacing";
import { StatusBadges, TokenChannelCard, WhatsAppCard, type ChannelView } from "./ChannelCards";

export const metadata: Metadata = { title: "Canais" };
export const dynamic = "force-dynamic";

/**
 * CANAIS DE ATENDIMENTO
 * Cada canal começa em simulação (o Simulador de canais responde como paciente).
 * Ao conectar de verdade, o Tropi confere com o provedor ANTES de virar "real":
 * nenhum canal fica "real" sem estar de fato conectado.
 */
export default async function ChannelsPage() {
  const ctx = await requireCrm("config.canais");
  const [rows, queue] = await withTenant(ctx.user.clinicId, async (tx) => [await tx.select().from(schema.channelConnections), await whatsappQueueStats(tx)] as const);
  const base = appUrl();
  const evolution = process.env.EVOLUTION_API_URL?.replace(/\/+$/, "");

  const views: ChannelView[] = CHANNELS.map((c) => {
    const row = rows.find((r) => r.channel === c);
    return {
      channel: c,
      kind: (row?.kind as ConnectionKind | null) ?? null,
      mode: row?.mode ?? "simulacao",
      state: (row?.connectionState as ChannelView["state"]) ?? "desconectado",
      active: row?.active ?? true,
      display: row?.displayName ?? null,
      lastError: row?.lastError ?? null,
      kinds: CHANNEL_CONNECTION_KINDS[c].map((k) => ({ kind: k, missing: serverRequirements(k).missing })),
      webhooks: { tropi: base ? `${base}/api/webhooks/${c}` : null, evolution: evolution ? `${evolution}/webhook/meta` : null },
      ...(c === "whatsapp" ? { queue } : {}),
    };
  });

  return (
    <>
      <PageHeader
        title="Canais"
        description="Conecte o WhatsApp, o Instagram, o Messenger e o Telegram da clínica. Enquanto um canal não está conectado, ele funciona em simulação: use o Simulador de canais para treinar a equipe."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        {views.map((v) => (
          <Panel
            key={v.channel}
            title={
              <span className="flex items-center gap-2">
                <span className={cn("size-3 rounded-full", channelDot[v.channel])} aria-hidden />
                {CHANNEL_LABEL[v.channel]}
              </span>
            }
            actions={<StatusBadges v={v} />}
          >
            {v.channel === "whatsapp" ? <WhatsAppCard v={v} /> : <TokenChannelCard v={v} />}
          </Panel>
        ))}
      </div>
    </>
  );
}
