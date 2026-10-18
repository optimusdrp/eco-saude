"use client";

import { addDaysIso } from "@ecosaude/core/crm";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  List,
  Printer,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  MessageCircleQuestion,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton, ScheduleButton } from "@/components/crm/widgets";
import { Dialog } from "@/components/ui";
import { colorOf } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { useNow } from "@/lib/hooks";
import { requestConfirmationsAction } from "@/modules/crm/actions/agenda";
import { AppointmentDialog } from "../AppointmentDialog";
import { ListView } from "./ListView";
import { MiniCalendar } from "./MiniCalendar";
import { MoveDialog, type PendingMove } from "./MoveDialog";
import { TimeGrid, type ColumnSchedule, type GridColumn } from "./TimeGrid";
import { useAgendaPrefs } from "./usePrefs";
import { hhmm, proDay, PX_PER_MIN, type AgendaData, type AgendaPrefs, type AgendaView, type BoardAppointment, type BoardProfessional } from "./types";

/** Faixa de atendimento do profissional numa data, para a grade (períodos, intervalos, ausência). */
function scheduleOf(p: BoardProfessional, weekday: number, date: string): ColumnSchedule {
  const day = proDay(p, weekday, date);
  if (!day) return { start: 0, end: 0, gaps: [], works: false, offLabel: p.absent[date] };
  return { start: day.start, end: day.end, gaps: day.gaps, works: true };
}

/**
 * AGENDA INTERATIVA
 *
 *  ┌──────────────┬──────────────────────────────────────────────┐
 *  │ mini         │ ‹ Hoje ›  Dia | Semana | Lista   busca  ...  │
 *  │ calendário   ├──────┬───────────────┬───────────────────────┤
 *  │              │ hora │ Dra. Beatriz  │ Dr. Caio   (trilho de │
 *  │ profissionais│ 08:00│ ▓▓ consulta   │            ocupação)  │
 *  │ filtros      │ 09:00│   + livre     │ ▓▓▓▓                  │
 *  │ exibição     │  ... │               │                       │
 *  └──────────────┴──────┴───────────────┴───────────────────────┘
 *
 * Personalização (densidade, cores, filtros, quem aparece) fica salva no
 * navegador de cada pessoa. Atalhos: ← → dia/semana, T hoje, D/S/L visões,
 * N nova consulta, / buscar.
 */

const VIEW_LABEL: Record<AgendaView, string> = { dia: "Dia", semana: "Semana", lista: "Lista" };
const VIEW_ICON = { dia: CalendarDays, semana: CalendarRange, lista: List };
const STATUS_FILTERS = [
  { id: "agendado", label: "Agendadas" },
  { id: "confirmado", label: "Confirmadas" },
  { id: "compareceu", label: "Atendidas" },
  { id: "faltou", label: "Faltas" },
  { id: "cancelado", label: "Canceladas" },
] as const;
type Focus = "risco" | "semResposta" | "primeira" | null;

