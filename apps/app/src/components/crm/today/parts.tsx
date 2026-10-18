"use client";

/**
 * Peças pequenas do painel HOJE: moldura dos quadros, botão de situação
 * da consulta (Chegou/Faltou) e o cálculo de horários livres.
 */
import type { AppointmentStatus } from "@ecosaude/core/crm";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, type ReactNode } from "react";
import { SubmitButton } from "@/components/ui";
import { cn, type Variant } from "@/components/ui/styles";
import { changeAppointmentStatusAction } from "@/modules/crm/actions/agenda";
import type { TodayAppointment, TodayProfessional, WidgetId } from "./types";

/* ------------------------------ Moldura do quadro ------------------------------ */

export function WidgetCard({
  id,
  title,
  count,
  hint,
  actions,
  collapsed,
  onToggle,
  children,
  tone = "default",
  className,
}: {
  id: WidgetId;
  title: string;
  count?: number;
  hint?: string;
  actions?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  tone?: "default" | "alert";
  className?: string;
}) {
  const bodyId = `w-${id}`;
  return (
    <section
      id={`quadro-${id}`}
      aria-labelledby={`${bodyId}-t`}
      className={cn("min-w-0 scroll-mt-24 rounded-2xl bg-paper ring-1 ring-line", tone === "alert" && "ring-2 ring-alert/50", className)}
    >
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2 sm:px-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className="-ml-1 inline-flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left"
          title={collapsed ? "Mostrar o conteúdo" : "Recolher"}
        >
          <ChevronDown className={cn("size-4 shrink-0 text-ink-soft transition-transform motion-reduce:transition-none", collapsed && "-rotate-90")} aria-hidden />
          <h2 id={`${bodyId}-t`} className="truncate text-base font-bold sm:text-lg">
            {title}
          </h2>
          {count !== undefined ? (
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tabular", count ? "bg-ink text-white" : "bg-fog text-ink-soft")}>{count}</span>
          ) : null}
        </button>
        {actions && !collapsed ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {collapsed ? null : (
        <div id={bodyId} className="px-4 pb-4 sm:px-5 sm:pb-5">
          {hint ? <p className="mb-3 text-sm text-ink-soft">{hint}</p> : null}
          {children}
        </div>
      )}
    </section>
  );
}

/* --------------------------- Chegou / Faltou em um toque --------------------------- */

/**
 * Muda a situação da consulta direto da lista (sem abrir o diálogo).
 * Usa a mesma ação do diálogo da agenda, com a "versão" da consulta: se outra
 * pessoa mudou antes, o servidor recusa e a tela se atualiza.
 */
export function QuickStatus({
  appt,
  status,
  label,
  variant = "secondary",
  className,
}: {
  appt: Pick<TodayAppointment, "id" | "version" | "contactName">;
  status: AppointmentStatus;
  label: string;
  variant?: Variant;
  className?: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState(changeAppointmentStatusAction, {});
  useEffect(() => {
    if (state.ok || state.message) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="inline-flex flex-col items-end gap-0.5">
      <input type="hidden" name="id" value={appt.id} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="version" value={appt.version} />
      <SubmitButton variant={variant} pendingText="..." className={cn("min-h-9 px-3 text-sm", className)} aria-label={`${label}: ${appt.contactName}`}>
        {label}
      </SubmitButton>
      {state.message && !state.ok ? (
        <span role="alert" className="max-w-40 text-right text-xs font-semibold text-alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/* ------------------------------- Horários livres ------------------------------- */

export interface FreeSlot {
  professionalId: string;
  min: number;
  length: number;
  /** Quantos na lista de espera servem para este horário */
  waiting: number;
}

/**
 * Horários livres que AINDA dá para usar hoje (a partir de agora), pelo
 * expediente e duração de consulta de cada profissional.
 */
export function freeSlotsFor(
  p: TodayProfessional,
  appointments: TodayAppointment[],
  nowMin: number,
  waitlist: { professionalId: string | null; period: string }[],
): FreeSlot[] {
  const busy = appointments.filter((a) => a.professionalId === p.id && a.status !== "cancelado");
  const out: FreeSlot[] = [];
  for (const block of p.periods) {
    for (let m = block.start; m + p.slot <= block.end; m += p.slot) {
      if (m <= nowMin) continue;
      if (busy.some((a) => a.startMin < m + p.slot && m < a.endMin)) continue;
      const waiting = waitlist.filter(
        (w) => (w.professionalId === null || w.professionalId === p.id) && (w.period === "qualquer" || (w.period === "manha" ? m < 720 : m >= 720)),
      ).length;
      out.push({ professionalId: p.id, min: m, length: p.slot, waiting });
    }
  }
  return out;
}

/** "em 25 min", "em 1 h 10", "agora" */
export function untilLabel(min: number): string {
  if (min <= 0) return "agora";
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `em ${h} h ${r}` : `em ${h} h`;
}
