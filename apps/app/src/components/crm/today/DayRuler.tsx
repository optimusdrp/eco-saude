"use client";

/**
 * RÉGUA DO DIA
 * Uma linha do tempo horizontal por profissional: o dia inteiro da clínica
 * de relance. Mostra o expediente, o intervalo (listrado), as consultas
 * (cor = situação), os horários livres (tracejados, clique para agendar)
 * e a linha do AGORA, que anda sozinha.
 *
 * No celular a régua rola para os lados, com o nome do profissional fixo
 * à esquerda; ao abrir, ela já rola até a hora atual.
 */
import { CheckCircle2, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { colorOf } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { freeSlotsFor } from "./parts";
import { hhmm, STATUS_LABEL_SHORT, type TodayAppointment, type TodayProfessional } from "./types";

const tone: Record<string, string> = {
  agendado: "bg-paper ring-1 ring-ink/15",
  confirmado: "bg-ok-tint ring-1 ring-ok/40",
  compareceu: "bg-bi-tint ring-1 ring-bi/30",
  faltou: "bg-alert-tint ring-1 ring-alert/40",
  cancelado: "bg-fog ring-1 ring-line",
};

export function DayRuler({
  today,
  professionals,
  appointments,
  waitlist,
  nowMin,
  canEdit,
  compact,
  onOpen,
}: {
  today: string;
  professionals: TodayProfessional[];
  appointments: TodayAppointment[];
  waitlist: { professionalId: string | null; period: string }[];
  nowMin: number;
  canEdit: boolean;
  compact: boolean;
  onOpen: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Quem aparece: quem atende hoje ou tem consulta hoje
  const rows = professionals.filter((p) => p.start !== null || appointments.some((a) => a.professionalId === p.id));

  // Faixa de horas: expedientes + consultas, arredondada para horas cheias
  const starts = [...rows.flatMap((p) => (p.start !== null ? [p.start] : [])), ...appointments.map((a) => a.startMin)];
  const ends = [...rows.flatMap((p) => (p.end !== null ? [p.end] : [])), ...appointments.map((a) => a.endMin)];
  const start = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 8 * 60;
  const end = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 18 * 60;
  const px = compact ? 1.25 : 1.7; // pixels por minuto
  const width = (end - start) * px;
  const rowH = compact ? 44 : 56;
  const x = (m: number) => (m - start) * px;
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const nowVisible = nowMin >= start && nowMin <= end;

  // Ao abrir: rola até um pouco antes de agora
  useEffect(() => {
    const el = scroller.current;
    if (!el || !nowVisible) return;
    el.scrollLeft = Math.max(0, x(nowMin) - el.clientWidth / 3);
    // só na primeira vez (não "puxar" a régua enquanto a pessoa rola)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rows.length === 0) {
    return <p className="rounded-xl bg-fog px-4 py-6 text-center text-ink-soft">Ninguém atende hoje.</p>;
  }

  return (
    <div ref={scroller} className="thin-scroll relative overflow-x-auto rounded-xl ring-1 ring-line">
      <div className="grid w-max min-w-full grid-cols-[7.5rem_auto] sm:grid-cols-[11rem_auto]">
        {/* Cabeçalho das horas */}
        <div className="sticky left-0 z-[5] border-b border-line bg-paper" />
        <div className="relative h-7 border-b border-line bg-paper" style={{ width }}>
          {nowVisible ? (
            <span className="absolute top-1 z-[4] -translate-x-1/2 rounded-full bg-alert px-1.5 py-0.5 text-[0.65rem] font-bold text-white tabular" style={{ left: x(nowMin) }} aria-hidden>
              {hhmm(nowMin)}
            </span>
          ) : null}
          {hours.filter((h) => !nowVisible || Math.abs(h - nowMin) > 25).map((h) => (
            <span key={h} className="absolute top-1.5 -translate-x-1/2 text-[0.7rem] font-semibold text-ink-soft tabular first:translate-x-0" style={{ left: x(h) }}>
              {hhmm(h)}
            </span>
          ))}
        </div>

        {rows.map((p) => {
          const own = appointments.filter((a) => a.professionalId === p.id);
          const free = canEdit ? freeSlotsFor(p, appointments, nowMin, waitlist) : [];
          const available = p.periods.reduce((s, x) => s + (x.end - x.start), 0);
          const used = own.filter((a) => a.status !== "faltou").reduce((s, a) => s + Math.max(0, a.endMin - a.startMin), 0);
          const pct = available ? Math.min(100, Math.round((used / available) * 100)) : 0;
          return (
            <div key={p.id} className="contents">
              {/* Nome fixo à esquerda */}
              <div className="sticky left-0 z-[5] flex min-w-0 flex-col justify-center border-b border-line bg-paper px-3 last:border-b-0" style={{ height: rowH }}>
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                  <span className={cn("size-2.5 shrink-0 rounded-full", colorOf(p.color).dot)} aria-hidden />
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="truncate text-xs text-ink-soft">
                  {p.absentReason ? (p.absentReason.startsWith("fechado") ? `hoje: ${p.absentReason}` : `ausente hoje: ${p.absentReason}`) : p.start === null ? "não atende hoje" : `${own.length} consulta(s), ${pct}% ocupado`}
                </span>
              </div>

              {/* Trilho */}
              <div className="relative border-b border-line bg-fog/70" style={{ height: rowH, width }}>
                {/* expediente (fundo claro) e intervalo (listrado) */}
                {p.start !== null && p.end !== null ? (
                  <div className="absolute inset-y-0 bg-paper" style={{ left: x(p.start), width: (p.end - p.start) * px }} aria-hidden />
                ) : null}
                {p.gaps.map((g) => (
                  <div
                    key={g.start}
                    className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-line)_6px_8px)]"
                    style={{ left: x(g.start), width: (g.end - g.start) * px }}
                    title="Intervalo"
                    aria-hidden
                  />
                ))}
                {/* linhas das horas */}
                {hours.map((h) => (
                  <span key={h} className="absolute inset-y-0 w-px bg-line/70" style={{ left: x(h) }} aria-hidden />
                ))}

                {/* linha do agora (um trecho em cada faixa) */}
                {nowVisible ? <span className="pointer-events-none absolute inset-y-0 z-[4] w-0.5 -translate-x-1/2 bg-alert" style={{ left: x(nowMin) }} aria-hidden /> : null}

                {/* horários livres */}
                {free.map((f) => (
                  <button
                    key={f.min}
                    type="button"
                    onClick={() => emit("eco:open-schedule", { professionalId: p.id, date: today, time: hhmm(f.min) })}
                    className="group absolute inset-y-1.5 z-[1] flex items-center justify-center rounded-md border border-dashed border-crm/35 text-crm hover:border-crm hover:bg-crm-tint focus-visible:bg-crm-tint"
                    style={{ left: x(f.min) + 2, width: f.length * px - 4 }}
                    aria-label={`Agendar às ${hhmm(f.min)} com ${p.name}${f.waiting ? `, ${f.waiting} na lista de espera` : ""}`}
                    title={`Livre às ${hhmm(f.min)}${f.waiting ? `: ${f.waiting} na lista de espera` : ""}`}
                  >
                    <Plus className="size-3.5 opacity-40 group-hover:opacity-100" aria-hidden />
                    {f.waiting ? <span className="ml-0.5 hidden text-[0.65rem] font-bold group-hover:inline">{f.waiting}</span> : null}
                  </button>
                ))}

                {/* consultas */}
                {own.map((a) => {
                  const w = Math.max(18, (a.endMin - a.startMin) * px - 3);
                  const done = a.endMin <= nowMin;
                  const now = a.startMin <= nowMin && nowMin < a.endMin;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onOpen(a.id)}
                      className={cn(
                        "absolute inset-y-1 z-[2] overflow-hidden rounded-md border-l-[3px] px-1.5 text-left text-xs leading-tight shadow-sm hover:z-[3] hover:shadow-md",
                        tone[a.status],
                        colorOf(a.professionalColor).border,
                        done && a.status !== "faltou" && "opacity-60",
                        now && "ring-2 ring-crm",
                      )}
                      style={{ left: x(a.startMin) + 1, width: w }}
                      aria-label={`${a.time} às ${a.endTime}, ${a.contactName}, ${STATUS_LABEL_SHORT[a.status]}`}
                      title={`${a.time}–${a.endTime} ${a.contactName} (${STATUS_LABEL_SHORT[a.status]})`}
                    >
                      <span className="flex items-center gap-1 pt-1">
                        {a.status === "compareceu" ? <CheckCircle2 className="size-3 shrink-0 text-bi" aria-hidden /> : null}
                        <span className="truncate font-bold">{a.contactName}</span>
                        {a.firstVisit ? <Sparkles className="size-3 shrink-0 text-crm" aria-hidden /> : null}
                      </span>
                      {!compact ? <span className="block truncate text-ink-soft tabular">{a.time}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
