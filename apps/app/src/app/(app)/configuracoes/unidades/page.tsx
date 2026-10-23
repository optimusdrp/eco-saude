import { CLOSURE_KIND_LABEL, dayRangeUtc, describeHours, effectiveHours, formatAddress, ROOM_KIND_LABEL, todayIso, unitsOfWeek, weeklyOf, WEEKDAY_SHORT } from "@ecosaude/core/crm";
import { and, asc, count, eq, gte, inArray, isNull, lt, ne, schema, withTenant } from "@ecosaude/db";
import { Building2, CalendarOff, Clock, DoorOpen } from "lucide-react";
import type { Metadata } from "next";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requireClinic } from "@/lib/auth/dal";
import { listRooms, listUnits, mainUnit } from "@/modules/crm/units";
import { MainUnitButton, RoomButton, UnitButton } from "./UnitForms";
import { ClosureButton, DeleteClosureButton, HolidaysButton, OpeningHoursButton } from "./OpeningForms";
import { loadClosures } from "@/modules/crm/opening";

export const metadata: Metadata = { title: "Unidades e consultórios" };
export const dynamic = "force-dynamic";

/**
 * AJUSTES > UNIDADES E CONSULTÓRIOS (exige "Clínica e profissionais")
 *
 *   Clínica ──< Unidade (endereço, CNES) ──< Consultório / sala
 *
 * - Clínica com um endereço só: uma unidade (a principal) com os consultórios dela.
 * - Mais de um endereço: uma unidade para cada. Na semana de cada profissional
 *   (Clínica e profissionais) diz-se em que unidade e consultório ele atende em cada período.
 * - Por unidade: quem atende ali, quantos consultórios e a ocupação de hoje.
 */
