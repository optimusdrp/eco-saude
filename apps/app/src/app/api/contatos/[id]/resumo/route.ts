import { CRM_FEATURES, formatWhen } from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, inArray, inSequence, isNull, schema, sql, withTenant } from "@ecosaude/db";
import { NextResponse } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { describeEvent } from "@/modules/crm/format";
import { riskFor } from "@/modules/crm/risk";

/**
 * GET /api/contatos/<id>/resumo
 * Dados do TRILHO DO PACIENTE: quem é, como falar, próxima consulta (com
 * risco de falta), tarefas abertas e o que aconteceu por último.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext("pacientes.ver");
  if (isResponse(ctx)) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Inválido." }, { status: 400 });

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const contact = await tx.query.contacts.findFirst({
      where: eq(schema.contacts.id, id),
      with: { identities: true, owner: { columns: { name: true } } },
    });
    if (!contact) return null;

    const [conversations, next, history, tasks, events, waitlist] = await inSequence([
      () => tx.select({ id: schema.conversations.id, channel: schema.conversations.channel, unread: schema.conversations.unreadCount })
        .from(schema.conversations).where(eq(schema.conversations.contactId, id)).orderBy(sql`${schema.conversations.lastMessageAt} desc nulls last`),
      () => tx.query.appointments.findFirst({
        where: and(eq(schema.appointments.contactId, id), gt(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"])),
        with: { professional: { columns: { name: true } } },
        orderBy: asc(schema.appointments.startsAt),
      }),
      () => tx.select({
        attended: sql<number>`count(*) filter (where ${schema.appointments.status} = 'compareceu')::int`,
        noShows: sql<number>`count(*) filter (where ${schema.appointments.status} = 'faltou')::int`,
      }).from(schema.appointments).where(eq(schema.appointments.contactId, id)),
      () => tx.select({ id: schema.tasks.id, title: schema.tasks.title, dueDate: schema.tasks.dueDate })
        .from(schema.tasks).where(and(eq(schema.tasks.contactId, id), isNull(schema.tasks.doneAt))).orderBy(asc(schema.tasks.dueDate)).limit(3),
      () => tx.select().from(schema.crmEvents).where(eq(schema.crmEvents.contactId, id)).orderBy(desc(schema.crmEvents.createdAt)).limit(4),
      () => tx.select({ id: schema.waitlistEntries.id }).from(schema.waitlistEntries)
        .where(and(eq(schema.waitlistEntries.contactId, id), inArray(schema.waitlistEntries.status, ["aguardando", "oferecido"]))).limit(1)]);

    const risk = next && ctx.has(CRM_FEATURES.noShowRisk) ? (await riskFor(tx, [next])).get(next.id) ?? null : null;
    return {
      id: contact.id,
      name: contact.name,
      stage: contact.stage,
      phone: contact.phone,
      email: contact.email,
      tags: contact.tags,
      owner: contact.owner?.name ?? null,
      optedOut: !!contact.optedOutAt,
      consent: contact.consentMarketing,
      preferredChannel: contact.preferredChannel,
      lastVisit: contact.lastVisitAt ? formatWhen(contact.lastVisitAt) : null,
      channels: contact.identities.map((i) => ({ channel: i.channel, externalId: i.externalId })),
      conversations,
      next: next ? { when: formatWhen(next.startsAt), professional: next.professional.name, status: next.status, risk } : null,
      stats: history[0] ?? { attended: 0, noShows: 0 },
      tasks,
      events: events.map((e) => ({ id: e.id, text: describeEvent(e.type, e.data), at: e.createdAt.toISOString() })),
      onWaitlist: waitlist.length > 0,
    };
  });

  if (!data) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  return NextResponse.json(data);
}
