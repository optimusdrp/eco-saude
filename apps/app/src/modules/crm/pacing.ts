import "server-only";
import { drainMinutes, nextGapMs, pacingCheck, pacingFrom, staleReason, STALE_PREFIX, type PacingBlock, type PacingConfig } from "@ecosaude/core/crm";
import { and, db, eq, schema, sql, type Tx } from "@ecosaude/db";

/**
 * RITMO DE ENVIO DO WHATSAPP DO CELULAR (servidor). Regras em @ecosaude/core/crm (pacing.ts).
 *
 * Como funciona, sem ninguém "dormir" esperando:
 *  1. O despacho normal (dispatchQueued) NÃO pega as automáticas do WhatsApp do celular.
 *  2. claimPacedWhatsApp tira da fila as que venceram, confere os limites por minuto e por hora
 *     e RESERVA a vez (pace_next_at = agora + intervalo sorteado) com um UPDATE condicional:
 *     só um despacho consegue a vez, mesmo com dois servidores ao mesmo tempo.
 *  3. Com a vez, pega UMA mensagem (quem está conversando agora primeiro, depois a mais antiga).
 *  4. O despachante do servidor (pacing-ticker.ts) chama o despacho a cada ~3 s para as
 *     clínicas cuja vez já chegou. A rotina de 10 minutos continua como reserva.
 */

/** Linha de channel_connections que o ritmo precisa */
export interface PacedConnection {
  id: string;
  kind: string | null;
  mode: string;
  active: boolean;
  connectionState: string;
  pacing: unknown;
  paceNextAt: Date | null;
}

/** Só o WhatsApp do celular (QR code/código pela Evolution), de verdade e conectado */
export function isPacedConnection(c: Pick<PacedConnection, "kind" | "mode" | "active" | "connectionState"> | null | undefined): boolean {
  return !!c && c.kind === "evolution_qr" && c.mode === "real" && c.active && c.connectionState === "conectado";
}

export async function whatsappConnection(tx: Tx): Promise<PacedConnection | null> {
  const [row] = await tx
    .select({
      id: schema.channelConnections.id,
      kind: schema.channelConnections.kind,
      mode: schema.channelConnections.mode,
      active: schema.channelConnections.active,
      connectionState: schema.channelConnections.connectionState,
      pacing: schema.channelConnections.pacing,
      paceNextAt: schema.channelConnections.paceNextAt,
    })
    .from(schema.channelConnections)
    .where(eq(schema.channelConnections.channel, "whatsapp"));
  return row ?? null;
}

/** Quantas saíram por este número no último minuto e na última hora (digitadas e automáticas) */
export async function sentCounts(tx: Tx): Promise<{ minute: number; hour: number }> {
  const r = await tx.execute<{ minute: number; hour: number }>(sql`
    select count(*) filter (where sent_at > now() - interval '1 minute')::int as minute, count(*)::int as hour
      from messages
     where channel = 'whatsapp' and direction = 'out' and sent_at > now() - interval '1 hour'
       and status in ('enviada', 'entregue', 'lida')`);
  return r.rows[0] ?? { minute: 0, hour: 0 };
}

/**
 * Automáticas que perderam o sentido na fila (consulta que já começou, oferta expirada):
 * não saem; ficam "falhou" com o motivo, para a tela de Canais e a conversa mostrarem.
 */
export async function expireStaleQueued(tx: Tx, now = new Date()): Promise<number> {
  const rows = await tx.execute<{ id: string; template_key: string | null; meta: unknown; starts_at: Date | null; appt_found: boolean; offer_open: boolean | null }>(sql`
    select m.id, m.template_key, m.meta, a.starts_at, (a.id is not null) as appt_found,
           case when o.id is null then null else (o.status = 'aberta' and o.expires_at > now()) end as offer_open
      from messages m
      left join appointments a on m.meta ? 'appointmentId' and a.id::text = m.meta->>'appointmentId'
      left join slot_offers o on m.meta ? 'offerId' and o.id::text = m.meta->>'offerId'
     where m.status = 'fila' and m.direction = 'out' and m.channel = 'whatsapp' and m.author_id is null
       and m.template_key in ('confirmacao', 'lembrete', 'oferta')`);
  let expired = 0;
  for (const r of rows.rows) {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const reason = staleReason(
      { templateKey: r.template_key, meta },
      {
        now,
        appointmentStartsAt: r.starts_at ? new Date(r.starts_at) : null,
        ...(typeof meta.appointmentId === "string" ? { appointmentExists: r.appt_found } : {}),
        offerOpen: r.offer_open,
      },
    );
    if (!reason) continue;
    const done = await tx
      .update(schema.messages)
      .set({ status: "falhou", error: `${STALE_PREFIX} (${reason}).` })
      .where(and(eq(schema.messages.id, r.id), eq(schema.messages.status, "fila")))
      .returning({ id: schema.messages.id });
    expired += done.length;
  }
  return expired;
}

export type ClaimedRow = {
  id: string;
  channel: "whatsapp";
  body: string;
  conversation_id: string;
  meta: Record<string, unknown> | null;
  template_key: string | null;
  send_after: Date | null;
};

/**
 * Pega a PRÓXIMA automática do WhatsApp do celular, se já for a vez (dentro da transação do
 * despacho). Devolve null quando não é a vez, bateu um limite ou não há nada na fila.
 */
