"use client";

import { APPOINTMENT_STATUS_LABEL, RISK_LABEL } from "@ecosaude/core/crm";
import { Ban, CheckCircle2, Clock3, GripVertical, MessageCircleQuestion, Plus, Sparkles, UserCheck, UserX } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { colorOf } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { layoutLanes } from "./layout";
import { hhmm, type BoardAppointment } from "./types";

/**
 * GRADE DE HORÁRIOS
 * - Horas SEMPRE na coluna da esquerda (fixa ao rolar para os lados).
 * - Cabeçalho fixo ao rolar para baixo.
 * - Uma coluna por profissional (visão dia) ou por dia (visão semana).
 * - Arraste uma consulta para outro horário/profissional para remarcar.
 * - Toque num horário livre para agendar.
 */
export interface ColumnSchedule {
  start: number;
  end: number;
  /** Intervalos (vãos entre os períodos do dia) */
  gaps: { start: number; end: number }[];
  /** O profissional atende neste dia? */
  works: boolean;
  /** Por que não atende (ex.: "Férias"); vazio = não é dia de atendimento */
  offLabel?: string;
}

export interface GridColumn {
  key: string;
  date: string;
  /** Profissional da coluna (visão dia, ou semana com um só profissional) */
  professionalId: string | null;
  title: string;
  /** Complemento do rótulo acessível dos horários livres ("com Dra. X" / "em seg, 12/10") */
  slotLabel: string;
  subtitle?: string;
  dot?: string;
  schedule: ColumnSchedule | null;
  appointments: BoardAppointment[];
  /** Inícios (minutos) dos horários livres clicáveis */
  freeSlots: { min: number; length: number; waiting: number }[];
  isToday: boolean;
  /** Ocupação do dia (visão dia) */
  occupancy?: { pct: number; busy: [number, number][]; free: number };
}

const statusTone: Record<string, string> = {
  agendado: "bg-paper ring-1 ring-line",
  confirmado: "bg-ok-tint ring-1 ring-ok/40",
  compareceu: "bg-bi-tint ring-1 ring-bi/30",
  faltou: "bg-alert-tint ring-1 ring-alert/40",
  cancelado: "bg-fog ring-1 ring-line opacity-60",
};
const statusIcon = { agendado: Clock3, confirmado: CheckCircle2, compareceu: UserCheck, faltou: UserX, cancelado: Ban };
const riskDot = { baixo: "bg-ok", medio: "bg-erp", alto: "bg-alert" };

