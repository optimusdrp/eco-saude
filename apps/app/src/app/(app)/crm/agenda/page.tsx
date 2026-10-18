import {
  absenceOn,
  addDaysIso,
  clinicTimeZone,
  CRM_FEATURES,
  dayRangeUtc,
  formatDayShort,
  formatTime,
  formatWhen,
  type NoShowRisk,
  todayIso,
  utcToZoned,
  weeklyOf,
  weekMinutes,
  zonedToUtc,
} from "@ecosaude/core/crm";
import { and, asc, eq, gte, inArray, inSequence, lt, ne, schema, sql, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { AgendaBoard } from "@/components/crm/agenda/board/AgendaBoard";
import type { AgendaData, AgendaView, BoardAppointment, BoardDay, BoardProfessional } from "@/components/crm/agenda/board/types";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { absencesByProfessional } from "@/modules/crm/hours";
import { riskFor } from "@/modules/crm/risk";

export const metadata: Metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

const VIEWS: AgendaView[] = ["dia", "semana", "lista"];
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * AGENDA (?data=2026-10-12&visao=dia|semana|lista&consulta=<id>)
 *
 * O servidor só busca os dados do período (dia ou semana) e entrega para o
 * quadro interativo (AgendaBoard), que cuida de: horas à esquerda, densidade,
 * filtros, arrastar para remarcar, mini calendário, atalhos e impressão.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ data?: string; visao?: string; consulta?: string }> }) {
  const ctx = await requireCrm("agenda.ver");
  const current = now();
  const today = todayIso(current);
  const sp = await searchParams;
  const date = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : today;
  const view: AgendaView = VIEWS.includes(sp.visao as AgendaView) ? (sp.visao as AgendaView) : "dia";

  // Período: o dia, ou a semana (segunda a domingo) que contém o dia
  const weekday = utcToZoned(zonedToUtc(date, "12:00")).weekday;
  const first = view === "semana" ? addDaysIso(date, -((weekday + 6) % 7)) : date;
  const length = view === "semana" ? 7 : 1;
  const dates = Array.from({ length }, (_, i) => addDaysIso(first, i));
  const start = dayRangeUtc(dates[0]!).start;
  const end = dayRangeUtc(dates[dates.length - 1]!).end;
  // Mês do dia escolhido (mini calendário)
  const monthStart = `${date.slice(0, 7)}-01`;
  const nextMonth = `${addDaysIso(monthStart, 32).slice(0, 7)}-01`;

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const [pros, appts, month, waitlist] = await inSequence([
      () => tx.select().from(schema.professionals).where(eq(schema.professionals.active, true)).orderBy(asc(schema.professionals.name)),
      () =>
        tx.query.appointments.findMany({
          where: and(gte(schema.appointments.startsAt, start), lt(schema.appointments.startsAt, end)),
          with: { contact: { columns: { id: true, name: true } }, professional: { columns: { name: true } } },
          orderBy: asc(schema.appointments.startsAt),
        }),
      () =>
        tx
          .select({
            day: sql<string>`to_char(${schema.appointments.startsAt} at time zone ${clinicTimeZone()}, 'YYYY-MM-DD')`,
            n: sql<number>`count(*)::int`,
          })
          .from(schema.appointments)
          .where(and(gte(schema.appointments.startsAt, dayRangeUtc(monthStart).start), lt(schema.appointments.startsAt, dayRangeUtc(nextMonth).start), ne(schema.appointments.status, "cancelado")))
          .groupBy(sql`1`),
      () =>
        ctx.has(CRM_FEATURES.waitlist)
          ? tx
              .select({ professionalId: schema.waitlistEntries.professionalId, period: schema.waitlistEntries.period })
              .from(schema.waitlistEntries)
              .where(eq(schema.waitlistEntries.status, "aguardando"))
          : Promise.resolve([]),
    ]);
    const risks = ctx.has(CRM_FEATURES.noShowRisk) ? await riskFor(tx, appts, current) : new Map<string, NoShowRisk>();

    // "1ª consulta": o paciente nunca compareceu antes deste horário
    const contactIds = [...new Set(appts.map((a) => a.contactId))];
    const attended = contactIds.length
      ? await tx
          .select({ contactId: schema.appointments.contactId, startsAt: schema.appointments.startsAt })
          .from(schema.appointments)
          .where(and(inArray(schema.appointments.contactId, contactIds), eq(schema.appointments.status, "compareceu")))
      : [];
    const absences = await absencesByProfessional(
      tx,
      pros.map((p) => p.id),
      dates[0]!,
    );
    return { pros, appts, month, waitlist, risks, attended, absences };
  });

  const professionals: BoardProfessional[] = data.pros.map((p) => ({
    id: p.id,
    name: p.name,
    specialty: p.specialty,
    color: p.color,
    slot: p.slotMinutes,
    days: weekMinutes(weeklyOf(p), p.slotMinutes),
    // Ausências que caem nos dias exibidos (data -> motivo)
    absent: Object.fromEntries(
      dates.flatMap((d) => {
        const a = absenceOn(data.absences.get(p.id), d);
        return a ? [[d, a.reason || "ausente"]] : [];
      }),
    ),
  }));

  const appointments: BoardAppointment[] = data.appts.map((a) => {
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
      date: z.date,
      startMin: z.minutes,
      // Consulta que passa da meia-noite termina "no fim do dia"
      endMin: ze.date === z.date ? ze.minutes : 24 * 60,
      time: z.time,
      endTime: ze.time,
      firstVisit: !data.attended.some((x) => x.contactId === a.contactId && x.startsAt < a.startsAt),
    };
  });

  const days: BoardDay[] = dates.map((d) => {
    const noon = zonedToUtc(d, "12:00");
    return { date: d, weekday: utcToZoned(noon).weekday, label: formatDayShort(noon), isToday: d === today, isPast: d < today };
  });

  const agenda: AgendaData = {
    view,
    date,
    today,
    days,
    professionals,
    appointments,
    monthCounts: Object.fromEntries(data.month.map((m) => [m.day, m.n])),
    waitlist: data.waitlist,
    nowMin: utcToZoned(current).minutes,
    serverNowMs: current.getTime(),
    canEdit: ctx.can("agenda.editar"),
    // Funcionalidade do plano E permissão do perfil (a tela só mostra o que a pessoa pode usar)
    features: {
      confirmations: ctx.has(CRM_FEATURES.confirmations) && ctx.can("agenda.confirmacoes"),
      waitlist: ctx.has(CRM_FEATURES.waitlist) && ctx.can("espera.gerir"),
      cancel: ctx.can("agenda.cancelar"),
    },
    openId: sp.consulta && UUID.test(sp.consulta) ? sp.consulta : undefined,
  };

  return <AgendaBoard data={agenda} canConfigure={ctx.can("config.clinica")} />;
}
