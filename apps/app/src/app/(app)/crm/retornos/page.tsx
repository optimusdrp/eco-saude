import { CHANNEL_LABEL, CRM_FEATURES, daysBetween, formatDayShort, formatWhen } from "@ecosaude/core/crm";
import { asc, inArray, inSequence, schema, sql, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { ReturnsRadar } from "@/components/crm/returns/ReturnsRadar";
import { WINDOWS, type FollowUp, type RadarRow, type ReturnsData } from "@/components/crm/returns/types";
import { LockedFeature, PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { returnsDue } from "@/modules/crm/returns";

export const metadata: Metadata = { title: "Radar de retornos" };
export const dynamic = "force-dynamic";

/**
 * RADAR DE RETORNOS  (/crm/retornos?janela=14)
 *
 * Quem já deveria ter voltado (ou vence dentro da janela escolhida: 7, 14, 30
 * ou 60 dias) segundo os protocolos da clínica, sem consulta marcada.
 *
 * O servidor junta:
 *  - o radar (com o motivo de quem não pode receber mensagem: LGPD/SAIR);
 *  - quem JÁ foi lembrado nos últimos 30 dias e ainda não agendou (acompanhar:
 *    respondeu? hora de ligar?);
 *  - o resultado de cada protocolo (lembretes x quem voltou a agendar em 30 dias).
 * A parte interativa (ReturnsRadar) cuida de filtros, prévia da mensagem,
 * envio em lote e tarefas de ligação.
 */
export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ janela?: string }> }) {
  const ctx = await requireCrm("retornos.gerir");
  if (!ctx.has(CRM_FEATURES.campaigns)) {
    return (
      <>
        <PageHeader title="Radar de retornos" />
        <LockedFeature title="Radar de retornos">
          Descubra automaticamente quem já deveria ter voltado (revisões, retornos, tratamentos contínuos) e envie o lembrete em lote, só para quem autorizou.
        </LockedFeature>
      </>
    );
  }
  const sp = await searchParams;
  const windowDays = (WINDOWS as readonly number[]).includes(Number(sp.janela)) ? Number(sp.janela) : 14;
  const current = now();

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const due = await returnsDue(tx, windowDays);
    const [protocols, impact, perProtocol, followUps] = await inSequence([
      () => tx.select().from(schema.returnProtocols).orderBy(asc(schema.returnProtocols.daysAfter)),
      // Impacto geral: dos lembretes dos últimos 90 dias, quantos agendaram em até 30 dias depois
      () =>
        tx
          .execute<{ sent: number; booked: number }>(
            sql`select count(*)::int as sent,
                 count(*) filter (where exists (
                   select 1 from appointments a
                    where a.contact_id = e.contact_id
                      and a.created_at between e.created_at and e.created_at + interval '30 days'))::int as booked
            from crm_events e
           where e.type = 'return_reminder' and e.created_at > now() - interval '90 days'`,
          )
          .then((r) => r.rows[0] ?? { sent: 0, booked: 0 }),
      // O mesmo, por protocolo
      () =>
        tx
          .execute<{ pid: string; sent: number; booked: number }>(
            sql`select e.data->>'protocolId' as pid, count(*)::int as sent,
                 count(*) filter (where exists (
                   select 1 from appointments a
                    where a.contact_id = e.contact_id
                      and a.created_at between e.created_at and e.created_at + interval '30 days'))::int as booked
            from crm_events e
           where e.type = 'return_reminder' and e.created_at > now() - interval '90 days'
           group by 1`,
          )
          .then((r) => r.rows),
      // Lembrados nos últimos 30 dias que ainda não agendaram
      () =>
        tx
          .execute<{ contact_id: string; name: string; protocol: string; protocol_id: string; created_at: string; replied: boolean }>(
            sql`select distinct on (e.contact_id, e.data->>'protocolId')
                   e.contact_id, c.name, coalesce(e.data->>'protocolo', 'Retorno') as protocol, e.data->>'protocolId' as protocol_id,
                   e.created_at,
                   exists (select 1 from messages m join conversations cv on cv.id = m.conversation_id
                            where cv.contact_id = e.contact_id and m.direction = 'in' and m.created_at > e.created_at) as replied
              from crm_events e
              join contacts c on c.id = e.contact_id
             where e.type = 'return_reminder' and e.created_at > now() - interval '30 days'
               and not exists (select 1 from appointments a where a.contact_id = e.contact_id and a.created_at > e.created_at)
             order by e.contact_id, e.data->>'protocolId', e.created_at desc`,
          )
          .then((r) => r.rows),
    ]);
    // Conversa mais recente de cada pessoa (atalho "Conversar")
    const ids = [...new Set([...due.map((d) => d.contactId), ...followUps.map((f) => f.contact_id)])];
    const convs = ids.length
      ? await tx
          .select({ contactId: schema.conversations.contactId, id: schema.conversations.id, at: schema.conversations.lastMessageAt })
          .from(schema.conversations)
          .where(inArray(schema.conversations.contactId, ids))
      : [];
    return { due, protocols, impact, perProtocol, followUps, convs };
  });

  const convOf = (contactId: string) =>
    data.convs
      .filter((c) => c.contactId === contactId)
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))[0]?.id ?? null;

  const rows: RadarRow[] = data.due.map((d) => ({
    key: `${d.contactId}:${d.protocolId}`,
    contactId: d.contactId,
    protocolId: d.protocolId,
    name: d.name,
    protocol: d.protocolName,
    lastVisit: formatDayShort(d.lastVisit),
    due: formatDayShort(d.dueAt),
    overdueDays: d.overdueDays,
    channel: d.preferredChannel ? CHANNEL_LABEL[d.preferredChannel] : null,
    blocked: d.optedOut ? "Pediu para não receber mensagens (SAIR)." : !d.consent ? "Sem consentimento para lembretes: ligue ou peça autorização no próximo contato." : null,
    conversationId: convOf(d.contactId),
  }));

  const followUps: FollowUp[] = data.followUps
    .map((f) => {
      const at = new Date(f.created_at);
      return {
        key: `${f.contact_id}:${f.protocol_id}`,
        contactId: f.contact_id,
        name: f.name,
        protocol: f.protocol,
        remindedLabel: formatWhen(at, current),
        remindedDays: Math.max(0, daysBetween(at, current)),
        replied: f.replied,
        conversationId: convOf(f.contact_id),
      };
    })
    .sort((a, b) => b.remindedDays - a.remindedDays);

  const board: ReturnsData = {
    rows,
    followUps,
    protocols: data.protocols.map((p) => {
      const perf = data.perProtocol.find((x) => x.pid === p.id);
      return {
        id: p.id,
        name: p.name,
        serviceMatch: p.serviceMatch ?? "",
        daysAfter: p.daysAfter,
        message: p.message,
        active: p.active,
        dueNow: rows.filter((r) => r.protocolId === p.id).length,
        sent90: perf?.sent ?? 0,
        booked90: perf?.booked ?? 0,
      };
    }),
    impact: data.impact,
    windowDays,
    clinicName: ctx.user.clinicName,
    canSend: ctx.can("retornos.gerir"),
    canTask: ctx.can("tarefas.gerir"),
    canSchedule: ctx.can("agenda.editar"),
  };

  return <ReturnsRadar data={board} />;
}