export default async function UnitsPage() {
  const ctx = await requireClinic("config.clinica");
  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const main = await mainUnit(tx);
    const [units, rooms, pros] = [await listUnits(tx), await listRooms(tx), await tx.select().from(schema.professionals).where(eq(schema.professionals.active, true)).orderBy(asc(schema.professionals.name))];
    const { start, end } = dayRangeUtc(todayIso());
    // Ocupação de hoje: consultas por consultório
    const today = rooms.length
      ? await tx
          .select({ roomId: schema.appointments.roomId, n: count() })
          .from(schema.appointments)
          .where(and(inArray(schema.appointments.roomId, rooms.map((r) => r.id)), gte(schema.appointments.startsAt, start), lt(schema.appointments.startsAt, end), ne(schema.appointments.status, "cancelado")))
          .groupBy(schema.appointments.roomId)
      : [];
    const [noRoom] = await tx
      .select({ n: count() })
      .from(schema.appointments)
      .where(and(gte(schema.appointments.startsAt, new Date()), inArray(schema.appointments.status, ["agendado", "confirmado"]), isNull(schema.appointments.roomId)));
    // Feriados e fechamentos de hoje em diante
    const closures = await loadClosures(tx, todayIso());
    return { main, units, rooms, pros, today: new Map(today.map((t) => [t.roomId, t.n])), noRoom: noRoom?.n ?? 0, closures };
  });
  const { main, units, rooms, pros, today, closures } = data;
  const mainRow = units.find((u) => u.main) ?? null;
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const year = Number(todayIso().slice(0, 4));
  // "21/04" ou "24/12 a 26/12"
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const span = (a: string, b: string) => (a === b ? dm(a) : `${dm(a)} a ${dm(b)}`) + (a.slice(0, 4) !== String(year) ? `/${a.slice(0, 4)}` : "");
  const activeUnits = units.filter((u) => u.active);
  const unitOptions = activeUnits.map((u) => ({ id: u.id, name: u.name }));

  // Dias da semana em que cada profissional atende em cada unidade
  const prosByUnit = new Map<string, { name: string; days: string[] }[]>();
  for (const p of pros) {
    const week = weeklyOf(p);
    for (const unitId of unitsOfWeek(week, main.id)) {
      const days = (["1", "2", "3", "4", "5", "6", "0"] as const).filter((k) => week[k]?.periods.some((x) => (x.unitId ?? main.id) === unitId)).map((k) => WEEKDAY_SHORT[Number(k)]!.toLowerCase());
      prosByUnit.set(unitId, [...(prosByUnit.get(unitId) ?? []), { name: p.name, days }]);
    }
  }

  return (
    <>
      <PageHeader
        title="Unidades e consultórios"
        description="Onde a clínica atende. Cada unidade tem os seus consultórios; o profissional diz, em cada período da semana, em qual unidade e consultório atende."
        actions={<UnitButton />}
      />

      {data.noRoom > 0 && rooms.some((r) => r.active) ? (
        <p className="mb-4 rounded-xl bg-erp-tint px-3 py-2 text-sm font-semibold text-erp-ink">
          {data.noRoom} consulta(s) futura(s) sem consultório (marcadas antes dos consultórios existirem ou com todos ocupados). Ao abrir cada uma na Agenda, escolha o consultório em “Editar detalhes”.
        </p>
      ) : null}

      {/* ------------------------- Feriados e fechamentos ------------------------- */}
      <Panel
        className="mb-5"
        title={
          <span className="flex items-center gap-2">
            <CalendarOff className="size-5 text-crm" aria-hidden />
            Feriados e fechamentos
          </span>
        }
        description="Dias em que a clínica ou uma unidade não atende: os horários somem da agenda livre, a marcação avisa e a resposta automática diz que está fechado."
        actions={
          <div className="flex flex-wrap gap-1">
            <HolidaysButton years={[year, year + 1]} />
            <ClosureButton units={activeUnits.map((u) => ({ id: u.id, name: u.name }))} today={todayIso()} />
          </div>
        }
      >
        {closures.length ? (
          <ul className="divide-y divide-line rounded-xl ring-1 ring-line" aria-label="Próximos fechamentos">
            {closures.slice(0, 40).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-28 shrink-0 font-semibold tabular">{span(c.startsOn, c.endsOn)}</span>
                <span className="min-w-0 flex-1 basis-40">{c.reason}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge tone={c.unitId ? "crm" : "neutral"}>{c.unitId ? (unitName.get(c.unitId) ?? "Unidade") : "Clínica inteira"}</Badge>
                  <Badge>{c.national ? "Nacional" : CLOSURE_KIND_LABEL[c.kind]}</Badge>
                </span>
                <DeleteClosureButton id={c.id} reason={c.reason} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum fechamento cadastrado">Traga os feriados nacionais do ano e cadastre os estaduais, municipais e recessos da clínica.</EmptyState>
        )}
      </Panel>

      <div className="space-y-5">
        {units.map((u) => {
          const unitRooms = rooms.filter((r) => r.unitId === u.id);
          const who = prosByUnit.get(u.id) ?? [];
          const address = formatAddress(u);
          return (
            <Panel
              key={u.id}
              className={cn(!u.active && "opacity-70")}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Building2 className="size-5 text-crm" aria-hidden />
                  {u.name}
                  {u.main ? <Badge tone="crm">principal</Badge> : null}
                  {!u.active ? <Badge>fechada</Badge> : null}
                </span>
              }
              description={[address || "Sem endereço cadastrado", u.phone ? `Tel. ${u.phone}` : null, u.cnes ? `CNES ${u.cnes}` : null].filter(Boolean).join("  |  ")}
              actions={
                <div className="flex flex-wrap gap-1">
                  <OpeningHoursButton unitId={u.id} unitName={u.name} main={u.main} own={u.openingHours ?? null} inherited={effectiveHours(u.main ? null : mainRow, mainRow)} />
                  {!u.main && u.active ? <MainUnitButton id={u.id} name={u.name} /> : null}
                  <UnitButton
                    initial={{ id: u.id, name: u.name, address: u.address ?? "", district: u.district ?? "", city: u.city ?? "", state: u.state ?? "", zip: u.zip ?? "", phone: u.phone ?? "", cnes: u.cnes ?? "", active: u.active, main: u.main }}
                  />
                </div>
              }
            >
              {/* Horário de funcionamento (próprio ou herdado da principal) */}
              <p className="mb-3 flex items-start gap-2 text-sm" data-testid={`horario-${u.id}`}>
                <Clock className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
                <span>
                  <span className="font-semibold">Funcionamento:</span> {describeHours(effectiveHours(u, mainRow))}
                  {!u.main && !u.openingHours ? <span className="text-ink-soft"> (mesmo da unidade principal)</span> : null}
                </span>
              </p>
              <div className="grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <section aria-label={`Consultórios de ${u.name}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Consultórios e salas</h3>
                    {u.active ? <RoomButton units={unitOptions} initial={{ unitId: u.id, name: "", kind: "consultorio", notes: "", active: true }} /> : null}
                  </div>
                  {unitRooms.length ? (
                    <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
                      {unitRooms.map((r) => (
                        <li key={r.id} className={cn("flex items-center gap-2 px-3 py-1.5", !r.active && "opacity-60")}>
                          <DoorOpen className="size-4 shrink-0 text-ink-soft" aria-hidden />
                          <RoomButton units={unitOptions} initial={{ id: r.id, unitId: r.unitId, name: r.name, kind: r.kind, notes: r.notes ?? "", active: r.active }} />
                          <span className="hidden text-xs text-ink-soft sm:inline">{ROOM_KIND_LABEL[r.kind]}</span>
                          {r.active ? (
                            <Badge tone={today.get(r.id) ? "crm" : "neutral"} className="tabular">
                              {today.get(r.id) ?? 0} hoje
                            </Badge>
                          ) : (
                            <Badge>fora de uso</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="Nenhum consultório">Sem consultórios, as consultas desta unidade ficam sem sala definida. Cadastre para o Tropi evitar duas consultas na mesma sala.</EmptyState>
                  )}
                </section>
                <section aria-label={`Quem atende em ${u.name}`}>
                  <h3 className="mb-2 text-sm font-semibold">Quem atende aqui</h3>
                  {who.length ? (
                    <ul className="space-y-1 text-sm">
                      {who.map((w) => (
                        <li key={w.name}>
                          <span className="font-semibold">{w.name}</span> <span className="text-ink-soft">{w.days.join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-soft">Ninguém. Em Clínica e profissionais, escolha esta unidade nos períodos da semana de quem atende aqui.</p>
                  )}
                </section>
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
