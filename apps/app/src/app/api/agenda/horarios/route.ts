import { findFreeSlots, formatWhen, unitAt, utcToZoned, weeklyOf, zonedToUtc, type WaitlistPeriod } from "@ecosaude/core/crm";
import { and, eq, gt, lt, ne, schema, withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { loadWorkSchedule } from "@/modules/crm/hours";
import { listUnits, roomFilterFor } from "@/modules/crm/units";

/**
 * GET /api/agenda/horarios?prof=<id>&periodo=manha|tarde|qualquer&dias=14
 *     [&desde=AAAA-MM-DD] a partir de um dia (padrão: agora)
 *     [&ignorar=<id da consulta>] ao REMARCAR, o horário atual da própria consulta conta como livre
 *     [&limite=12] quantos horários devolver (máx. 40)
 *     [&duracao=60] duração desejada em minutos (padrão: a do profissional)
 * Próximos horários livres do profissional (respeita expediente, almoço e consultas marcadas)
 * E COM CONSULTÓRIO: se a unidade controla consultórios e todos estão ocupados, o horário não
 * aparece. Cada horário traz a sala sugerida (`room`), a mesma que a marcação vai usar.
 */
export async function GET(req: NextRequest) {
  const ctx = await apiContext("agenda.ver");
  if (isResponse(ctx)) return ctx;
  const sp = req.nextUrl.searchParams;
  const professionalId = sp.get("prof") ?? "";
  const period = (["manha", "tarde", "qualquer"].includes(sp.get("periodo") ?? "") ? sp.get("periodo") : "qualquer") as WaitlistPeriod;
  const days = Math.min(30, Math.max(1, Number(sp.get("dias")) || 14));
  const ignore = sp.get("ignorar") ?? "";
  const limit = Math.min(40, Math.max(1, Number(sp.get("limite")) || 12));
  // Duração desejada (consulta mais longa que a padrão do profissional)
  const duration = Number(sp.get("duracao")) || undefined;
  if (!/^[0-9a-f-]{36}$/i.test(professionalId)) return NextResponse.json({ slots: [] });

  const now = new Date();
  const since = sp.get("desde");
  // "desde" no passado não faz sentido: começa de agora
  const from = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? new Date(Math.max(now.getTime(), zonedToUtc(since, "00:00").getTime())) : now;
  const until = new Date(from.getTime() + days * 86_400_000);
  // Clínica com mais de uma unidade: cada horário diz onde é (o profissional pode atender em endereços diferentes)
  let unitOf: (d: Date) => string | null = () => null;
  let roomOf: (s: { startsAt: Date; endsAt: Date }) => string | null = () => null;
  const slots = await withTenant(ctx.user.clinicId, async (tx) => {
    const pro = await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, professionalId) });
    if (!pro) return [];
    const units = (await listUnits(tx)).filter((u) => u.active);
    const main = units.find((u) => u.main);
    if (units.length > 1 && main) {
      const week = weeklyOf(pro);
      const name = new Map(units.map((u) => [u.id, u.name]));
      const minutes = duration && duration >= 5 ? duration : pro.slotMinutes;
      unitOf = (d) => {
        const z = utcToZoned(d);
        return name.get(unitAt(week, z.weekday, z.minutes, z.minutes + minutes, main.id)) ?? null;
      };
    }
    const busy = await tx
      .select({ startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt })
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.professionalId, pro.id),
          ne(schema.appointments.status, "cancelado"),
          gt(schema.appointments.endsAt, from),
          lt(schema.appointments.startsAt, until),
          /^[0-9a-f-]{36}$/i.test(ignore) ? ne(schema.appointments.id, ignore) : undefined,
        ),
      );
    // Consultórios: ocupação das salas no período (ao remarcar, a sala da própria consulta conta como livre)
    const rooms = await roomFilterFor(tx, pro, from, new Date(until.getTime() + 86_400_000), /^[0-9a-f-]{36}$/i.test(ignore) ? ignore : undefined);
    roomOf = (s) => rooms.pick(s)?.roomName ?? null;
    return findFreeSlots({
      accept: rooms.accept,
      schedule: await loadWorkSchedule(tx, pro),
      busy,
      // minLeadMinutes é contado a partir de "from"; a partir de agora mantém 1h de antecedência
      from,
      days,
      limit,
      durationMinutes: duration && duration >= 5 && duration <= 480 ? duration : undefined,
      period,
    });
  });

  return NextResponse.json({
    slots: slots.map((s) => {
      const z = utcToZoned(s.startsAt);
      return { startsAt: s.startsAt.toISOString(), date: z.date, time: z.time, label: formatWhen(s.startsAt, now), unit: unitOf(s.startsAt), room: roomOf(s) };
    }),
  });
}