export async function claimPacedWhatsApp(tx: Tx, conn: PacedConnection, now = new Date()): Promise<ClaimedRow | null> {
  await expireStaleQueued(tx, now);
  const [{ waiting } = { waiting: 0 }] = (
    await tx.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting from messages
       where status = 'fila' and direction = 'out' and channel = 'whatsapp' and author_id is null
         and (send_after is null or send_after <= now())`)
  ).rows;
  if (!waiting) return null;
  const config = pacingFrom(conn.pacing);
  const counts = await sentCounts(tx);
  if (!pacingCheck({ now, nextAt: conn.paceNextAt, sentLastMinute: counts.minute, sentLastHour: counts.hour, config }).ok) return null;
  // Reserva atômica da vez: só um despacho passa por aqui até o próximo intervalo
  const gap = nextGapMs(config);
  const reserved = await tx.execute(sql`
    update channel_connections set pace_next_at = now() + (${gap} * interval '1 millisecond')
     where id = ${conn.id} and (pace_next_at is null or pace_next_at <= now())
     returning id`);
  if (!reserved.rows.length) return null;
  // Quem está conversando agora (paciente escreveu nos últimos 30 min) passa na frente
  const one = await tx.execute<ClaimedRow>(sql`
    update messages m set status = 'enviada', sent_at = now()
     where m.id = (
       select m2.id from messages m2 join conversations c on c.id = m2.conversation_id
        where m2.status = 'fila' and m2.direction = 'out' and m2.channel = 'whatsapp' and m2.author_id is null
          and (m2.send_after is null or m2.send_after <= now())
        order by (c.last_inbound_at > now() - interval '30 minutes') desc nulls last, m2.created_at
        limit 1
        for update of m2 skip locked)
    returning m.id, m.channel, m.body, m.conversation_id, m.meta, m.template_key, m.send_after`);
  return one.rows[0] ?? null;
}

/* ----------------------------- Tela de Canais ----------------------------- */

export interface WhatsAppQueueStats {
  /** Todas as mensagens esperando para sair pelo WhatsApp */
  queued: number;
  /** Destas, as automáticas (as que esperam a vez) */
  queuedAutomatic: number;
  sentLastHour: number;
  /** Não enviadas por terem vencido na fila nas últimas 24 h */
  staleLastDay: number;
  /** Por que a próxima automática ainda não saiu (null = sai na próxima rodada) */
  blocked: PacingBlock | null;
  /** Previsão para a fila automática sair, em minutos */
  etaMinutes: number;
  config: PacingConfig;
}

export async function whatsappQueueStats(tx: Tx, now = new Date()): Promise<WhatsAppQueueStats> {
  const conn = await whatsappConnection(tx);
  const config = pacingFrom(conn?.pacing);
  const r = await tx.execute<{ queued: number; automatic: number; stale: number }>(sql`
    select count(*) filter (where status = 'fila')::int as queued,
           count(*) filter (where status = 'fila' and author_id is null)::int as automatic,
           count(*) filter (where status = 'falhou' and error like ${STALE_PREFIX + "%"} and created_at > now() - interval '24 hours')::int as stale
      from messages where channel = 'whatsapp' and direction = 'out'
       and (status = 'fila' or (status = 'falhou' and created_at > now() - interval '24 hours'))`);
  const { queued = 0, automatic = 0, stale = 0 } = r.rows[0] ?? {};
  const counts = await sentCounts(tx);
  const check = pacingCheck({ now, nextAt: conn?.paceNextAt ?? null, sentLastMinute: counts.minute, sentLastHour: counts.hour, config });
  return {
    queued,
    queuedAutomatic: automatic,
    sentLastHour: counts.hour,
    staleLastDay: stale,
    blocked: automatic && !check.ok ? check.reason : null,
    etaMinutes: drainMinutes({ queued: automatic, sentLastHour: counts.hour, config }),
    config,
  };
}

/* ------------------------- Despachante do servidor ------------------------- */

/**
 * Clínicas do WhatsApp do celular (conectado) com algo para mandar agora:
 *  - automática esperando e com a vez já liberada; ou
 *  - mensagem que ficou na fila por erro temporário ou desconexão: na hora, se foi segurada pela
 *    desconexão (sent_at vazio), ou 30 s depois da última tentativa (não martela a Evolution).
 * Consulta "de sistema" (fora do RLS, como as demais de system.ts): só devolve IDs.
 */
export async function pacedDueClinics(): Promise<string[]> {
  const r = await db.execute<{ clinic_id: string }>(sql`
    select distinct m.clinic_id
      from messages m
      join channel_connections c on c.clinic_id = m.clinic_id and c.channel = 'whatsapp'
     where m.status = 'fila' and m.direction = 'out' and m.channel = 'whatsapp'
       and (m.send_after is null or m.send_after <= now())
       and c.kind = 'evolution_qr' and c.mode = 'real' and c.active and c.connection_state = 'conectado'
       and (
         (m.author_id is null and (c.pace_next_at is null or c.pace_next_at <= now()))
         or (m.author_id is not null and (m.sent_at is null or m.sent_at < now() - interval '30 seconds'))
       )`);
  return r.rows.map((x) => x.clinic_id);
}

