import "server-only";
import { CRM_FEATURES, todayIso, utcToZoned } from "@ecosaude/core/crm";
import { and, eq, gt, inArray, isNull, lte, schema, sql, type Tx } from "@ecosaude/db";
import { automationSettings, sendAutomated } from "./automation-settings";
import { logEvent } from "./journey";
import { templateVars } from "./messaging";
import type { CrmScope } from "./scope";

/**
 * AUTOMAÇÕES COM HORA MARCADA (rodam na rotina agendada, a cada 10 min)
 *  - Lembrete no dia: N horas antes da consulta de hoje
 *  - Pós-consulta: N horas depois de "Compareceu"
 *  - Aniversário: no dia, a partir da hora escolhida, uma vez por ano
 * Cada uma marca o que já enviou: rodar duas vezes não repete mensagem.
 */
export async function runScheduledAutomations(tx: Tx, scope: CrmScope, now = new Date()): Promise<{ reminders: number; postVisits: number; birthdays: number }> {
  const cfg = await automationSettings(tx);
  const out = { reminders: 0, postVisits: 0, birthdays: 0 };
  const today = todayIso(now);

  /* Lembrete no dia */
  const rem = cfg.lembrete_dia;
  if (rem?.enabled && scope.has(CRM_FEATURES.confirmations)) {
    const hours = Number(rem.horasAntes) || 3;
    const due = await tx.query.appointments.findMany({
      where: and(
        isNull(schema.appointments.reminderSentAt),
        inArray(schema.appointments.status, rem.soConfirmadas ? ["confirmado"] : ["agendado", "confirmado"]),
        gt(schema.appointments.startsAt, now),
        lte(schema.appointments.startsAt, new Date(now.getTime() + hours * 3_600_000)),
      ),
      with: { contact: true, professional: { columns: { name: true } } },
      limit: 100,
    });
    for (const a of due) {
      // "No dia": consulta de amanhã cedo não recebe lembrete hoje à noite
      if (utcToZoned(a.startsAt).date !== today) continue;
      const sent = await sendAutomated(tx, { contactId: a.contactId, key: "lembrete", vars: templateVars(a.contact, scope.clinicName, { startsAt: a.startsAt, professionalName: a.professional.name }), meta: { appointmentId: a.id } });
      await tx.update(schema.appointments).set({ reminderSentAt: now }).where(eq(schema.appointments.id, a.id));
      if (sent) {
        await logEvent(tx, { contactId: a.contactId, type: "reminder_sent", data: { appointmentId: a.id } });
        out.reminders++;
      }
    }
  }

  /* Pós-consulta */
  const post = cfg.pos_consulta;
  if (post?.enabled) {
    const hours = Number(post.horasDepois) || 3;
    const due = await tx.query.appointments.findMany({
      where: and(
        isNull(schema.appointments.postVisitSentAt),
        eq(schema.appointments.status, "compareceu"),
        lte(schema.appointments.endsAt, new Date(now.getTime() - hours * 3_600_000)),
        // Não manda "obrigado pela visita" de semanas atrás
        gt(schema.appointments.endsAt, new Date(now.getTime() - (hours + 48) * 3_600_000)),
      ),
      with: { contact: true, professional: { columns: { name: true } } },
      limit: 100,
    });
    for (const a of due) {
      const sent = await sendAutomated(tx, { contactId: a.contactId, key: "pos_consulta", vars: templateVars(a.contact, scope.clinicName, { startsAt: a.startsAt, professionalName: a.professional.name }), meta: { appointmentId: a.id } });
      await tx.update(schema.appointments).set({ postVisitSentAt: now }).where(eq(schema.appointments.id, a.id));
      if (sent) {
        await logEvent(tx, { contactId: a.contactId, type: "post_visit_sent", data: { appointmentId: a.id } });
        out.postVisits++;
      }
    }
  }

  /* Aniversário */
  const bday = cfg.aniversario;
  if (bday?.enabled && scope.has(CRM_FEATURES.campaigns) && utcToZoned(now).minutes >= (Number(bday.hora) || 9) * 60) {
    const [, mm, dd] = today.split("-");
    const year = today.slice(0, 4);
    const people = await tx
      .select()
      .from(schema.contacts)
      .where(
        and(
          isNull(schema.contacts.optedOutAt),
          sql`to_char(${schema.contacts.birthDate}, 'MM-DD') = ${`${mm}-${dd}`}`,
          // Uma vez por ano
          sql`not exists (select 1 from crm_events e where e.contact_id = ${schema.contacts.id} and e.type = 'birthday_sent' and to_char(e.created_at, 'YYYY') = ${year})`,
        ),
      )
      .limit(200);
    for (const c of people) {
      if (await sendAutomated(tx, { contactId: c.id, key: "aniversario", vars: templateVars(c, scope.clinicName) })) {
        await logEvent(tx, { contactId: c.id, type: "birthday_sent", data: {} });
        out.birthdays++;
      }
    }
  }
  return out;
}
