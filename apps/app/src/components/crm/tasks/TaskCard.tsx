"use client";

/**
 * Uma tarefa (lista ou cartão de coluna).
 * Círculo à esquerda conclui em um toque; menu "Adiar" com atalhos e data;
 * editar abre o diálogo completo (paciente, responsável).
 */
import { addDaysIso } from "@ecosaude/core/crm";
import { CalendarClock, Check, Trash2, UserRound } from "lucide-react";
import { useRef } from "react";
import { TaskButton } from "@/components/crm/TaskTools";
import { PatientLink } from "@/components/crm/widgets";
import { Badge, initials } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { dayLabel, daysFrom, nextMonday } from "./dates";
import { KIND_LABEL, type TaskItem } from "./types";

type Change = { ids: string[]; op: "concluir" | "reabrir" | "adiar" | "atribuir" | "excluir"; dueDate?: string; assigneeId?: string | null };

export function TaskCard({
  t,
  today,
  team,
  canEdit,
  compact,
  narrow = false,
  selecting,
  selected,
  onToggle,
  onRun,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  t: TaskItem;
  today: string;
  team: { id: string; name: string }[];
  canEdit: boolean;
  compact: boolean;
  /** Cartão de coluna (quadro): ações numa linha própria */
  narrow?: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onRun: (c: Change) => void;
  draggable: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const late = !t.done && t.dueDate < today;
  const lateDays = late ? -daysFrom(today, t.dueDate) : 0;
  const postpone = (dueDate: string) => {
    if (menu.current) menu.current.open = false;
    if (dueDate && dueDate !== t.dueDate) onRun({ ids: [t.id], op: "adiar", dueDate });
  };

  return (
    <li
      draggable={draggable && !selecting}
      onDragStart={(e) => {
        onDragStart(t.id);
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
      data-task={t.id}
      className={cn(
        "group flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl bg-paper ring-1 ring-line",
        compact ? "p-2.5" : "p-3.5",
        draggable && "cursor-grab active:cursor-grabbing",
        late && "ring-alert/40",
        selected && "ring-2 ring-crm",
      )}
    >
      {selecting ? (
        <input type="checkbox" checked={selected} onChange={() => onToggle(t.id)} className="mt-1 size-4 shrink-0 accent-[var(--color-crm)]" aria-label={`Selecionar: ${t.title}`} />
      ) : (
        // Concluir / reabrir em um toque
        <button
          type="button"
          onClick={() => onRun({ ids: [t.id], op: t.done ? "reabrir" : "concluir" })}
          aria-pressed={t.done}
          aria-label={t.done ? `Reabrir: ${t.title}` : `Concluir: ${t.title}`}
          title={t.done ? "Reabrir" : "Concluir"}
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ring-2 transition-colors",
            t.done ? "bg-ok text-white ring-ok" : "text-transparent ring-ink/25 hover:bg-ok-tint hover:text-ok hover:ring-ok",
          )}
        >
          <Check className="size-4" aria-hidden />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold break-words", t.done && "text-ink-soft line-through")}>{t.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
          <span className={cn("inline-flex items-center gap-1", late && "font-bold text-alert")}>
            <CalendarClock className="size-3.5" aria-hidden />
            {t.done ? `feita ${t.doneLabel}` : late ? `${dayLabel(t.dueDate, today)} (${lateDays} ${lateDays === 1 ? "dia" : "dias"} de atraso)` : dayLabel(t.dueDate, today)}
          </span>
          {t.contactId && t.contactName ? <PatientLink id={t.contactId} name={t.contactName} className="text-sm" /> : null}
          {t.kind !== "manual" ? <Badge tone={t.kind === "falta" || t.kind === "sentimento" ? "alert" : t.kind === "nps_baixo" ? "warning" : "crm"}>{KIND_LABEL[t.kind] ?? t.kind}</Badge> : null}
        </p>
      </div>

      {/* Responsável */}
      <span
        className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold", t.assigneeName ? "bg-ink text-white" : "bg-fog text-ink-soft")}
        title={t.assigneeName ? `Com ${t.assigneeName}` : "Sem responsável"}
        aria-label={t.assigneeName ? `Responsável: ${t.assigneeName}` : "Sem responsável"}
      >
        {t.assigneeName ? initials(t.assigneeName) : <UserRound className="size-3.5" aria-hidden />}
      </span>

      {/* Ações (aparecem ao passar o mouse; sempre visíveis no toque) */}
      {canEdit && !t.done && !selecting ? (
        // No cartão estreito (colunas) as ações descem para uma linha própria
        <div className={cn("flex shrink-0 items-center", narrow && "basis-full justify-end", "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100")}>
          <details ref={menu} className="relative">
            <summary className="inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-lg text-ink-soft hover:bg-fog hover:text-ink [&::-webkit-details-marker]:hidden" title="Adiar" aria-label={`Adiar: ${t.title}`}>
              <CalendarClock className="size-4" aria-hidden />
            </summary>
            <div className="absolute right-0 z-30 mt-1 w-52 rounded-xl bg-paper p-1 shadow-xl ring-1 ring-line">
              {[
                ["Hoje", today],
                ["Amanhã", addDaysIso(today, 1)],
                ["Próxima segunda", nextMonday(today)],
                ["Daqui a 7 dias", addDaysIso(t.dueDate > today ? t.dueDate : today, 7)],
              ].map(([label, d]) => (
                <button key={label} type="button" onClick={() => postpone(d!)} disabled={d === t.dueDate} className="flex min-h-9 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold hover:bg-fog disabled:opacity-40">
                  {label}
                  <span className="text-xs font-normal text-ink-soft">{dayLabel(d!, today)}</span>
                </button>
              ))}
              <label className="mt-1 flex items-center gap-2 border-t border-line px-3 pt-2 pb-1 text-xs text-ink-soft">
                Outra data
                <input type="date" min={today} defaultValue={t.dueDate} onChange={(e) => postpone(e.target.value)} className="min-h-8 flex-1 rounded-lg bg-fog px-1 text-sm text-ink" />
              </label>
            </div>
          </details>
          <TaskButton team={team} today={today} initial={{ id: t.id, title: t.title, dueDate: t.dueDate, assigneeId: t.assigneeId ?? "", contact: t.contactId && t.contactName ? { id: t.contactId, name: t.contactName } : null }} />
          <button type="button" onClick={() => onRun({ ids: [t.id], op: "excluir" })} className="inline-flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-alert-tint hover:text-alert" aria-label={`Excluir: ${t.title}`} title="Excluir">
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </li>
  );
}
