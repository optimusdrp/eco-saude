"use client";

/**
 * PAINEL HOJE (cliente)
 *
 * Estrutura:
 *   Cabeçalho  -> saudação, data e hora ao vivo, resumo em uma frase,
 *                 modelo (Recepção/Gestão), Personalizar, Nova consulta
 *   Números    -> 5 indicadores clicáveis (levam ao quadro ou à tela certa)
 *   Quadros    -> duas colunas (principal e lateral) que cada pessoa escolhe,
 *                 ordena, recolhe e oculta (salvo no navegador)
 *
 * O relógio anda no navegador (useLiveNow) e os dados se renovam a cada 30 s
 * (AutoRefresh), então "atrasado", "em consulta" e "próximos" mudam sozinhos.
 */
import { CalendarCheck2, CalendarClock, CalendarPlus, MessagesSquare, Settings2, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AppointmentDialog } from "@/components/crm/agenda/AppointmentDialog";
import { AutoRefresh } from "@/components/crm/widgets";
import { cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { useLiveNow } from "@/lib/hooks";
import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { waitLabel } from "@/modules/crm/format";
import { ActionQueue } from "./ActionQueue";
import { Customize } from "./Customize";
import { DayRuler } from "./DayRuler";
import { freeSlotsFor, WidgetCard } from "./parts";
import { Reception } from "./Reception";
import { Birthdays, FreeToday, Pulse, Tomorrow } from "./SideWidgets";
import { DEFAULT_TODAY_PREFS, hhmm, normalizeLayout, PRESETS, WIDGETS, type PresetId, type TodayData, type WidgetId } from "./types";

export function TodayBoard({ data }: { data: TodayData }) {
  const [rawPrefs, update, reset] = useStoredPrefs("eco:hoje:prefs:v1", DEFAULT_TODAY_PREFS);
  const prefs = useMemo(() => normalizeLayout(rawPrefs), [rawPrefs]);
  const nowMs = useLiveNow(data.serverNowMs);
  const nowMin = Math.floor((nowMs - data.dayStartMs) / 60_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);

  /* ---------------------------- Números do dia ---------------------------- */
  const appts = data.appointments;
  const attended = appts.filter((a) => a.status === "compareceu").length;
  const missed = appts.filter((a) => a.status === "faltou").length;
  const confirmedToday = appts.filter((a) => a.status === "confirmado").length;
  const urgent = data.waiting.filter((w) => w.urgent).length;
  const oldest = data.waiting.reduce<number | null>((m, w) => (m === null || w.sinceMs < m ? w.sinceMs : m), null);
  const tomorrowConfirmed = data.tomorrow.appointments.filter((a) => a.status === "confirmado").length;
  const slots = useMemo(() => data.professionals.flatMap((p) => freeSlotsFor(p, data.appointments, nowMin, data.waitlist)), [data.professionals, data.appointments, data.waitlist, nowMin]);
  const waitlistTotal = data.waitlist.length;
  const openTasks = data.tasks.length;

  const hour = nowMin / 60;
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const summary = sentence([
    appts.length ? `${appts.length} ${appts.length === 1 ? "consulta" : "consultas"}` : "nenhuma consulta",
    data.waiting.length ? `${data.waiting.length} ${data.waiting.length === 1 ? "conversa esperando" : "conversas esperando"} resposta` : "",
    openTasks ? `${openTasks} ${openTasks === 1 ? "tarefa" : "tarefas"}` : "",
  ]);

  const visible = (id: WidgetId) => !prefs.hidden.includes(id);
  /** Indicador leva ao quadro (se ele está na tela) ou à página completa */
  const target = (id: WidgetId, page: string) => (visible(id) ? `#quadro-${id}` : page);

  /* -------------------------------- Quadros -------------------------------- */
  const collapsed = (id: WidgetId) => prefs.collapsed.includes(id);
  const toggleCollapse = (id: WidgetId) => update({ collapsed: collapsed(id) ? prefs.collapsed.filter((w) => w !== id) : [...prefs.collapsed, id] });

  const widget = (id: WidgetId): ReactNode => {
    const common = { id, title: WIDGETS[id].title, collapsed: collapsed(id), onToggle: () => toggleCollapse(id) };
    switch (id) {
      case "regua":
        return (
          <WidgetCard
            {...common}
            count={appts.length}
            actions={
              <Link href="/crm/agenda" className="text-sm font-semibold text-crm hover:underline">
                Abrir agenda
              </Link>
            }
          >
            <DayRuler
              today={data.today}
              professionals={data.professionals}
              appointments={appts}
              waitlist={data.waitlist}
              nowMin={nowMin}
              canEdit={data.canEdit}
              compact={prefs.compact}
              onOpen={setSelectedId}
            />
          </WidgetCard>
        );
      case "recepcao":
        return (
          <WidgetCard {...common} tone={appts.some((a) => (a.status === "agendado" || a.status === "confirmado") && a.startMin + 10 <= nowMin) ? "alert" : "default"}>
            <Reception data={data} nowMin={nowMin} compact={prefs.compact} onOpen={setSelectedId} />
          </WidgetCard>
        );
      case "acoes":
        return (
          <WidgetCard {...common} count={queueSize(data, prefs.onlyMine, nowMs)}>
            <ActionQueue data={data} nowMs={nowMs} compact={prefs.compact} onlyMine={prefs.onlyMine} onOnlyMine={(v) => update({ onlyMine: v })} onOpen={setSelectedId} />
          </WidgetCard>
        );
      case "amanha":
        return (
          <WidgetCard {...common} title={`Amanhã, ${data.tomorrow.label}`} count={data.tomorrow.appointments.length}>
            <Tomorrow data={data} onOpen={setSelectedId} />
          </WidgetCard>
        );
      case "vagas":
        return (
          <WidgetCard {...common} count={slots.length}>
            <FreeToday data={data} slots={slots} waitlistTotal={waitlistTotal} />
          </WidgetCard>
        );
      case "aniversarios":
        return (
          <WidgetCard {...common} count={data.birthdays.length}>
            <Birthdays data={data} />
          </WidgetCard>
        );
      case "pulso":
        return (
          <WidgetCard {...common}>
            <Pulse data={data} />
          </WidgetCard>
        );
    }
  };

  const main = prefs.main.filter(visible);
  const side = prefs.side.filter(visible);
  const all = [...main, ...side];
  const selected = [...appts, ...data.tomorrow.appointments].find((a) => a.id === selectedId) ?? null;

  return (
    <>
      <AutoRefresh seconds={30} />

      {/* ------------------------------ Cabeçalho ------------------------------ */}
      <header className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-crm first-letter:uppercase">
            {data.dateLabel}, <time className="tabular">{hhmm(Math.max(0, Math.min(nowMin, 1439)))}</time>
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {greeting}, {data.firstName}
          </h1>
          {data.brief ? (
            /* Resumo da manhã: números do sistema, redação da IA (ou das regras, se ela falhar) */
            <p className="mt-1 max-w-3xl text-ink first-letter:uppercase" aria-live="polite">
              {data.brief.text}{" "}
              <span
                className="inline-flex items-center gap-1 align-middle text-xs font-semibold text-ink-soft"
                title={data.brief.source === "ia" ? "Redigido pela IA a partir dos números do sistema" : "Montado pelas regras do CRM"}
              >
                {data.brief.source === "ia" ? <Sparkles className="size-3" aria-hidden /> : null}
                {data.brief.pending ? "a IA está revisando" : data.brief.source === "ia" ? "resumo da IA" : ""}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-ink-soft first-letter:uppercase">{summary}.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Modelo do painel" className="flex rounded-xl bg-paper p-1 ring-1 ring-line">
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={prefs.preset === id}
                onClick={() => update({ ...PRESETS[id].prefs, preset: id })}
                title={PRESETS[id].hint}
                className={cn("inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold", prefs.preset === id ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
              >
                {PRESETS[id].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-paper px-3.5 text-sm font-semibold ring-1 ring-line hover:ring-crm"
          >
            <Settings2 className="size-4" aria-hidden />
            Personalizar
          </button>
          {data.canEdit ? (
            <button
              type="button"
              onClick={() => emit("eco:open-schedule", { date: data.today })}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-crm px-3.5 text-sm font-semibold text-white hover:bg-crm/90"
            >
              <CalendarPlus className="size-4" aria-hidden />
              Nova consulta
            </button>
          ) : null}
        </div>
      </header>

      {/* ------------------------------- Números ------------------------------- */}
      <nav aria-label="Números do dia" className="thin-scroll mb-6 overflow-x-auto pb-1">
        <ul className="grid min-w-[44rem] grid-cols-5 gap-2 lg:min-w-0">
          <Kpi
            href={target("recepcao", "/crm/agenda")}
            icon={<CalendarCheck2 className="size-4" aria-hidden />}
            label="Consultas hoje"
            value={appts.length}
            detail={
              appts.length
                ? `${attended} atendidos, ${confirmedToday} confirmados${missed ? `, ${missed} ${missed === 1 ? "falta" : "faltas"}` : ""}`
                : data.nextDay
                  ? `próximas: ${data.nextDay.label}`
                  : "agenda livre"
            }
            ring={appts.length ? (attended + missed) / appts.length : undefined}
          />
          <Kpi
            href="/crm/conversas"
            icon={<MessagesSquare className="size-4" aria-hidden />}
            label="Esperando resposta"
            value={data.waiting.length}
            detail={urgent ? `${urgent} com alerta de urgência` : oldest !== null ? `a mais antiga há ${waitLabel(new Date(oldest), nowMs)}` : "ninguém esperando"}
            alert={urgent > 0}
          />
          <Kpi
            href={target("amanha", "/crm/agenda")}
            icon={<CalendarClock className="size-4" aria-hidden />}
            label="Amanhã"
            value={data.tomorrow.appointments.length}
            detail={data.tomorrow.appointments.length ? `${tomorrowConfirmed} confirmadas` : "nenhuma consulta"}
            ring={data.tomorrow.appointments.length ? tomorrowConfirmed / data.tomorrow.appointments.length : undefined}
          />
          <Kpi
            href={target("vagas", "/crm/agenda")}
            icon={<CalendarPlus className="size-4" aria-hidden />}
            label="Livres hoje"
            value={slots.length}
            detail={data.features.waitlist ? `${waitlistTotal} na lista de espera` : "horários a partir de agora"}
          />
          <Kpi
            href="/crm/contatos"
            icon={<UserPlus className="size-4" aria-hidden />}
            label="Novos hoje"
            value={data.createdToday.contacts}
            detail={`${data.createdToday.appointments} ${data.createdToday.appointments === 1 ? "consulta marcada" : "consultas marcadas"} hoje`}
          />
        </ul>
      </nav>

      {/* ------------------------------- Quadros ------------------------------- */}
      {all.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/20 px-4 py-10 text-center">
          <p className="font-display text-lg font-bold">Todos os quadros estão ocultos</p>
          <button type="button" onClick={() => setCustomizing(true)} className="mt-2 min-h-10 font-semibold text-crm hover:underline">
            Escolher quadros
          </button>
        </div>
      ) : (
        <div className={cn("grid items-start gap-4", main.length && side.length && "xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]")}>
          {main.length ? (
            <div className="min-w-0 space-y-4">
              {main.map((id) => (
                <div key={id}>{widget(id)}</div>
              ))}
            </div>
          ) : null}
          {side.length ? (
            <div className={cn("min-w-0 space-y-4", main.length && "md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:block xl:space-y-4")}>
              {side.map((id) => (
                <div key={id}>{widget(id)}</div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <Customize open={customizing} onClose={() => setCustomizing(false)} prefs={prefs} update={update} reset={reset} />
      <AppointmentDialog
        appt={selected}
        onClose={() => setSelectedId(null)}
        canEdit={data.canEdit}
        features={{ confirmations: data.features.confirmations && data.perms.confirm, waitlist: data.features.waitlist && data.perms.waitlist, cancel: data.perms.cancel }}
        professionals={data.professionals.map((p) => ({ id: p.id, name: p.name }))}
        today={data.today}
      />
    </>
  );
}

/** Quantos itens a fila de ações tem (para o número no título do quadro) */
function queueSize(data: TodayData, onlyMine: boolean, nowMs: number): number {
  const nowIso = new Date(nowMs).toISOString();
  const risky = [...data.appointments, ...data.tomorrow.appointments].filter(
    (a) => a.risk && a.risk.level !== "baixo" && a.startsAt > nowIso && (a.status === "agendado" || a.status === "confirmado"),
  ).length;
  const confirm = data.features.confirmations && data.perms.confirm && data.tomorrow.appointments.some((a) => a.status === "agendado" && !a.confirmationRequested) ? 1 : 0;
  const tasks = data.tasks.filter((t) => !onlyMine || t.assigneeId === data.userId).length;
  const returns = data.returnsCount && data.features.campaigns ? 1 : 0;
  return data.waiting.length + risky + confirm + tasks + returns;
}

/** ["a", "b", "c"] -> "a, b e c" (ignora vazios) */
function sentence(parts: string[]): string {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] ?? "";
  return `${p.slice(0, -1).join(", ")} e ${p[p.length - 1]}`;
}

/** Indicador clicável; com `ring`, mostra o progresso (0 a 1) num anel */
function Kpi({ href, icon, label, value, detail, alert = false, ring }: { href: string; icon: ReactNode; label: string; value: number; detail: string; alert?: boolean; ring?: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <li className="min-w-0">
      <Link href={href} className={cn("flex h-full items-start gap-3 rounded-2xl bg-paper p-3 ring-1 ring-line transition hover:ring-crm sm:p-4", alert && "ring-2 ring-alert")}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm text-ink-soft">
            {icon}
            <span className="truncate">{label}</span>
          </span>
          <span className={cn("mt-1 block font-display text-3xl font-bold tabular", alert && "text-alert")}>{value}</span>
          <span className="block text-xs text-ink-soft">{detail}</span>
        </span>
        {ring !== undefined ? (
          <svg viewBox="0 0 36 36" className="hidden size-11 shrink-0 -rotate-90 xl:block" role="img" aria-label={`${Math.round(ring * 100)}%`}>
            <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-fog)" strokeWidth="4" />
            <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-crm)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${ring * c} ${c}`} />
          </svg>
        ) : null}
      </Link>
    </li>
  );
}