/** Texto sem acento e em minúsculas, para a busca */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function AgendaBoard({ data, canConfigure }: { data: AgendaData; canConfigure: boolean }) {
  const router = useRouter();
  const [prefs, setPrefs, resetPrefs] = useAgendaPrefs();
  const [selectedId, setSelectedId] = useState<string | null>(data.openId ?? null);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<Focus>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Relógio: a linha do "agora" anda sozinha
  const liveNow = useNow(30_000);
  const nowMin = data.nowMin + Math.max(0, Math.floor((liveNow - data.serverNowMs) / 60_000));

  const href = (date: string, view: AgendaView = data.view) => `/crm/agenda?data=${date}${view !== "dia" ? `&visao=${view}` : ""}`;
  const step = data.view === "semana" ? 7 : 1;
  const prevHref = href(addDaysIso(data.date, -step));
  const nextHref = href(addDaysIso(data.date, step));

  /* ------------------------------ Filtros ------------------------------ */
  const visiblePros = data.professionals.filter((p) => !prefs.hiddenProfessionals.includes(p.id));
  const proById = useMemo(() => new Map(data.professionals.map((p) => [p.id, p])), [data.professionals]);
  const proColor = (id: string) => proById.get(id)?.color ?? "crm";

  const appts = data.appointments.filter((a) => {
    if (prefs.hiddenProfessionals.includes(a.professionalId)) return false;
    if (prefs.statusFilter.length) return prefs.statusFilter.includes(a.status);
    return prefs.showCancelled || a.status !== "cancelado";
  });

  // Destaque: busca por nome/serviço, ou um dos "focos" do resumo
  const highlight = useMemo(() => {
    const term = plain(q.trim());
    if (!term && !focus) return null;
    const ids = new Set<string>();
    for (const a of appts) {
      const byText = term && (plain(a.contactName).includes(term) || plain(a.service ?? "").includes(term));
      const byFocus =
        (focus === "risco" && a.risk?.level === "alto") ||
        (focus === "semResposta" && a.status === "agendado" && a.confirmationRequested) ||
        (focus === "primeira" && a.firstVisit && a.status !== "cancelado");
      // Busca + foco juntos: precisa atender aos dois
      if (term && focus ? byText && byFocus : term ? byText : byFocus) ids.add(a.id);
    }
    return ids;
  }, [q, focus, appts]);

  /* ------------------------- Faixa de horas exibida ------------------------- */
  const range = useMemo(() => {
    // Todos os dias de atendimento exibidos (cada profissional pode ter horários diferentes por dia)
    const open = visiblePros.flatMap((p) => data.days.map((d) => proDay(p, d.weekday, d.date)).filter((x) => x !== null));
    let start = prefs.workHoursOnly ? Math.min(...open.map((x) => x.start), 8 * 60) : 6 * 60;
    let end = prefs.workHoursOnly ? Math.max(...open.map((x) => x.end), 18 * 60) : 22 * 60;
    for (const a of appts) {
      start = Math.min(start, a.startMin);
      end = Math.max(end, a.endMin);
    }
    return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
  }, [visiblePros, data.days, appts, prefs.workHoursOnly]);

  /* -------------------------- Horários livres -------------------------- */
  const freeFor = (p: BoardProfessional, date: string, weekday: number, isToday: boolean, isPast: boolean) => {
    const day = proDay(p, weekday, date);
    if (!prefs.showFree || !data.canEdit || isPast || !day) return [];
    const busy = data.appointments.filter((a) => a.professionalId === p.id && a.date === date && a.status !== "cancelado");
    const out: { min: number; length: number; waiting: number }[] = [];
    for (const block of day.periods) {
      for (let m = block.start; m + day.slot <= block.end; m += day.slot) {
        if (isToday && m <= nowMin) continue;
        if (busy.some((a) => a.startMin < m + day.slot && m < a.endMin)) continue;
        const waiting = data.waitlist.filter(
          (w) => (w.professionalId === null || w.professionalId === p.id) && (w.period === "qualquer" || (w.period === "manha" ? m < 720 : m >= 720)),
        ).length;
        out.push({ min: m, length: day.slot, waiting });
      }
    }
    return out;
  };

  const occupancyFor = (p: BoardProfessional, date: string, weekday: number, free: number) => {
    const day = proDay(p, weekday, date);
    const available = day ? day.periods.reduce((s, x) => s + (x.end - x.start), 0) : 0;
    const busy = data.appointments
      .filter((a) => a.professionalId === p.id && a.date === date && a.status !== "cancelado")
      .map((a) => [Math.max(a.startMin, day?.start ?? 0), Math.min(a.endMin, day?.end ?? 0)] as [number, number])
      .filter(([a, b]) => b > a);
    const used = busy.reduce((s, [a, b]) => s + (b - a), 0);
    return { pct: available > 0 ? Math.min(100, Math.round((used / available) * 100)) : 0, busy, free };
  };

  /* ------------------------------ Colunas ------------------------------ */
  const columns: GridColumn[] = useMemo(() => {
    if (data.view === "dia") {
      const d = data.days[0]!;
      return visiblePros.map((p) => {
        const free = freeFor(p, d.date, d.weekday, d.isToday, d.isPast);
        return {
          key: p.id,
          date: d.date,
          professionalId: p.id,
          title: p.name,
          slotLabel: `com ${p.name}`,
          subtitle: p.specialty ?? undefined,
          dot: colorOf(p.color).dot,
          schedule: scheduleOf(p, d.weekday, d.date),
          appointments: appts.filter((a) => a.professionalId === p.id),
          freeSlots: free,
          isToday: d.isToday,
          occupancy: occupancyFor(p, d.date, d.weekday, free.length),
        };
      });
    }
    // Semana: uma coluna por dia
    const single = visiblePros.length === 1 ? visiblePros[0]! : null;
    return data.days.map((d) => {
      const working = visiblePros.map((p) => proDay(p, d.weekday, d.date)).filter((x) => x !== null);
      const schedule: ColumnSchedule = single
        ? scheduleOf(single, d.weekday, d.date)
        : working.length
          ? { start: Math.min(...working.map((x) => x.start)), end: Math.max(...working.map((x) => x.end)), gaps: [], works: true }
          : { start: range.start, end: range.start, gaps: [], works: false };
      return {
        key: d.date,
        date: d.date,
        professionalId: single?.id ?? null,
        title: d.isToday ? `Hoje, ${d.label}` : d.label,
        slotLabel: `em ${d.label}${single ? ` com ${single.name}` : ""}`,
        subtitle: `${appts.filter((a) => a.date === d.date && a.status !== "cancelado").length} consulta(s)`,
        schedule,
        appointments: appts.filter((a) => a.date === d.date),
        freeSlots: single ? freeFor(single, d.date, d.weekday, d.isToday, d.isPast) : [],
        isToday: d.isToday,
      };
    });
    // freeFor/occupancyFor dependem dos mesmos dados listados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visiblePros, appts, prefs.showFree, nowMin, range.start]);

  /* -------------------------- Resumo do período -------------------------- */
  const active = data.appointments.filter((a) => a.status !== "cancelado" && !prefs.hiddenProfessionals.includes(a.professionalId));
  const summary = {
    total: active.length,
    confirmed: active.filter((a) => a.status === "confirmado").length,
    toConfirm: active.filter((a) => a.status === "agendado" && !a.confirmationRequested && a.future),
    noAnswer: active.filter((a) => a.status === "agendado" && a.confirmationRequested).length,
    risk: active.filter((a) => a.risk?.level === "alto").length,
    first: active.filter((a) => a.firstVisit).length,
    noShow: active.filter((a) => a.status === "faltou").length,
  };

  /* ------------------------------ Ações ------------------------------ */
  const canDrag = (a: BoardAppointment) => data.canEdit && (a.status === "agendado" || a.status === "confirmado") && a.future;

  const onDrop = (a: BoardAppointment, col: GridColumn, min: number) => {
    const targetPro = col.professionalId ?? a.professionalId;
    const day = data.days.find((d) => d.date === col.date)!;
    if (day.isPast || (day.isToday && min <= nowMin)) {
      setNotice("Não dá para remarcar para um horário que já passou.");
      return;
    }
    if (targetPro === a.professionalId && col.date === a.date && min === a.startMin) return;
    setNotice(null);
    setMove({ appt: a, professionalId: targetPro, professionalName: proById.get(targetPro)?.name ?? "", date: col.date, dayLabel: day.label, startMin: min });
  };

  // Atalhos de teclado (ignorados enquanto se digita ou com diálogo aberto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      const go = (url: string) => {
        e.preventDefault();
        router.push(url);
      };
      if (e.key === "ArrowLeft") go(prevHref);
      else if (e.key === "ArrowRight") go(nextHref);
      else if (e.key === "t" || e.key === "T") go(href(data.today));
      else if (e.key === "d" || e.key === "D") go(href(data.date, "dia"));
      else if (e.key === "s" || e.key === "S") go(href(data.date, "semana"));
      else if (e.key === "l" || e.key === "L") go(href(data.date, "lista"));
      else if ((e.key === "n" || e.key === "N") && data.canEdit) {
        e.preventDefault();
        emit("eco:open-schedule", { date: data.date });
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selected = data.appointments.find((a) => a.id === selectedId) ?? null;
  const day0 = data.days[0]!;
  const periodLabel =
    data.view === "semana"
      ? `${data.days[0]!.label} a ${data.days[6]!.label}`
      : day0.isToday
        ? `Hoje, ${day0.label}`
        : day0.date === addDaysIso(data.today, 1)
          ? `Amanhã, ${day0.label}`
          : day0.date === addDaysIso(data.today, -1)
            ? `Ontem, ${day0.label}`
            : day0.label;
  // Abre no "agora" (hoje) ou um pouco antes da primeira consulta do período
  const scrollToMin = data.days.some((d) => d.isToday)
    ? Math.max(range.start, nowMin - 60)
    : appts.length
      ? Math.max(range.start, Math.min(...appts.map((a) => a.startMin)) - 30)
      : range.start;

  const sidebar = (
    <Sidebar
      data={data}
      prefs={prefs}
      setPrefs={setPrefs}
      resetPrefs={resetPrefs}
      href={href}
      summary={summary}
      focus={focus}
      setFocus={setFocus}
      canConfigure={canConfigure}
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-5">
      {/* --------------------------- Painel lateral --------------------------- */}
      <aside className="hidden lg:block print:hidden" aria-label="Calendário, filtros e personalização">
        {/* Rola por conta própria: o painel nunca fica cortado em telas baixas */}
        <div className="thin-scroll sticky top-[4.5rem] max-h-[calc(100dvh-5.5rem)] space-y-4 overflow-y-auto pr-1 pb-4">{sidebar}</div>
      </aside>

      <div className="min-w-0">
        {/* ------------------------------ Barra ------------------------------ */}
        <header className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex items-center gap-1 rounded-xl bg-paper p-1 ring-1 ring-line">
            <Link href={prevHref} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-fog" aria-label={data.view === "semana" ? "Semana anterior" : "Dia anterior"}>
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
            <Link href={href(data.today)} className={cn("inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold hover:bg-fog", data.days.some((d) => d.isToday) && "text-crm")}>
              Hoje
            </Link>
            <Link href={nextHref} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-fog" aria-label={data.view === "semana" ? "Próxima semana" : "Próximo dia"}>
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </div>
          <h1 className="order-first min-w-0 basis-full truncate font-display sm:order-none sm:flex-1 sm:basis-auto text-xl font-bold first-letter:uppercase sm:text-2xl">{periodLabel}</h1>

          <nav aria-label="Visão" className="flex rounded-xl bg-paper p-1 ring-1 ring-line">
            {(Object.keys(VIEW_LABEL) as AgendaView[]).map((v) => {
              const Icon = VIEW_ICON[v];
              return (
                <Link
                  key={v}
                  href={href(data.date, v)}
                  aria-current={data.view === v ? "page" : undefined}
                  className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", data.view === v ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{VIEW_LABEL[v]}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
            <label htmlFor="agenda-q" className="sr-only">
              Buscar paciente ou serviço na agenda
            </label>
            <input
              ref={searchRef}
              id="agenda-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && highlight?.size) {
                  // Sem isto o "Enter" segue para o botão Fechar do diálogo recém-aberto e o fecha
                  e.preventDefault();
                  setSelectedId([...highlight][0]!);
                }
                if (e.key === "Escape") setQ("");
              }}
              placeholder="Buscar paciente ou serviço (/)"
              className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
            />
          </div>
          {q && highlight ? (
            <span className="text-sm text-ink-soft" role="status">
              {highlight.size} encontrada(s){highlight.size ? ". Enter abre a primeira." : ""}
            </span>
          ) : null}
          <button type="button" onClick={() => setPanelOpen(true)} className={buttonStyles("secondary", "lg:hidden")}>
            <SlidersHorizontal className="size-4" aria-hidden /> Filtros e exibição
          </button>
          {data.view === "dia" && summary.toConfirm.length && data.features.confirmations && data.canEdit ? (
            <ActionButton
              action={requestConfirmationsAction}
              multi={{ appointmentId: summary.toConfirm.map((a) => a.id) }}
              label={`Pedir confirmação (${summary.toConfirm.length})`}
              pendingText="Enviando..."
              variant="secondary"
            />
          ) : null}
          <button type="button" onClick={() => window.print()} className={buttonStyles("ghost")} title="Imprime a agenda do período em formato de lista">
            <Printer className="size-4" aria-hidden /> <span className="hidden sm:inline">Imprimir</span>
          </button>
          {data.canEdit ? <ScheduleButton label="Nova consulta" /> : null}
        </div>

        {notice ? (
          <p role="alert" className="mb-3 rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert print:hidden">
            {notice}
          </p>
        ) : null}

        {data.professionals.length === 0 ? (
          <div className="mb-4 rounded-2xl border border-dashed border-ink/20 px-4 py-8 text-center print:hidden">
            <p className="font-display text-lg font-bold">Nenhum profissional cadastrado</p>
            <p className="mt-1 text-ink-soft">
              A agenda mostra os horários livres a partir do expediente de cada profissional.{" "}
              {canConfigure ? (
                <Link href="/configuracoes/clinica" className="font-semibold text-crm hover:underline">
                  Cadastrar profissionais
                </Link>
              ) : (
                "Peça à gestão da clínica para cadastrar."
              )}
            </p>
          </div>
        ) : visiblePros.length === 0 ? (
          <p className="mb-3 rounded-xl bg-erp-tint px-3 py-2 text-sm print:hidden">Todos os profissionais estão ocultos. Mostre ao menos um em “Profissionais”.</p>
        ) : null}

        {/* ------------------------------ Visões ------------------------------ */}
        {data.view === "lista" ? (
          <ListView days={data.days} appointments={appts} proColor={proColor} highlight={highlight} onOpen={setSelectedId} printTitle={`Agenda: ${periodLabel}`} />
        ) : (
          <>
            {/* Grade a partir do tablet; no celular, a lista (a grade não cabe) */}
            <div className={cn(data.view === "dia" ? "hidden md:block" : "")}>
              <TimeGrid
                columns={columns}
                range={range}
                px={PX_PER_MIN[prefs.density]}
                nowMin={nowMin}
                colorBy={data.view === "semana" && visiblePros.length > 1 ? "profissional" : prefs.colorBy}
                proColor={proColor}
                highlight={highlight}
                canDrag={canDrag}
                onOpen={setSelectedId}
                onFreeClick={(col, min) => emit("eco:open-schedule", { professionalId: col.professionalId ?? undefined, date: col.date, time: hhmm(min) })}
                onDrop={onDrop}
                scrollToMin={scrollToMin}
                columnMinWidth={data.view === "semana" ? "9.5rem" : "12rem"}
              />
              {data.canEdit ? (
                <p className="mt-2 hidden text-xs text-ink-soft md:block print:hidden">
                  Arraste uma consulta para outro horário{data.view === "dia" ? " ou profissional" : " ou dia"} para remarcar. Toque num espaço livre para agendar.
                </p>
              ) : null}
            </div>
            {data.view === "dia" ? (
              <div className="space-y-3 md:hidden">
                <ListView days={data.days} appointments={appts} proColor={proColor} highlight={highlight} onOpen={setSelectedId} printTitle="" />
                <MobileFree columns={columns} />
              </div>
            ) : null}
            {/* Versão para impressão (sempre em lista) */}
            <ListView className="hidden print:block" days={data.days} appointments={appts} proColor={proColor} highlight={null} onOpen={() => undefined} printTitle={`Agenda: ${periodLabel}`} />
          </>
        )}
      </div>

      {/* Filtros no celular/tablet */}
      <Dialog open={panelOpen} onClose={() => setPanelOpen(false)} title="Filtros e exibição">
        <div className="space-y-4">{sidebar}</div>
      </Dialog>

      <AppointmentDialog
        appt={selected}
        onClose={() => setSelectedId(null)}
        canEdit={data.canEdit}
        features={data.features}
        professionals={data.professionals.map((p) => ({ id: p.id, name: p.name }))}
        today={data.today}
      />
      <MoveDialog move={move} onClose={() => setMove(null)} waitlistEnabled={data.features.waitlist} />
    </div>
  );
}

/* ---------------------------------------------------------------------------- */

function Sidebar({
  data,
  prefs,
  setPrefs,
  resetPrefs,
  href,
  summary,
  focus,
  setFocus,
  canConfigure,
}: {
  data: AgendaData;
  prefs: AgendaPrefs;
  setPrefs: (p: Partial<AgendaPrefs>) => void;
  resetPrefs: () => void;
  href: (date: string, view?: AgendaView) => string;
  summary: { total: number; confirmed: number; toConfirm: unknown[]; noAnswer: number; risk: number; first: number; noShow: number };
  focus: Focus;
  setFocus: (f: Focus) => void;
  canConfigure: boolean;
}) {
  const toggleFocus = (f: Exclude<Focus, null>) => setFocus(focus === f ? null : f);
  return (
    <>
      <section className="rounded-2xl bg-paper p-3 ring-1 ring-line">
        <MiniCalendar date={data.date} today={data.today} counts={data.monthCounts} hrefFor={(d) => href(d)} rangeDates={data.days.map((d) => d.date)} />
      </section>

      {/* Resumo: cada linha destaca as consultas correspondentes na grade */}
      <section className="rounded-2xl bg-paper p-3 ring-1 ring-line" aria-label="Resumo do período">
        <p className="font-display text-3xl font-bold tabular">
          {summary.total}
          <span className="ml-1.5 align-middle font-sans text-sm font-normal text-ink-soft">consultas, {summary.confirmed} confirmadas</span>
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          <FocusRow active={focus === "risco"} onClick={() => toggleFocus("risco")} icon={<TriangleAlert className="size-4 text-alert" aria-hidden />} label="Risco alto de falta" n={summary.risk} />
          <FocusRow
            active={focus === "semResposta"}
            onClick={() => toggleFocus("semResposta")}
            icon={<MessageCircleQuestion className="size-4 text-erp-ink" aria-hidden />}
            label="Confirmação sem resposta"
            n={summary.noAnswer}
          />
          <FocusRow active={focus === "primeira"} onClick={() => toggleFocus("primeira")} icon={<Sparkles className="size-4 text-crm" aria-hidden />} label="Primeira consulta" n={summary.first} />
        </ul>
        {summary.noShow ? <p className="mt-2 text-xs text-ink-soft">{summary.noShow} falta(s) no período.</p> : null}
      </section>

      <section className="rounded-2xl bg-paper p-3 ring-1 ring-line" aria-label="Profissionais">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="font-sans text-sm font-bold">Profissionais</h2>
          {canConfigure ? (
            <Link href="/configuracoes/clinica" className="text-xs font-semibold text-crm hover:underline">
              Horários
            </Link>
          ) : null}
        </div>
        <ul className="space-y-0.5">
          {data.professionals.map((p) => {
            const hidden = prefs.hiddenProfessionals.includes(p.id);
            return (
              <li key={p.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 hover:bg-fog">
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={() =>
                      setPrefs({ hiddenProfessionals: hidden ? prefs.hiddenProfessionals.filter((x) => x !== p.id) : [...prefs.hiddenProfessionals, p.id] })
                    }
                    className="size-4 accent-[var(--color-crm)]"
                  />
                  <span className={cn("size-2.5 shrink-0 rounded-full", colorOf(p.color).dot)} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
                  <span className="text-xs text-ink-soft tabular">{data.appointments.filter((a) => a.professionalId === p.id && a.status !== "cancelado").length}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {data.professionals.length > 1 ? (
          <div className="mt-1 flex gap-3 px-1.5 text-xs">
            <button type="button" onClick={() => setPrefs({ hiddenProfessionals: [] })} className="min-h-8 font-semibold text-crm hover:underline">
              Mostrar todos
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-paper p-3 ring-1 ring-line" aria-label="Situação das consultas">
        <h2 className="mb-1.5 font-sans text-sm font-bold">Situação</h2>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => {
            const on = prefs.statusFilter.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setPrefs({ statusFilter: on ? prefs.statusFilter.filter((x) => x !== s.id) : [...prefs.statusFilter, s.id] })}
                className={cn("min-h-9 rounded-full px-3 text-xs font-semibold ring-1", on ? "bg-ink text-white ring-ink" : "bg-paper ring-line hover:ring-ink/30")}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-ink-soft">{prefs.statusFilter.length ? "Mostrando só as marcadas." : "Nenhuma marcada: mostra todas (canceladas conforme a opção abaixo)."}</p>
      </section>

      <section className="rounded-2xl bg-paper p-3 ring-1 ring-line" aria-label="Exibição">
        <h2 className="mb-2 font-sans text-sm font-bold">Exibição</h2>
        <p className="text-xs font-semibold text-ink-soft">Altura dos horários</p>
        <div className="mt-1 mb-3 grid grid-cols-3 rounded-xl bg-fog p-1 text-xs font-semibold">
          {(["compacta", "confortavel", "ampla"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={prefs.density === d}
              onClick={() => setPrefs({ density: d })}
              className={cn("min-h-9 rounded-lg", prefs.density === d ? "bg-paper shadow-sm ring-1 ring-line" : "text-ink-soft")}
            >
              {d === "compacta" ? "Compacta" : d === "confortavel" ? "Média" : "Ampla"}
            </button>
          ))}
        </div>
        <p className="text-xs font-semibold text-ink-soft">Cor das consultas</p>
        <div className="mt-1 mb-3 grid grid-cols-2 rounded-xl bg-fog p-1 text-xs font-semibold">
          {(["status", "profissional"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={prefs.colorBy === c}
              onClick={() => setPrefs({ colorBy: c })}
              className={cn("min-h-9 rounded-lg", prefs.colorBy === c ? "bg-paper shadow-sm ring-1 ring-line" : "text-ink-soft")}
            >
              {c === "status" ? "Pela situação" : "Pelo profissional"}
            </button>
          ))}
        </div>
        <Toggle label="Mostrar horários livres" checked={prefs.showFree} onChange={(v) => setPrefs({ showFree: v })} />
        <Toggle label="Mostrar canceladas" checked={prefs.showCancelled} onChange={(v) => setPrefs({ showCancelled: v })} />
        <Toggle label="Só o horário de atendimento" checked={prefs.workHoursOnly} onChange={(v) => setPrefs({ workHoursOnly: v })} />
        <button type="button" onClick={resetPrefs} className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-ink-soft hover:text-ink">
          <RotateCcw className="size-3.5" aria-hidden /> Voltar ao padrão
        </button>
        <p className="mt-1 text-xs text-ink-soft">Fica salvo neste navegador, só para você.</p>
      </section>

      <details className="hidden rounded-2xl bg-paper p-3 ring-1 ring-line lg:block">
        <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-bold">
          <Keyboard className="size-4" aria-hidden /> Atalhos de teclado
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {[
            ["← →", "dia ou semana anterior/seguinte"],
            ["T", "hoje"],
            ["D S L", "dia, semana, lista"],
            ["N", "nova consulta"],
            ["/", "buscar"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded bg-fog px-1.5 py-0.5 font-sans font-semibold ring-1 ring-line">{k}</kbd>
              </dt>
              <dd className="text-ink-soft">{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}

function FocusRow({ active, onClick, icon, label, n }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; n: number }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={n === 0}
        aria-pressed={active}
        className={cn("flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left disabled:opacity-50", active ? "bg-crm-tint font-semibold" : "hover:bg-fog")}
      >
        {icon}
        <span className="flex-1">{label}</span>
        <span className="font-bold tabular">{n}</span>
      </button>
    </li>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-sm">
      {label}
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--color-crm)]" />
    </label>
  );
}

/** Celular: próximos horários livres de cada profissional, em botões. */
function MobileFree({ columns }: { columns: GridColumn[] }) {
  const withFree = columns.filter((c) => c.freeSlots.length);
  if (!withFree.length) return null;
  return (
    <section className="rounded-2xl bg-paper p-3 ring-1 ring-line" aria-label="Horários livres">
      <h2 className="mb-2 font-sans text-sm font-bold">Horários livres</h2>
      <div className="space-y-3">
        {withFree.map((c) => (
          <div key={c.key}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className={cn("size-2.5 rounded-full", c.dot)} aria-hidden /> {c.title}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {c.freeSlots.slice(0, 8).map((f) => (
                <button
                  key={f.min}
                  type="button"
                  onClick={() => emit("eco:open-schedule", { professionalId: c.professionalId ?? undefined, date: c.date, time: hhmm(f.min) })}
                  className="inline-flex min-h-10 items-center gap-1 rounded-full bg-crm-tint px-3 text-sm font-semibold text-crm"
                >
                  {hhmm(f.min)}
                  {f.waiting ? <span className="text-xs text-erp-ink">({f.waiting})</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
