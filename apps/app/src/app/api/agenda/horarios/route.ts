import { findFreeSlots, formatWhen, utcToZoned, zonedToUtc, type WaitlistPeriod } from "@ecosaude/core/crm";
import { and, eq, gt, lt, ne, schema, withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { loadWorkSchedule } from "@/modules/crm/hours";

/**
 * GET /api/agenda/horarios?prof=<id>&periodo=manha|tarde|qualquer&dias=14
 *     [&desde=AAAA-MM-DD] a partir de um dia (padrão: agora)
 *     [&ignorar=<id da consulta>] ao REMARCAR, o horário atual da própria consulta conta como livre
 *     [&limite=12] quantos horários devolver (máx. 40)
 *     [&duracao=60] duração desejada em minutos (padrão: a do profissional)
 * Próximos horários livres do profissional (respeita expediente, almoço e consultas marcadas).
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
  const slots = await withTenant(ctx.user.clinicId, async (tx) => {
    const pro = await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, professionalId) });
    if (!pro) return [];
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
    return findFreeSlots({
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
      return { startsAt: s.startsAt.toISOString(), date: z.date, time: z.time, label: formatWhen(s.startsAt, now) };
    }),
  });
}
