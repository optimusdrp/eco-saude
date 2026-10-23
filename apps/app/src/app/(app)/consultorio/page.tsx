import { addDaysIso, arrivalAction, arrivalWindow, clinicTimeZone, dayRangeUtc, formatTime, todayIso } from "@ecosaude/core/crm";
import { ageYears } from "@ecosaude/core/pep";
import { asc, eq, schema, withTenant } from "@ecosaude/db";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, DoorOpen, FilePen, MapPin, Search, Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrivalButton, AutoRefresh, TriageButton, UrgentWatch } from "@/components/pep/ConsultorioTools";
import { StartEncounterButton } from "@/components/pep/widgets";
import { Badge, EmptyState, PageHeader, Panel, type Tone } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requirePep } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { professionalOfUser } from "@/modules/pep/access";
import { FLOW_LABEL, loadDay, nextPatient, roomsNow, staleDrafts, type DayRow, type FlowStatus } from "@/modules/pep/consultorio";
import { resolveUnitView } from "@/modules/crm/units";

export const metadata: Metadata = { title: "Consultório" };

const FLOW_TONE: Record<FlowStatus, Tone> = {
  aguardando: "neutral",
  chegou: "pep",
  triado: "pep",
  em_atendimento: "warning",
  finalizado: "success",
  faltou: "alert",
};

const PRIORITY_LABEL = { prioritario: "Prioritário", urgente: "Urgente" } as const;

/**
 * CONSULTÓRIO: a primeira tela do profissional de saúde.
 *
 *  - Profissional: os pacientes DELE no dia, o próximo a atender em destaque, quanto tempo
 *    cada um está esperando, triagem e atendimentos esquecidos em rascunho.
 *  - Gestão, enfermagem e quem recebeu "Consultório": o dia de todos (ou de um profissional),
 *    só com a situação de cada paciente. Conteúdo clínico depende de outras permissões.
 *
 * A tela se atualiza sozinha a cada 30 segundos (chegadas marcadas pela recepção).
 */
