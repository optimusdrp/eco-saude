import { CRM_FEATURES, daysBetween, findFreeSlots, formatWhen, matchesPeriod, relativeDay, unitAt, utcToZoned, weeklyOf } from "@ecosaude/core/crm";
import { and, asc, desc, eq, gt, inArray, inSequence, ne, schema, sql, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { WaitlistBoard } from "@/components/crm/waitlist/WaitlistBoard";
import type { Opportunity, WaitEntry, WaitlistData } from "@/components/crm/waitlist/types";
import { LockedFeature, PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { absencesByProfessional, workScheduleOf } from "@/modules/crm/hours";
import { now } from "@/lib/clock";
import { ago } from "@/modules/crm/format";
import { expireOffers } from "@/modules/crm/scheduling";
import { listUnits, roomFilter, roomSlotBase } from "@/modules/crm/units";

export const metadata: Metadata = { title: "Lista de espera" };
export const dynamic = "force-dynamic";

/** Quantos dias à frente procurar encaixes e quantos horários por profissional */
const LOOKAHEAD_DAYS = 7;
const SLOTS_PER_PRO = 12;

/**
 * LISTA DE ESPERA INTELIGENTE
 *
 * Quem quer horário antes do disponível. O servidor:
 *  1. expira ofertas vencidas (quem não respondeu volta para a fila);
 *  2. monta a fila com contexto (tempo de espera, ofertas recusadas, se já tem
 *     consulta, se há oferta aberta agora);
 *  3. procura ENCAIXES: horários livres dos próximos 7 dias que combinam com
 *     alguém da fila (profissional e período), para a recepção oferecer antes
 *     mesmo de alguém cancelar;
 *  4. calcula os números do mês (taxa de preenchimento, tempo até aceitar).
 *
 * A primeira pessoa que responder SIM a uma oferta fica com a vaga (automático).
 */
export default async function WaitlistPage() {
  const ctx = await requireCrm("agenda.ver");
  if (!ctx.has(CRM_FEATURES.waitlist)) {
    return (
      <>
        <PageHeader title="Lista de espera" />
        <LockedFeature title="Lista de espera inteligente">
          Quando alguém cancela, o horário é oferecido automaticamente a quem está esperando, e a primeira resposta “SIM” garante a vaga.
        </LockedFeature>
      </>
    );
  }
  const current = now();
  const nowMs = current.getTime();
  const until = new Date(nowMs + LOOKAHEAD_DAYS * 86_400_000);

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    await expireOffers(tx);
    const [entries, offers, pros, busy, openOffers, stats, declined] = await inSequence([
      () =>
        tx.query.waitlistEntries.findMany({
          where: inArray(schema.waitlistEntries.status, ["aguardando", "oferecido"]),
          with: { contact: { columns: { id: true, name: true, optedOutAt: true } }, professional: { columns: { name: true } } },
          extras: {
            // A consulta relacional apelida a tabela pelo nome no schema ("waitlistEntries"):
            // nos extras a coluna vai por extenso com esse apelido
            nextAt: sql<string | null>`(select min(a.starts_at) from appointments a
              where a.contact_id = "waitlistEntries"."contact_id" and a.starts_at > now() and a.status in ('agendado', 'confirmado'))`.as("next_at"),
            conversationId: sql<string | null>`(select cv.id from conversations cv
              where cv.contact_id = "waitlistEntries"."contact_id" order by cv.last_message_at desc nulls last limit 1)`.as("conversation_id"),
          },
          orderBy: asc(schema.waitlistEntries.createdAt),
        }),
      () =>
        tx.query.slotOffers.findMany({
          with: { professional: { columns: { name: true } }, candidates: { with: { contact: { columns: { name: true } } } }, filledBy: { columns: { name: true } } },
          orderBy: desc(schema.slotOffers.createdAt),
          limit: 15,
        }),
      () => tx.select().from(schema.professionals).where(eq(schema.professionals.active, true)).orderBy(asc(schema.professionals.name)),
      () =>
        tx
          .select({ professionalId: schema.appointments.professionalId, startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt })
          .from(schema.appointments)
          .where(and(ne(schema.appointments.status, "cancelado"), gt(schema.appointments.endsAt, current), sql`${schema.appointments.startsAt} < ${until}`)),
      () =>
        tx
          .select({ professionalId: schema.slotOffers.professionalId, startsAt: schema.slotOffers.startsAt, endsAt: schema.slotOffers.endsAt })
          .from(schema.slotOffers)
          .where(eq(schema.slotOffers.status, "aberta")),
      // Números dos últimos 30 dias
      () =>
        tx
          .execute<{ filled: number; closed: number; avg_accept: number | null }>(
            sql`select count(*) filter (where o.status = 'preenchida')::int as filled,
                count(*) filter (where o.status <> 'aberta')::int as closed,
                (select avg(extract(epoch from (c.responded_at - o2.created_at)) / 60)::float
                   from slot_offer_candidates c join slot_offers o2 on o2.id = c.offer_id
                  where c.outcome = 'aceitou' and o2.created_at > now() - interval '30 days') as avg_accept
              from slot_offers o where o.created_at > now() - interval '30 days'`,
          )
          .then((r) => r.rows[0] ?? { filled: 0, closed: 0, avg_accept: null }),
      // Ofertas recusadas por entrada da fila
      () =>
        tx
          .select({ entryId: schema.slotOfferCandidates.waitlistEntryId, n: sql<number>`count(*)::int` })
          .from(schema.slotOfferCandidates)
          .where(eq(schema.slotOfferCandidates.outcome, "recusou"))
          .groupBy(schema.slotOfferCandidates.waitlistEntryId),
    ]);
    // Férias e folgas por data: o profissional ausente não tem horários para oferecer
    const absences = await absencesByProfessional(tx, pros.map((p) => p.id));
    const units = (await listUnits(tx)).filter((u) => u.active);
    return { entries, offers, pros, busy, openOffers, stats, declined, absences, units };
  });

  /* --------------------------------- Fila --------------------------------- */
  const openByEntry = new Map<string, { label: string; expiresMs: number }>();
  for (const o of data.offers.filter((o) => o.status === "aberta")) {
    for (const c of o.candidates.filter((c) => c.outcome === "enviada")) {
      openByEntry.set(c.waitlistEntryId, { label: `${formatWhen(o.startsAt, current)} com ${o.professional.name}`, expiresMs: o.expiresAt.getTime() });
    }
  }
  const entries: WaitEntry[] = data.entries.map((e, i) => ({
    id: e.id,
    position: i + 1,
    contactId: e.contact.id,
    contactName: e.contact.name,
    professionalId: e.professionalId,
    professionalName: e.professional?.name ?? null,
    period: e.period,
    notes: e.notes,
    status: e.status as "aguardando" | "oferecido",
    waitingDays: Math.max(0, daysBetween(e.createdAt, current)),
    since: ago(e.createdAt, nowMs),
    declined: data.declined.find((d) => d.entryId === e.id)?.n ?? 0,
    nextAppointment: e.nextAt ? formatWhen(new Date(e.nextAt), current) : null,
    openOffer: openByEntry.get(e.id) ?? null,
    conversationId: e.conversationId,
    optedOut: !!e.contact.optedOutAt,
    unitId: e.unitId,
    unitName: data.units.length > 1 ? (data.units.find((u) => u.id === e.unitId)?.name ?? null) : null,
  }));
  // Unidade de cada horário livre (pela semana do profissional): quem só aceita uma unidade não recebe horário de outra
  const mainUnitId = data.units.find((u) => u.main)?.id ?? "";

  /* ------------------------------- Encaixes ------------------------------- */
  // Horários livres (sem consulta e sem oferta aberta) que combinam com alguém da fila
  const waiting = data.entries.filter((e) => e.status === "aguardando" && !e.contact.optedOutAt);
  const opportunities: Opportunity[] = [];
  // Consultórios: só oferece horário que também tem sala livre na unidade (mesma regra da marcação)
  const roomBase = waiting.length ? await withTenant(ctx.user.clinicId, (tx) => roomSlotBase(tx, current, new Date(current.getTime() + (LOOKAHEAD_DAYS + 1) * 86_400_000))) : null;
  for (const p of data.pros) {
    const interested = waiting.filter((e) => e.professionalId === null || e.professionalId === p.id);
    if (interested.length === 0) continue;
    const busy = [...data.busy, ...data.openOffers].filter((b) => b.professionalId === p.id);
    // Procura por período pedido (senão os horários da manhã "tomam" o limite e quem quer tarde fica sem)
    const periods = interested.some((e) => e.period === "qualquer") ? (["qualquer"] as const) : ([...new Set(interested.map((e) => e.period))] as ("manha" | "tarde")[]);
    const seen = new Set<string>();
    for (const period of periods) {
      const slots = findFreeSlots({
        schedule: workScheduleOf(p, data.absences.get(p.id)),
        busy,
        from: current,
        days: LOOKAHEAD_DAYS,
        limit: SLOTS_PER_PRO,
        period,
        accept: roomBase ? roomFilter(roomBase, p).accept : undefined,
      });
      for (const s of slots) {
        const key = s.startsAt.toISOString();
        if (seen.has(key)) continue;
        seen.add(key);
        const zs = utcToZoned(s.startsAt);
        const slotUnit = unitAt(weeklyOf(p), zs.weekday, zs.minutes, zs.minutes + p.slotMinutes, mainUnitId);
        const matches = interested.filter((e) => matchesPeriod(s.startsAt, e.period) && (!e.unitId || e.unitId === slotUnit));
        if (matches.length === 0) continue;
        const z = utcToZoned(s.startsAt);
        opportunities.push({
          professionalId: p.id,
          professionalName: p.name,
          professionalColor: p.color,
          startsAt: key,
          endsAt: s.endsAt.toISOString(),
          label: formatWhen(s.startsAt, current),
          date: z.date,
          dayLabel: relativeDay(s.startsAt, current),
          time: z.time,
          matches: matches.map((m) => ({ id: m.id, name: m.contact.name })),
        });
      }
    }
  }
  opportunities.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const board: WaitlistData = {
    entries,
    opportunities,
    offers: data.offers.map((o) => ({
      id: o.id,
      status: o.status,
      label: formatWhen(o.startsAt, current),
      professional: o.professional.name,
      createdLabel: ago(o.createdAt, nowMs),
      expiresMs: o.expiresAt.getTime(),
      filledBy: o.filledBy?.name ?? null,
      candidates: o.candidates.map((c) => ({ name: c.contact.name, outcome: c.outcome })),
    })),
    professionals: data.pros.map((p) => ({ id: p.id, name: p.name, slotMinutes: p.slotMinutes, color: p.color })),
    units: data.units.length > 1 ? data.units.map((u) => ({ id: u.id, name: u.name })) : [],
    stats: {
      waiting: entries.filter((e) => e.status === "aguardando").length,
      offered: entries.filter((e) => e.status === "oferecido").length,
      avgDays: entries.length ? Math.round(entries.reduce((s, e) => s + e.waitingDays, 0) / entries.length) : 0,
      filled30: data.stats.filled,
      closed30: data.stats.closed,
      avgAcceptMin: data.stats.avg_accept === null ? null : Math.round(Number(data.stats.avg_accept)),
    },
    serverNowMs: nowMs,
    canEdit: ctx.can("espera.gerir"),
  };

  return <WaitlistBoard data={board} />;
}
