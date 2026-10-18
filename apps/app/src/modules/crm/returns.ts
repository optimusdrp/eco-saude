import "server-only";
import { fillTemplate, type Channel } from "@ecosaude/core/crm";
import { sql, type Tx } from "@ecosaude/db";
import { logEvent } from "./journey";
import { bestChannel, ensureConversation, queueOutbound, templateVars } from "./messaging";
import type { CrmScope } from "./scope";
import { queueAiJob } from "./ai/jobs";
import { automationSettings } from "./automation-settings";
import { bestTimesFor, sendWindow } from "./ml/best-time";

/**
 * RADAR DE RETORNOS
 * Para cada protocolo ativo ("revisão em 180 dias", "retorno de 30 dias após
 * Consulta"), encontra quem já está na hora (ou atrasado) de voltar, sem
 * consulta marcada e sem lembrete recente. Tudo numa consulta SQL; o
 * isolamento por clínica é garantido pelo banco (RLS).
 */
export interface ReturnDue {
  contactId: string;
  name: string;
  preferredChannel: Channel | null;
  consent: boolean;
  optedOut: boolean;
  protocolId: string;
  protocolName: string;
  message: string;
  lastVisit: Date;
  dueAt: Date;
  overdueDays: number;
}

export async function returnsDue(tx: Tx, withinDays = 7): Promise<ReturnDue[]> {
  const rows = await tx.execute<{
    contact_id: string;
    name: string;
    preferred_channel: Channel | null;
    consent_marketing: boolean;
    opted_out_at: Date | null;
    protocol_id: string;
    protocol_name: string;
    message: string;
    last_visit: Date;
    due_at: Date;
  }>(sql`
    with last_visit as (
      select distinct on (a.contact_id, p.id)
             a.contact_id, p.id as protocol_id, p.name as protocol_name, p.message, p.days_after, a.starts_at as last_visit
        from return_protocols p
        join appointments a
          on a.status = 'compareceu'
         and (p.service_match is null or a.service ilike '%' || p.service_match || '%')
       where p.active
       order by a.contact_id, p.id, a.starts_at desc
    )
    select lv.contact_id, c.name, c.preferred_channel, c.consent_marketing, c.opted_out_at,
           lv.protocol_id, lv.protocol_name, lv.message, lv.last_visit,
           lv.last_visit + make_interval(days => lv.days_after) as due_at
      from last_visit lv
      join contacts c on c.id = lv.contact_id
     where c.anonymized_at is null -- LGPD: dados apagados a pedido do titular
       and lv.last_visit + make_interval(days => lv.days_after) <= now() + make_interval(days => ${withinDays})
       and c.stage <> 'perdido'
       and not exists (
         select 1 from appointments f
          where f.contact_id = lv.contact_id and f.starts_at > now() and f.status in ('agendado', 'confirmado'))
       and not exists (
         select 1 from crm_events e
          where e.contact_id = lv.contact_id and e.type = 'return_reminder'
            and e.data->>'protocolId' = lv.protocol_id::text
            and e.created_at > now() - interval '30 days')
     order by due_at`);

  const now = Date.now();
  return rows.rows.map((r) => {
    const dueAt = new Date(r.due_at);
    return {
      contactId: r.contact_id,
      name: r.name,
      preferredChannel: r.preferred_channel,
      consent: r.consent_marketing,
      optedOut: r.opted_out_at !== null,
      protocolId: r.protocol_id,
      protocolName: r.protocol_name,
      message: r.message,
      lastVisit: new Date(r.last_visit),
      dueAt,
      overdueDays: Math.floor((now - dueAt.getTime()) / 86_400_000),
    };
  });
}

/**
 * Envia o lembrete de retorno. Só para quem autorizou mensagens de
 * relacionamento (LGPD) e não pediu para sair.
 */
export async function sendReturnReminders(tx: Tx, scope: CrmScope, pairs: { contactId: string; protocolId: string }[]) {
  const due = await returnsDue(tx, 60); // mesma janela máxima da tela
  // Melhor horário de cada paciente (Ajustes > IA). Desligado = envia na hora
  const sendWin = await sendWindow(tx);
  const best = sendWin?.useInReturns
    ? await bestTimesFor(
        tx,
        pairs.map((p) => p.contactId),
      )
    : new Map();
  const personalize = !!(await automationSettings(tx)).ia_retorno?.enabled;
  let sent = 0;
  let scheduled = 0;
  const skipped: string[] = [];
  for (const pair of pairs) {
    const row = due.find((d) => d.contactId === pair.contactId && d.protocolId === pair.protocolId);
    if (!row) continue;
    if (row.optedOut || !row.consent) {
      skipped.push(`${row.name} (sem consentimento)`);
      continue;
    }
    const channel = await bestChannel(tx, row.contactId);
    if (!channel) {
      skipped.push(`${row.name} (sem canal)`);
      continue;
    }
    const conv = await ensureConversation(tx, row.contactId, channel);
    const body = fillTemplate(row.message, templateVars({ name: row.name }, scope.clinicName));
    // Com retorno personalizado: espera ao menos 3 min (tempo para a IA adaptar o texto).
    // Se a IA não terminar a tempo, sai o texto da clínica que já está na fila (plano B).
    const at: Date | null = best.get(row.contactId)?.at ?? (personalize ? new Date(Date.now() + 3 * 60_000) : null);
    const queued = await queueOutbound(tx, { conversation: conv, body, authorId: null, templateKey: "retorno", meta: { kind: "return", protocolId: row.protocolId }, sendAfter: at });
    if (queued && personalize) await queueAiJob(tx, "retorno", row.contactId, queued.id);
    if (at && at.getTime() - Date.now() > 10 * 60_000) scheduled++;
    await logEvent(tx, { contactId: row.contactId, actorId: scope.actorId, type: "return_reminder", data: { protocolId: row.protocolId, protocolo: row.protocolName } });
    sent++;
  }
  return { sent, skipped, scheduled };
}