export default async function ConsultorioPage({ searchParams }: { searchParams: Promise<{ dia?: string; prof?: string; unidade?: string }> }) {
  const ctx = await requirePep("prontuario.consultorio");
  const sp = await searchParams;
  const today = todayIso();
  const day = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : today;
  const can = {
    attend: ctx.can("prontuario.atender"),
    read: ctx.can("prontuario.ver"),
    triage: ctx.can("prontuario.triagem"),
    summary: ctx.can("prontuario.resumo"),
    docs: ctx.can("prontuario.documentos"),
    // Marcar chegada pelo Consultório: mesma permissão da agenda (clínica sem recepção)
    arrive: ctx.can("agenda.editar"),
  };

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const mine = await professionalOfUser(tx, ctx.user.id);
    const professionals = await tx
      .select({ id: schema.professionals.id, name: schema.professionals.name })
      .from(schema.professionals)
      .where(eq(schema.professionals.active, true))
      .orderBy(asc(schema.professionals.name));
    // Padrão: o profissional vê os dele; os demais veem todos. "todos" na URL mostra todos.
    const chosen = sp.prof === "todos" ? null : (professionals.find((p) => p.id === sp.prof)?.id ?? (sp.prof ? null : (mine?.id ?? null)));
    // Unidades: as do acesso da pessoa e, dentre elas, a escolhida
    const place = await resolveUnitView(tx, ctx.user.unitIds, sp.unidade);
    const rows = await loadDay(tx, { date: day, professionalId: chosen, unitIds: place.filter });
    const drafts = mine ? await staleDrafts(tx, mine.id, today) : [];
    const rooms = day === today ? await roomsNow(tx, { unitIds: place.filter, now: now(), dayEnd: dayRangeUtc(today).end }) : [];
    return { mine, professionals, chosen, rows, drafts, place, rooms };
  });
  const { mine, professionals, chosen, rows, drafts, place, rooms } = data;
  const showUnit = place.multi && !place.selected && (place.filter?.length ?? 2) > 1;
  const nowMs = now().getTime();
  const isToday = day === today;
  const next = isToday ? nextPatient(rows.filter((r) => !mine || r.professional.id === mine.id)) : null;
  const count = (s: FlowStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const showPro = !chosen;
  const href = (d: string, p = sp.prof) => `/consultorio?${new URLSearchParams({ ...(d !== today ? { dia: d } : {}), ...(p ? { prof: p } : {}), ...(place.selected ? { unidade: place.selected } : {}) })}`;
  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Consultório"
        description={mine ? `${mine.name}${mine.specialty ? `, ${mine.specialty}` : ""}` : "Pacientes do dia e a situação de cada atendimento."}
        actions={<AutoRefresh timeZone={clinicTimeZone()} />}
      />

      {/* Triagem urgente esperando: faixa vermelha + som opcional (aviso ativo) */}
      {isToday ? (
        <UrgentWatch
          patients={rows
            .filter((r) => r.triage?.priority === "urgente" && (r.status === "chegou" || r.status === "triado" || r.status === "aguardando"))
            .map((r) => ({ appointmentId: r.appointmentId, name: r.contact.name, time: formatTime(r.startsAt), professional: showPro ? r.professional.name : null }))}
        />
      ) : null}

      {/* --------------------------- Dia e profissional --------------------------- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Dia" className="flex items-center gap-1 rounded-full bg-paper p-1 ring-1 ring-line">
          <Link href={href(addDaysIso(day, -1))} aria-label="Dia anterior" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-fog">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <span className="min-w-0 px-2 text-sm font-semibold first-letter:uppercase">{isToday ? `Hoje, ${dayLabel.split(",")[1]?.trim() ?? dayLabel}` : dayLabel}</span>
          <Link href={href(addDaysIso(day, 1))} aria-label="Próximo dia" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-fog">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
          {!isToday ? (
            <Link href={href(today)} className="rounded-full px-3 py-2 text-sm font-semibold text-pep hover:bg-pep-tint">
              Hoje
            </Link>
          ) : null}
        </nav>
        {professionals.length > 1 || place.multi ? (
          <form className="flex flex-wrap items-center gap-2">
            {day !== today ? <input type="hidden" name="dia" value={day} /> : null}
            {place.multi && (place.units.length > 1 || !place.allUnits) ? (
              <>
                <label htmlFor="unidade" className="sr-only">
                  Unidade
                </label>
                <select id="unidade" name="unidade" defaultValue={place.selected ?? ""} className="min-h-10 rounded-full bg-paper px-3 text-sm font-semibold ring-1 ring-line">
                  {place.allUnits || place.units.length > 1 ? <option value="">{place.allUnits ? "Todas as unidades" : "Minhas unidades"}</option> : null}
                  {place.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <label htmlFor="prof" className="sr-only">
              Profissional
            </label>
            <select id="prof" name="prof" defaultValue={chosen ?? "todos"} className="min-h-10 rounded-full bg-paper px-3 text-sm font-semibold ring-1 ring-line">
              <option value="todos">Todos os profissionais</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === mine?.id ? " (você)" : ""}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">
              Ver
            </button>
          </form>
        ) : null}
      </div>

      {/* --------------------------------- Números --------------------------------- */}
      <dl className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Aguardando chegada" value={count(["aguardando"])} />
        <Stat label="Na clínica" value={count(["chegou", "triado"])} strong={count(["chegou", "triado"]) > 0} />
        <Stat label="Em atendimento" value={count(["em_atendimento"])} />
        <Stat label="Finalizados" value={count(["finalizado"])} />
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          {/* ----------------------------- Próximo paciente ----------------------------- */}
          {next && mine ? <NextCard row={next} nowMs={nowMs} can={can} mine={mine.userId === ctx.user.id} /> : null}

          {/* ------------------------------ Lista do dia ------------------------------ */}
          {/* (cada linha mostra o consultório; com várias unidades, também a unidade) */}
          <Panel title="Pacientes do dia" description={rows.length ? `${rows.length} ${rows.length === 1 ? "consulta" : "consultas"}` : undefined}>
            {rows.length ? (
              <ol className="divide-y divide-line">
                {rows.map((r) => (
                  <PatientRow key={r.appointmentId} row={r} nowMs={nowMs} can={can} isToday={isToday} showPro={showPro} showUnit={showUnit} mine={r.professional.userId === ctx.user.id} />
                ))}
              </ol>
            ) : (
              <EmptyState title={isToday ? "Nenhuma consulta hoje" : "Nenhuma consulta neste dia"}>{ctx.hasCrm ? "As consultas marcadas na Agenda aparecem aqui." : "Com o Atendimento contratado, a agenda aparece aqui."}</EmptyState>
            )}
          </Panel>
        </div>

        {/* --------------------------------- Lateral --------------------------------- */}
        <aside className="flex flex-col gap-4" aria-label="Pendências e atalhos">
          {rooms.length ? (
            <Panel title="Consultórios agora" description={place.multi && !place.selected ? "Das suas unidades" : undefined}>
              <ul className="divide-y divide-line">
                {rooms.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 py-2">
                    <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", r.busy ? "bg-alert" : "bg-ok")} aria-hidden />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block font-semibold">
                        {r.name}
                        {showUnit ? <span className="font-normal text-ink-soft">, {r.unitName}</span> : null}
                      </span>
                      <span className="block text-ink-soft">
                        {r.busy
                          ? `Ocupado: ${r.busy.professional} até ${formatTime(r.busy.until)}`
                          : r.next
                            ? `Livre até ${formatTime(r.next.at)} (${r.next.professional})`
                            : "Livre pelo resto do dia"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {drafts.length ? (
            <Panel title="Atendimentos esquecidos" description="Começados em outro dia e não finalizados: não valem como registro.">
              <ul className="divide-y divide-line">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <Link href={`/prontuario/atendimentos/${d.id}`} className="flex min-h-12 items-center gap-2 py-2 hover:text-pep">
                      <FilePen className="size-4 shrink-0 text-erp-ink" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-semibold">{d.name}</span>
                      <span className="text-xs text-ink-soft">{d.startedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel title="Atalhos">
            <ul className="space-y-1">
              {can.read || can.summary || can.docs ? (
                <li>
                  <Link href="/prontuario" className="flex min-h-11 items-center gap-2 rounded-xl px-2 font-semibold hover:bg-fog">
                    <Search className="size-4 text-pep" aria-hidden />
                    Buscar paciente
                  </Link>
                </li>
              ) : null}
              {ctx.can("prontuario.modelos") ? (
                <li>
                  <Link href="/prontuario/modelos" className="flex min-h-11 items-center gap-2 rounded-xl px-2 font-semibold hover:bg-fog">
                    <ClipboardList className="size-4 text-pep" aria-hidden />
                    Modelos e ajustes
                  </Link>
                </li>
              ) : null}
              {ctx.hasCrm && ctx.can("agenda.ver") ? (
                <li>
                  <Link href="/crm/agenda" className="flex min-h-11 items-center gap-2 rounded-xl px-2 font-semibold hover:bg-fog">
                    <Stethoscope className="size-4 text-pep" aria-hidden />
                    Agenda completa
                  </Link>
                </li>
              ) : null}
            </ul>
            {!ctx.user.healthProfessional ? (
              <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
                Você vê a situação dos atendimentos. O conteúdo clínico é só de profissionais de saúde (registro no conselho), conforme o sigilo profissional e a LGPD.
              </p>
            ) : null}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

type Can = { attend: boolean; read: boolean; triage: boolean; summary: boolean; docs: boolean; arrive: boolean };

function waited(row: DayRow, nowMs: number): string | null {
  if (!row.arrivedAt || (row.status !== "chegou" && row.status !== "triado")) return null;
  const min = Math.max(0, Math.round((nowMs - row.arrivedAt.getTime()) / 60_000));
  return min < 60 ? `esperando há ${min} min` : `esperando há ${Math.floor(min / 60)} h ${min % 60} min`;
}

function patientLink(row: DayRow, can: Can) {
  return can.read || can.summary || can.docs || can.triage ? `/prontuario/pacientes/${row.contact.id}` : null;
}

function Actions({ row, can, isToday, mine, nowMs }: { row: DayRow; can: Can; isToday: boolean; mine: boolean; nowMs: number }) {
  const triageOpen = isToday && can.triage && (row.status === "aguardando" || row.status === "chegou" || row.status === "triado") && !row.contact.anonymized;
  // "Chegou" / "Desfazer" (regra em packages/core/src/crm/arrival.ts)
  const arrival = arrivalAction({ flow: row.status, isToday, canMark: can.arrive, anonymized: row.contact.anonymized });
  const win = arrivalWindow(row.startsAt, new Date(nowMs));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {arrival ? (
        <ArrivalButton mode={arrival} appointmentId={row.appointmentId} version={row.version} patient={row.contact.name} opensAt={arrival === "chegou" && !win.open ? formatTime(win.opensAt) : null} />
      ) : null}
      {triageOpen ? (
        <TriageButton compact appointmentId={row.appointmentId} patient={row.contact.name} age={ageYears(row.contact.birthDate)} initial={row.triage ? { complaint: row.triage.complaint, vitals: row.triage.vitals, priority: row.triage.priority, notes: row.triage.notes } : null} />
      ) : null}
      {row.encounterId && (can.read || mine) ? (
        <Link href={`/prontuario/atendimentos/${row.encounterId}`} className="inline-flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-pep hover:bg-pep-tint">
          {row.status === "finalizado" ? "Ver" : "Continuar"}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : can.attend && mine && row.status !== "faltou" && !row.contact.anonymized ? (
        <StartEncounterButton contactId={row.contact.id} appointmentId={row.appointmentId} label="Atender" variant={row.status === "chegou" || row.status === "triado" ? "primary" : "secondary"} />
      ) : null}
    </div>
  );
}

function PatientRow({ row, nowMs, can, isToday, showPro, showUnit, mine }: { row: DayRow; nowMs: number; can: Can; isToday: boolean; showPro: boolean; showUnit: boolean; mine: boolean }) {
  const age = ageYears(row.contact.birthDate);
  const link = patientLink(row, can);
  const wait = waited(row, nowMs);
  const priority = row.triage && row.triage.priority !== "normal" ? row.triage.priority : null;
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 py-3",
        row.status === "finalizado" || row.status === "faltou" ? "opacity-70" : "",
        // Triagem urgente ainda esperando: linha destacada em vermelho
        priority === "urgente" && row.status !== "finalizado" && row.status !== "em_atendimento" && row.status !== "faltou" ? "-mx-2 rounded-xl bg-alert-tint px-2 ring-1 ring-alert/30" : "",
      )}
    >
      <time className="w-12 shrink-0 font-display text-lg font-bold tabular" dateTime={row.startsAt.toISOString()}>
        {formatTime(row.startsAt)}
      </time>
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-1.5">
          {link ? (
            <Link href={link} className="truncate font-semibold hover:underline">
              {row.contact.name}
            </Link>
          ) : (
            <span className="truncate font-semibold">{row.contact.name}</span>
          )}
          {can.summary && row.hasAllergy ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-alert-tint px-1.5 py-0.5 text-[0.7rem] font-bold text-alert" title="Tem alergia registrada">
              <AlertTriangle className="size-3" aria-hidden />
              Alergia
            </span>
          ) : null}
          {priority ? <Badge tone={priority === "urgente" ? "alert" : "warning"}>{PRIORITY_LABEL[priority]}</Badge> : null}
        </p>
        <p className="truncate text-sm text-ink-soft">
          {[age !== null ? `${age} anos` : null, row.service, showPro ? row.professional.name : null, wait].filter(Boolean).join(", ")}
        </p>
        {row.room || showUnit ? (
          <p className="flex items-start gap-1 text-sm text-ink-soft">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {[showUnit ? row.unit.name : null, row.room?.name ?? "Sem consultório"].filter(Boolean).join(", ")}
          </p>
        ) : null}
        {row.triage?.complaint && (can.triage || can.read) ? <p className="truncate text-sm">Queixa: {row.triage.complaint}</p> : null}
      </div>
      <Badge tone={FLOW_TONE[row.status]}>{FLOW_LABEL[row.status]}</Badge>
      <Actions row={row} can={can} isToday={isToday} mine={mine} nowMs={nowMs} />
    </li>
  );
}

function NextCard({ row, nowMs, can, mine }: { row: DayRow; nowMs: number; can: Can; mine: boolean }) {
  const age = ageYears(row.contact.birthDate);
  const wait = waited(row, nowMs);
  const urgent = row.triage?.priority === "urgente";
  return (
    <section aria-label="Próximo paciente" className={cn("rounded-2xl p-4 ring-1 sm:p-5", urgent ? "bg-alert-tint ring-alert/40" : "bg-pep-tint ring-pep/30")}>
      <p className={cn("text-sm font-semibold", urgent ? "text-alert" : "text-pep-ink")}>{row.status === "aguardando" ? "Próximo horário" : urgent ? "Próximo paciente: urgente" : "Próximo paciente"}</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">{row.contact.name}</h2>
          <p className="text-ink-soft">{[formatTime(row.startsAt), age !== null ? `${age} anos` : null, row.service, wait].filter(Boolean).join(", ")}</p>
          {row.room ? (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-paper/70 px-2.5 py-0.5 text-sm font-semibold">
              <DoorOpen className="size-4" aria-hidden />
              {row.room.name}
            </p>
          ) : null}
          {row.triage?.complaint && (can.triage || can.read) ? <p className="mt-1">Queixa: {row.triage.complaint}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Próximo horário ainda sem chegada: "Chegou" também no destaque (clínica sem recepção) */}
          {row.status === "aguardando" && can.arrive && !row.contact.anonymized ? (
            <ArrivalButton
              mode="chegou"
              appointmentId={row.appointmentId}
              version={row.version}
              patient={row.contact.name}
              opensAt={arrivalWindow(row.startsAt, new Date(nowMs)).open ? null : formatTime(arrivalWindow(row.startsAt, new Date(nowMs)).opensAt)}
            />
          ) : null}
          {mine && can.attend && !row.encounterId && !row.contact.anonymized ? <StartEncounterButton contactId={row.contact.id} appointmentId={row.appointmentId} label="Iniciar atendimento" variant="sun" /> : null}
          {row.encounterId ? (
            <Link href={`/prontuario/atendimentos/${row.encounterId}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sun px-4 text-sm font-semibold text-ink hover:bg-sun-strong">
              Continuar atendimento
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? "rounded-xl bg-night px-3 py-2 text-white" : "rounded-xl bg-paper px-3 py-2 ring-1 ring-line"}>
      <dt className={strong ? "truncate text-xs text-white/75" : "truncate text-xs text-ink-soft"}>{label}</dt>
      <dd className="font-display text-2xl font-bold tabular">{value}</dd>
    </div>
  );
}
