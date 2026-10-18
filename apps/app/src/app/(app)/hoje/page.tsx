import {
  absenceOn,
  addDaysIso,
  clinicTimeZone,
  CRM_FEATURES,
  type DayFacts,
  dayMinutes,
  dayRangeUtc,
  findFreeSlots,
  formatDayShort,
  formatTime,
  formatWhen,
  type Intent,
  INTENT_LABEL,
  type NoShowRisk,
  todayIso,
  URGENCY_GUIDANCE,
  utcToZoned,
  weeklyOf,
  zonedToUtc,
} from "@ecosaude/core/crm";
import { and, asc, avg, count, eq, gte, inArray, inSequence, isNotNull, isNull, lt, lte, ne, or, schema, sql, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { TodayBoard } from "@/components/crm/today/TodayBoard";
import type { PulseDay, TodayAppointment, TodayData } from "@/components/crm/today/types";
import { requireCrm } from "@/lib/auth/dal";
import { now as clockNow } from "@/lib/clock";
import { dayBrief } from "@/modules/crm/ai/day-brief";
import { automationSettings } from "@/modules/crm/automation-settings";
import { absencesByProfessional, loadWorkSchedule } from "@/modules/crm/hours";
import { returnsDue } from "@/modules/crm/returns";
import { riskFor } from "@/modules/crm/risk";

export const metadata: Metadata = { title: "Hoje" };
export const dynamic = "force-dynamic";

/**
 * HOJE (painel do dia)
 *
 * O servidor junta TUDO o que a recepção e a gestão precisam para o dia, numa
 * única transação isolada pela clínica, e entrega ao painel interativo
 * (TodayBoard), que cuida de: régua do dia, recepção ao vivo (relógio no
 * navegador), fila de ações com filtros, quadros que cada pessoa escolhe e ordena.
 *
 * A página se atualiza sozinha a cada 30 s (AutoRefresh dentro do painel).
 */
export default async function TodayPage() {
  const ctx = await requireCrm();
  const current = clockNow();
  const today = todayIso(current);
  const tomorrow = addDaysIso(today, 1);
  const todayRange = dayRangeUtc(today);
  const tomorrowRange = dayRangeUtc(tomorrow);
  const weekStart = dayRangeUtc(addDaysIso(today, -6)).start;
  const weekday = utcToZoned(zonedToUtc(today, "12:00")).weekday;
  const [, month, day] = today.split("-").map(Number) as [number, number, number];

  const has = {
    inbox: ctx.has(CRM_FEATURES.inbox),
    confirmations: ctx.has(CRM_FEATURES.confirmations),
    waitlist: ctx.has(CRM_FEATURES.waitlist),
    noShowRisk: ctx.has(CRM_FEATURES.noShowRisk),
    campaigns: ctx.has(CRM_FEATURES.campaigns),
  };

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    // Uma consulta por vez na mesma conexão (ver inSequence em @ecosaude/db)
    const [pros, todayAppts, tomorrowAppts, waiting, tasks, waitlist, birthdays, weekAppts, weekContacts, nps, createdContacts, createdAppts] = await inSequence([
      () => tx.select().from(schema.professionals).where(eq(schema.professionals.active, true)).orderBy(asc(schema.professionals.name)),
      () =>
        tx.query.appointments.findMany({
          where: and(gte(schema.appointments.startsAt, todayRange.start), lt(schema.appointments.startsAt, todayRange.end), ne(schema.appointments.status, "cancelado")),
          with: { contact: { columns: { id: true, name: true } }, professional: { columns: { name: true, color: true } } },
          orderBy: asc(schema.appointments.startsAt),
        }),
      () =>
        tx.query.appointments.findMany({
          where: and(gte(schema.appointments.startsAt, tomorrowRange.start), lt(schema.appointments.startsAt, tomorrowRange.end), inArray(schema.appointments.status, ["agendado", "confirmado"])),
          with: { contact: { columns: { id: true, name: true } }, professional: { columns: { name: true, color: true } } },
          orderBy: asc(schema.appointments.startsAt),
        }),
      () =>
        has.inbox
          ? tx.query.conversations.findMany({
              where: and(
                eq(schema.conversations.status, "aberta"),
                isNotNull(schema.conversations.awaitingReplySince),
                or(isNull(schema.conversations.snoozedUntil), lt(schema.conversations.snoozedUntil, current)),
              ),
              with: { contact: { columns: { id: true, name: true } } },
              orderBy: (c, { asc, desc }) => [desc(c.urgent), asc(c.awaitingReplySince)],
              limit: 15,
            })
          : Promise.resolve([]),
      () =>
        tx.query.tasks.findMany({
          where: and(isNull(schema.tasks.doneAt), lte(schema.tasks.dueDate, today)),
          with: { contact: { columns: { id: true, name: true } }, assignee: { columns: { id: true, name: true } } },
          // Avisos de sentimento (paciente irritado/ameaçando) primeiro: não podem ficar fora do limite
          orderBy: [sql`(${schema.tasks.kind} = 'sentimento') desc`, asc(schema.tasks.dueDate)],
          limit: 20,
        }),
      () =>
        has.waitlist
          ? tx
              .select({ professionalId: schema.waitlistEntries.professionalId, period: schema.waitlistEntries.period })
              .from(schema.waitlistEntries)
              .where(eq(schema.waitlistEntries.status, "aguardando"))
          : Promise.resolve([]),
      // Aniversariantes de hoje (dia e mês, qualquer ano)
      () =>
        tx
          .select({ id: schema.contacts.id, name: schema.contacts.name, birthDate: schema.contacts.birthDate })
          .from(schema.contacts)
          .where(and(isNotNull(schema.contacts.birthDate), sql`extract(month from ${schema.contacts.birthDate}) = ${month}`, sql`extract(day from ${schema.contacts.birthDate}) = ${day}`))
          .orderBy(asc(schema.contacts.name))
          .limit(12),
      // Pulso: consultas dos últimos 7 dias por dia e situação
      () =>
        tx
          .select({
            day: sql<string>`to_char(${schema.appointments.startsAt} at time zone ${clinicTimeZone()}, 'YYYY-MM-DD')`,
            status: schema.appointments.status,
            n: sql<number>`count(*)::int`,
          })
          .from(schema.appointments)
          .where(and(gte(schema.appointments.startsAt, weekStart), lt(schema.appointments.startsAt, todayRange.end)))
          .groupBy(sql`1`, schema.appointments.status),
      () =>
        tx
          .select({ day: sql<string>`to_char(${schema.contacts.createdAt} at time zone ${clinicTimeZone()}, 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
          .from(schema.contacts)
          .where(gte(schema.contacts.createdAt, weekStart))
          .groupBy(sql`1`),
      () =>
        tx
          .select({ avg: avg(schema.npsResponses.score), n: count() })
          .from(schema.npsResponses)
          .where(gte(schema.npsResponses.createdAt, dayRangeUtc(addDaysIso(today, -29)).start)),
      () => tx.select({ n: count() }).from(schema.contacts).where(gte(schema.contacts.createdAt, todayRange.start)),
      () => tx.select({ n: count() }).from(schema.appointments).where(gte(schema.appointments.createdAt, todayRange.start)),
    ]);

    const risks = has.noShowRisk ? await riskFor(tx, [...todayAppts, ...tomorrowAppts], current) : new Map<string, NoShowRisk>();
    const returns = has.campaigns ? await returnsDue(tx) : [];

    // "1ª consulta": o paciente nunca compareceu antes deste horário
    const contactIds = [...new Set([...todayAppts, ...tomorrowAppts].map((a) => a.contactId))];
    const attended = contactIds.length
      ? await tx
          .select({ contactId: schema.appointments.contactId, startsAt: schema.appointments.startsAt })
          .from(schema.appointments)
          .where(and(inArray(schema.appointments.contactId, contactIds), eq(schema.appointments.status, "compareceu")))
      : [];

    // Hoje sem consultas (domingo, feriado...): mostra o próximo dia que tem
    let nextDay: { date: string; count: number } | null = null;
    if (todayAppts.length === 0) {
      const [first] = await tx
        .select({ startsAt: schema.appointments.startsAt })
        .from(schema.appointments)
        .where(and(gte(schema.appointments.startsAt, todayRange.end), ne(schema.appointments.status, "cancelado")))
        .orderBy(asc(schema.appointments.startsAt))
        .limit(1);
      if (first) {
        const date = utcToZoned(first.startsAt).date;
        const range = dayRangeUtc(date);
        const [c] = await tx
          .select({ n: count() })
          .from(schema.appointments)
          .where(and(gte(schema.appointments.startsAt, range.start), lt(schema.appointments.startsAt, range.end), ne(schema.appointments.status, "cancelado")));
        nextDay = { date, count: c?.n ?? 0 };
      }
    }

    // Férias e folgas: quem está ausente hoje não tem horários livres
    const absences = await absencesByProfessional(
      tx,
      pros.map((p) => p.id),
      today,
    );

    // Resumo da manhã (Ajustes > IA): números que a frase vai citar, calculados aqui
    let briefExtra: { waitingOver1h: number; fits: DayFacts["fits"] } | null = null;
    if ((await automationSettings(tx)).ia_resumo_dia?.enabled) {
      const [over] = await tx
        .select({ n: count() })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.status, "aberta"), lt(schema.conversations.awaitingReplySince, new Date(current.getTime() - 3_600_000))));
      const fits: DayFacts["fits"] = [];
      for (const p of pros) {
        // Horários ainda livres HOJE (a partir de agora), por período
        const busy = todayAppts.filter((a) => a.professionalId === p.id).map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt }));
        const free = findFreeSlots({ schedule: await loadWorkSchedule(tx, p), busy, from: current, days: 1, limit: 60, minLeadMinutes: 30 }).filter((s) => utcToZoned(s.startsAt).date === today);
        const manha = free.filter((s) => utcToZoned(s.startsAt).minutes < 12 * 60).length;
        if (manha) fits.push({ professional: p.name, period: "manhã", count: manha });
        if (free.length - manha) fits.push({ professional: p.name, period: "tarde", count: free.length - manha });
      }
      briefExtra = { waitingOver1h: over?.n ?? 0, fits: fits.sort((a, b) => b.count - a.count).slice(0, 2) };
    }
    return {
      pros,
      absences,
      todayAppts,
      tomorrowAppts,
      waiting,
      tasks,
      waitlist,
      birthdays,
      weekAppts,
      weekContacts,
      nps: nps[0],
      createdContacts: createdContacts[0]?.n ?? 0,
      createdAppts: createdAppts[0]?.n ?? 0,
      risks,
      returnsCount: returns.length,
      attended,
      nextDay,
      briefExtra,
    };
  });

  /* ------------------------- Formata para a tela ------------------------- */

  const toView = (a: (typeof data.todayAppts)[number]): TodayAppointment => {
    const z = utcToZoned(a.startsAt);
    const ze = utcToZoned(a.endsAt);
    return {
      id: a.id,
      version: a.version,
      status: a.status,
      contactId: a.contact.id,
      contactName: a.contact.name,
      professionalId: a.professionalId,
      professionalName: a.professional.name,
      professionalColor: a.professional.color,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      when: formatWhen(a.startsAt, current),
      service: a.service,
      notes: a.notes,
      confirmationRequested: !!a.confirmationRequestedAt,
      arrivedAt: a.arrivedAt ? formatTime(a.arrivedAt) : null,
      finishedAt: a.finishedAt ? formatTime(a.finishedAt) : null,
      realMinutes: a.finishedAt ? Math.round((a.finishedAt.getTime() - Math.max(a.startsAt.getTime(), (a.arrivedAt ?? a.startsAt).getTime())) / 60_000) : null,
      risk: data.risks.get(a.id) ?? null,
      future: a.startsAt > current,
      startMin: z.minutes,
      endMin: ze.date === z.date ? ze.minutes : 24 * 60,
      time: z.time,
      endTime: ze.time,
      firstVisit: !data.attended.some((x) => x.contactId === a.contactId && x.startsAt < a.startsAt),
    };
  };

  // Pulso: 7 dias (do mais antigo para hoje)
  const pulseDays: PulseDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(today, i - 6);
    const rows = data.weekAppts.filter((r) => r.day === date);
    const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    return {
      date,
      label: formatDayShort(zonedToUtc(date, "12:00")).slice(0, 3),
      attended: n("compareceu"),
      missed: n("faltou"),
      cancelled: n("cancelado"),
      newContacts: data.weekContacts.find((r) => r.day === date)?.n ?? 0,
    };
  });

  const [y] = today.split("-").map(Number) as [number];
  const firstName = ctx.user.name.split(" ")[0] ?? ctx.user.name;

  const board: TodayData = {
    userId: ctx.user.id,
    firstName,
    today,
    dateLabel: new Intl.DateTimeFormat("pt-BR", { timeZone: clinicTimeZone(), weekday: "long", day: "numeric", month: "long" }).format(current),
    dayStartMs: todayRange.start.getTime(),
    serverNowMs: current.getTime(),
    canEdit: ctx.can("agenda.editar"),
    features: has,
    perms: { cancel: ctx.can("agenda.cancelar"), confirm: ctx.can("agenda.confirmacoes"), waitlist: ctx.can("espera.gerir") },
    professionals: data.pros.map((p) => {
      // Horário de HOJE deste profissional (a semana pode variar por dia) e ausência por data
      const absence = absenceOn(data.absences.get(p.id), today);
      const day = absence ? null : dayMinutes(weeklyOf(p), weekday, p.slotMinutes);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        start: day?.start ?? null,
        end: day?.end ?? null,
        periods: day?.periods ?? [],
        gaps: day?.gaps ?? [],
        slot: day?.slot ?? p.slotMinutes,
        absentReason: absence ? absence.reason || "ausente" : undefined,
      };
    }),
    appointments: data.todayAppts.map(toView),
    tomorrow: { label: formatDayShort(tomorrowRange.start), appointments: data.tomorrowAppts.map(toView) },
    nextDay: data.nextDay ? { ...data.nextDay, label: formatDayShort(zonedToUtc(data.nextDay.date, "12:00")) } : null,
    waiting: data.waiting.map((c) => ({
      id: c.id,
      contactId: c.contact.id,
      contactName: c.contact.name,
      channel: c.channel,
      preview: c.lastMessagePreview,
      intent: c.intent,
      intentLabel: c.intent ? (INTENT_LABEL[c.intent as Intent] ?? c.intent) : null,
      urgent: c.urgent,
      urgentGuidance: c.urgent ? URGENCY_GUIDANCE[(c.urgentKind as "clinica" | "emocional") ?? "clinica"] : null,
      sinceMs: c.awaitingReplySince?.getTime() ?? current.getTime(),
    })),
    tasks: data.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      dueDate: t.dueDate,
      overdue: t.dueDate < today,
      contactId: t.contact?.id ?? null,
      contactName: t.contact?.name ?? null,
      assigneeId: t.assignee?.id ?? null,
      assigneeName: t.assignee?.name.split(" ")[0] ?? null,
    })),
    waitlist: data.waitlist,
    returnsCount: data.returnsCount,
    birthdays: data.birthdays.map((b) => ({ contactId: b.id, name: b.name, age: b.birthDate ? y - Number(b.birthDate.slice(0, 4)) : null })),
    pulse: { days: pulseDays, nps: { avg: data.nps?.avg ? Math.round(Number(data.nps.avg) * 10) / 10 : null, count: data.nps?.n ?? 0 } },
    createdToday: { contacts: data.createdContacts, appointments: data.createdAppts },
  };

  // Resumo da manhã: números do sistema; a IA (se ligada) só redige. Nunca espera a IA.
  board.brief = data.briefExtra
    ? await dayBrief(ctx.user.clinicId, {
        dateLabel: formatDayShort(current),
        total: data.todayAppts.length,
        highRisk: data.todayAppts.filter((a) => data.risks.get(a.id)?.level === "alto").length,
        unconfirmed: data.todayAppts.filter((a) => a.status === "agendado" && a.startsAt > current).length,
        fits: data.briefExtra.fits,
        waitlist: data.waitlist.length,
        waitingOver1h: data.briefExtra.waitingOver1h,
        tasksDue: data.tasks.length,
      })
    : null;

  return <TodayBoard data={board} />;
}