export function TimeGrid({
  columns,
  range,
  px,
  nowMin,
  colorBy,
  proColor,
  highlight,
  canDrag,
  onOpen,
  onFreeClick,
  onDrop,
  scrollToMin,
  columnMinWidth = "12rem",
}: {
  columns: GridColumn[];
  range: { start: number; end: number };
  px: number;
  /** Minuto atual (só desenha a linha nas colunas de hoje) */
  nowMin: number;
  colorBy: "status" | "profissional";
  proColor: (professionalId: string) => string;
  /** Busca: ids que combinam (null = sem busca) */
  highlight: Set<string> | null;
  canDrag: (a: BoardAppointment) => boolean;
  onOpen: (id: string) => void;
  onFreeClick: (col: GridColumn, min: number) => void;
  onDrop: (a: BoardAppointment, col: GridColumn, min: number) => void;
  /** Minuto para mostrar ao abrir (agora, ou a primeira consulta) */
  scrollToMin: number;
  columnMinWidth?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<BoardAppointment | null>(null);
  // Onde a pessoa "pegou" o bloco (em minutos a partir do topo): o bloco cai sem pular
  const grabOffset = useRef(0);
  const [hint, setHint] = useState<{ col: string; min: number } | null>(null);
  const height = (range.end - range.start) * px;
  const hours: number[] = [];
  for (let m = Math.ceil(range.start / 60) * 60; m <= range.end; m += 60) hours.push(m);
  const top = (m: number) => (m - range.start) * px;
  const hasToday = columns.some((c) => c.isToday) && nowMin > range.start && nowMin < range.end;

  // Abre já no horário que interessa (agora ou a primeira consulta)
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, top(scrollToMin) - 80);
    // só na primeira vez e quando muda o período/densidade
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToMin, px, range.start]);

  /** Novo início da consulta arrastada: posição do ponteiro menos onde o bloco foi pego, de 5 em 5 minutos */
  const minuteAt = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = range.start + (e.clientY - rect.top) / px - grabOffset.current;
    const length = dragging ? dragging.endMin - dragging.startMin : 30;
    return Math.max(range.start, Math.min(range.end - length, Math.round(raw / 5) * 5));
  };

  return (
    <div
      ref={scroller}
      className="thin-scroll relative max-h-[calc(100dvh-13rem)] min-h-[24rem] overflow-auto rounded-2xl bg-paper ring-1 ring-line print:hidden"
      role="region"
      aria-label="Grade de horários"
    >
      <div className="grid min-w-max" style={{ gridTemplateColumns: `4.25rem repeat(${Math.max(columns.length, 1)}, minmax(${columnMinWidth}, 1fr))` }}>
        {/* Canto: fixo nos dois sentidos */}
        <div className="sticky top-0 left-0 z-30 border-r border-b border-line bg-paper" />
        {columns.map((c) => (
          <div key={c.key} className={cn("sticky top-0 z-20 border-b border-l border-line bg-paper/95 px-3 pt-2 pb-2 backdrop-blur", c.isToday && "bg-crm-tint/70")}>
            <p className="flex items-center gap-2 truncate font-semibold">
              {c.dot ? <span className={cn("size-2.5 shrink-0 rounded-full", c.dot)} aria-hidden /> : null}
              <span className="truncate">{c.title}</span>
            </p>
            <p className="truncate text-xs text-ink-soft">
              {c.subtitle}
              {c.schedule && !c.schedule.works ? (c.subtitle ? ", não atende" : "não atende") : ""}
            </p>
            {c.occupancy && c.schedule?.works ? <OccupancyRibbon col={c} range={range} /> : null}
            {c.freeSlots.some((f) => f.waiting) ? (
              <p className="mt-0.5 text-[0.7rem] font-semibold text-erp-ink">
                {Math.max(...c.freeSlots.map((f) => f.waiting))} na lista de espera para esses horários
              </p>
            ) : null}
          </div>
        ))}

        {/* Régua de horas: à ESQUERDA e fixa ao rolar para os lados */}
        <div className="sticky left-0 z-10 border-r border-line bg-paper" style={{ height }}>
          {hours.map((m) => (
            <span key={m} className="absolute right-2 -translate-y-1/2 text-xs font-semibold text-ink-soft tabular" style={{ top: top(m) }}>
              {hhmm(m)}
            </span>
          ))}
          {hasToday ? (
            <span
              className="absolute right-1 z-10 -translate-y-1/2 rounded-md bg-alert px-1.5 py-0.5 text-[0.7rem] font-bold text-white tabular shadow"
              style={{ top: top(nowMin) }}
              aria-label={`Agora: ${hhmm(nowMin)}`}
            >
              {hhmm(nowMin)}
            </span>
          ) : null}
        </div>

        {columns.map((c) => {
          const laid = layoutLanes(c.appointments);
          return (
            <div
              key={c.key}
              className={cn("relative border-l border-line", c.isToday && "bg-crm-tint/15")}
              style={{ height }}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const min = minuteAt(e);
                if (hint?.col !== c.key || hint.min !== min) setHint({ col: c.key, min });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) onDrop(dragging, c, minuteAt(e));
                setDragging(null);
                setHint(null);
              }}
            >
              {/* Linhas das horas e meias horas */}
              {hours.map((m) => (
                <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-line/80" style={{ top: top(m) }} aria-hidden />
              ))}
              {hours.map((m) =>
                m + 30 < range.end ? (
                  <div key={`h${m}`} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line/50" style={{ top: top(m + 30) }} aria-hidden />
                ) : null,
              )}

              {/* Fora do expediente e intervalo */}
              {c.schedule ? (
                c.schedule.works ? (
                  <>
                    <Shade from={range.start} to={c.schedule.start} top={top} />
                    <Shade from={c.schedule.end} to={range.end} top={top} />
                    {c.schedule.gaps.map((g) => (
                      <div
                        key={g.start}
                        className="pointer-events-none absolute inset-x-0 flex items-center justify-center bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(24_32_58/0.05)_6px,rgb(24_32_58/0.05)_12px)] text-xs text-ink-soft"
                        style={{ top: top(g.start), height: (g.end - g.start) * px }}
                      >
                        intervalo
                      </div>
                    ))}
                  </>
                ) : (
                  <Shade from={range.start} to={range.end} top={top} label={c.schedule.offLabel ? (c.schedule.offLabel.startsWith("Fechado") ? c.schedule.offLabel : `ausente: ${c.schedule.offLabel}`) : "não atende neste dia"} />
                )
              ) : null}

              {/* Horários livres */}
              {c.freeSlots.map((f) => (
                <button
                  key={f.min}
                  type="button"
                  onClick={() => onFreeClick(c, f.min)}
                  className="group absolute inset-x-1 flex items-center justify-between rounded-lg border border-dashed border-transparent px-2 text-xs font-semibold text-crm hover:border-crm/50 hover:bg-crm-tint/70 focus-visible:border-crm/50 focus-visible:bg-crm-tint/70"
                  style={{ top: top(f.min) + 1, height: Math.max(18, f.length * px - 2) }}
                  aria-label={`Agendar às ${hhmm(f.min)} ${c.slotLabel}${f.waiting ? `, ${f.waiting} na lista de espera` : ""}`}
                >
                  <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Plus className="size-3.5" aria-hidden /> {hhmm(f.min)}
                  </span>
                  {f.waiting ? (
                    <span
                      className="rounded-full bg-erp-tint px-1.5 text-[0.68rem] text-erp-ink opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                      title="Pacientes da lista de espera que combinam com este horário"
                    >
                      {f.waiting} na espera
                    </span>
                  ) : null}
                </button>
              ))}

              {/* Consultas */}
              {laid.map(({ item: a, lane, lanes }) => {
                const Icon = statusIcon[a.status];
                const dim = highlight && !highlight.has(a.id);
                const draggable = canDrag(a);
                const h = Math.max(22, (a.endMin - a.startMin) * px - 2);
                const tone = colorBy === "status" ? statusTone[a.status] : cn(colorOf(proColor(a.professionalId)).soft, "ring-1 ring-line", a.status === "cancelado" && "opacity-60");
                return (
                  <button
                    key={a.id}
                    type="button"
                    draggable={draggable}
                    onDragStart={(e) => {
                      grabOffset.current = (e.clientY - e.currentTarget.getBoundingClientRect().top) / px;
                      e.dataTransfer.setData("text/plain", a.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(a);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setHint(null);
                    }}
                    onClick={() => onOpen(a.id)}
                    className={cn(
                      "@container absolute z-[2] overflow-hidden rounded-lg border-l-4 px-2 py-1 text-left text-xs shadow-sm transition-[opacity,box-shadow] hover:z-[3] hover:shadow-md focus-visible:z-[3]",
                      tone,
                      colorOf(proColor(a.professionalId)).border,
                      a.status === "cancelado" && "line-through",
                      dim && "opacity-25",
                      highlight?.has(a.id) && "ring-2 ring-crm",
                      dragging?.id === a.id && "opacity-40",
                      draggable && "cursor-grab active:cursor-grabbing",
                    )}
                    style={{
                      top: top(a.startMin) + 1,
                      height: h,
                      left: `calc(${(lane / lanes) * 100}% + 4px)`,
                      width: `calc(${100 / lanes}% - 8px)`,
                    }}
                    aria-label={`${a.time} às ${a.endTime}, ${a.contactName}, ${APPOINTMENT_STATUS_LABEL[a.status]}${a.risk && a.risk.level !== "baixo" ? `, ${RISK_LABEL[a.risk.level]}` : ""}`}
                  >
                    <span className="flex items-center gap-1">
                      <Icon className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate font-bold">{a.contactName}</span>
                      {a.firstVisit && a.status !== "cancelado" ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-crm px-1 text-[0.62rem] font-bold text-white" title="Primeira consulta na clínica">
                          <Sparkles className="size-2.5" aria-hidden />
                          <span className="hidden @[11rem]:inline">1ª</span>
                        </span>
                      ) : null}
                      {a.risk && a.risk.level !== "baixo" ? (
                        <span className={cn("ml-auto size-2 shrink-0 rounded-full", riskDot[a.risk.level])} title={`${RISK_LABEL[a.risk.level]} de falta`} />
                      ) : null}
                      {draggable && h > 34 ? <GripVertical className="ml-auto size-3.5 shrink-0 text-ink-soft/60" aria-hidden /> : null}
                    </span>
                    {h > 30 ? (
                      <span className="block truncate text-ink-soft">
                        {a.time}–{a.endTime}
                        {a.roomName ? `, ${a.roomName}` : ""}
                        {a.service ? `, ${a.service}` : ""}
                      </span>
                    ) : null}
                    {h > 48 ? (
                      <span className="mt-0.5 flex items-center gap-1 truncate text-ink-soft">
                        {colorBy === "status" || lanes > 1 ? a.professionalName : APPOINTMENT_STATUS_LABEL[a.status]}
                        {a.status === "agendado" && a.confirmationRequested ? (
                          <MessageCircleQuestion className="size-3.5 text-erp-ink" aria-label="Confirmação pedida, sem resposta" />
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {/* Onde a consulta vai cair ao soltar */}
              {dragging && hint?.col === c.key ? (
                <div
                  className="pointer-events-none absolute inset-x-1 z-[4] rounded-lg border-2 border-dashed border-crm bg-crm-tint/80 px-2 py-1 text-xs font-bold text-crm"
                  style={{ top: top(hint.min), height: (dragging.endMin - dragging.startMin) * px }}
                >
                  {hhmm(hint.min)}–{hhmm(hint.min + dragging.endMin - dragging.startMin)}: solte para remarcar
                </div>
              ) : null}

              {c.isToday && hasToday ? (
                <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-alert" style={{ top: top(nowMin) }} aria-hidden>
                  <span className="absolute -top-[5px] -left-[5px] size-2.5 rounded-full bg-alert" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shade({ from, to, top, label }: { from: number; to: number; top: (m: number) => number; label?: string }) {
  if (to <= from) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 flex items-start justify-center bg-fog/80 pt-3 text-xs text-ink-soft" style={{ top: top(from), height: top(to) - top(from) }} aria-hidden>
      {label}
    </div>
  );
}

/**
 * TRILHO DE OCUPAÇÃO: o dia do profissional em miniatura (ocupado, livre,
 * intervalo) com a porcentagem ocupada. Mostra de relance onde ainda cabe gente.
 */
function OccupancyRibbon({ col, range }: { col: GridColumn; range: { start: number; end: number } }) {
  const s = col.schedule!;
  const o = col.occupancy!;
  const span = range.end - range.start;
  const pct = (m: number) => `${((m - range.start) / span) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / span) * 100}%`;
  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-fog" aria-hidden>
        <div className="absolute inset-y-0 bg-ok-tint" style={{ left: pct(s.start), width: w(s.start, s.end) }} />
        {s.gaps.map((g) => (
          <div key={g.start} className="absolute inset-y-0 bg-ink/15" style={{ left: pct(g.start), width: w(g.start, g.end) }} />
        ))}
        {o.busy.map(([a, b], i) => (
          <div key={i} className={cn("absolute inset-y-0", col.dot ?? "bg-crm")} style={{ left: pct(a), width: w(a, b) }} />
        ))}
      </div>
      <p className="mt-0.5 text-[0.7rem] text-ink-soft tabular">
        {o.pct}% ocupado, {o.free} {o.free === 1 ? "horário livre" : "horários livres"}
      </p>
    </div>
  );
}
