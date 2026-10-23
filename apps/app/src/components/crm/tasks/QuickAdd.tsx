"use client";

/**
 * TAREFA RÁPIDA: escreva e aperte Enter.
 * A data e o responsável saem do próprio texto (parseQuickTask, em @ecosaude/core):
 *   "Ligar para Ana amanhã @paula", "Conferir convênio sexta", "Enviar exame 20/10"
 * Enquanto digita, a tela mostra o que entendeu (data e responsável).
 */
import { parseQuickTask } from "@ecosaude/core/crm";
import { CalendarDays, CornerDownLeft, UserRound, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useRef, useState } from "react";
import { cn } from "@/components/ui/styles";
import { saveTaskAction } from "@/modules/crm/actions/tasks";
import { dayLabel } from "./dates";

export function QuickAdd({ today, team, userId, inputRef }: { today: string; team: { id: string; name: string }[]; userId: string; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState(saveTaskAction, {});
  const parsed = parseQuickTask(text, today, team);
  const formRef = useRef<HTMLFormElement>(null);
  const me = team.find((u) => u.id === userId);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setText("");
  }
  const refresh = useEffectEvent(() => router.refresh());
  useEffect(() => {
    if (state.ok) refresh();
  }, [state]);

  const due = parsed.dueDate ?? today;
  const ready = parsed.title.length >= 2;

  return (
    <form ref={formRef} action={action} className="mb-5 rounded-2xl bg-paper p-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-crm sm:p-4">
      <input type="hidden" name="title" value={parsed.title} />
      <input type="hidden" name="dueDate" value={due} />
      <input type="hidden" name="assigneeId" value={parsed.assigneeId ?? ""} />
      <label htmlFor="quick-task" className="flex items-center gap-2 text-sm font-bold">
        <Zap className="size-4 text-crm" aria-hidden /> Tarefa rápida
      </label>
      <div className="mt-2 flex gap-2">
        <input
          ref={inputRef}
          id="quick-task"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: Ligar para Ana amanhã @paula (tecla N)"
          autoComplete="off"
          aria-describedby="quick-task-hint"
          className="min-h-11 min-w-0 flex-1 rounded-xl bg-fog px-3 ring-1 ring-line outline-none focus:bg-paper"
        />
        <button type="submit" disabled={!ready || pending} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-crm px-4 text-sm font-semibold text-white disabled:opacity-50">
          <CornerDownLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">{pending ? "Criando..." : "Criar"}</span>
        </button>
      </div>
      {/* O que foi entendido */}
      <div id="quick-task-hint" className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
        {text.trim() ? (
          <>
            <Chip icon={<CalendarDays className="size-3.5" aria-hidden />} on={!!parsed.dueDate}>
              {dayLabel(due, today)}
              {parsed.dateText ? ` (de “${parsed.dateText}”)` : ""}
            </Chip>
            <Chip icon={<UserRound className="size-3.5" aria-hidden />} on={!!parsed.assigneeId}>
              {parsed.assigneeName ?? (me ? `${me.name.split(" ")[0]} (você)` : "você")}
            </Chip>
          </>
        ) : (
          <span className="text-ink-soft">Datas: hoje, amanhã, sexta, 20/10, em 3 dias, semana que vem. Responsável: @nome.</span>
        )}
        {state.message && !state.ok ? <span className="font-semibold text-alert">{state.errors?.title ?? state.message}</span> : null}
        {state.ok && state.message && !text ? <span className="font-semibold text-ok-ink">{state.message}</span> : null}
      </div>
    </form>
  );
}

function Chip({ icon, on, children }: { icon: React.ReactNode; on: boolean; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", on ? "bg-crm-tint text-crm" : "bg-fog text-ink-soft")}>{icon}{children}</span>;
}
