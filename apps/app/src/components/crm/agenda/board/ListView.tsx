"use client";

import { APPOINTMENT_STATUS_LABEL, RISK_LABEL } from "@ecosaude/core/crm";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { Badge, colorOf, type Tone } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import type { BoardAppointment, BoardDay } from "./types";

/**
 * LISTA: a agenda corrida, ótima no celular e para imprimir.
 * Agrupa por dia; mostra o tempo livre entre as consultas de cada profissional.
 */
const statusBadge: Record<string, Tone> = { agendado: "neutral", confirmado: "success", compareceu: "bi", faltou: "alert", cancelado: "neutral" };

export function ListView({
  days,
  appointments,
  proColor,
  highlight,
  onOpen,
  printTitle,
  className,
}: {
  days: BoardDay[];
  appointments: BoardAppointment[];
  proColor: (id: string) => string;
  highlight: Set<string> | null;
  onOpen: (id: string) => void;
  printTitle: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <h1 className="hidden text-xl font-bold print:block">{printTitle}</h1>
      {days.map((d) => {
        const list = appointments.filter((a) => a.date === d.date).sort((a, b) => a.startMin - b.startMin);
        return (
          <section key={d.date} aria-label={d.label} className="break-inside-avoid rounded-2xl bg-paper ring-1 ring-line print:rounded-none print:ring-0">
            <h2 className={cn("flex items-center justify-between border-b border-line px-4 py-2.5 font-display text-base font-bold capitalize", d.isToday && "text-crm")}>
              {d.isToday ? `Hoje, ${d.label}` : d.label}
              <span className="text-sm font-normal text-ink-soft normal-case">
                {list.filter((a) => a.status !== "cancelado").length} consulta(s)
              </span>
            </h2>
            {list.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-soft">Nenhuma consulta.</p>
            ) : (
              <ol className="divide-y divide-line">
                {list.map((a) => (
                  <li key={a.id} className={cn(highlight && !highlight.has(a.id) && "opacity-40 print:opacity-100")}>
                    <button type="button" onClick={() => onOpen(a.id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-fog/70">
                      <span className="w-[5.5rem] shrink-0 font-bold tabular">
                        {a.time}
                        <span className="block text-xs font-normal text-ink-soft">até {a.endTime}</span>
                      </span>
                      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", colorOf(proColor(a.professionalId)).dot)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cn("flex flex-wrap items-center gap-1.5 font-semibold", a.status === "cancelado" && "line-through")}>
                          {a.contactName}
                          {a.firstVisit && a.status !== "cancelado" ? (
                            <span className="inline-flex items-center gap-0.5 rounded bg-crm px-1 text-[0.65rem] font-bold text-white">
                              <Sparkles className="size-2.5" aria-hidden />
                              1ª consulta
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-sm text-ink-soft">
                          {a.professionalName}
                          {a.service ? `, ${a.service}` : ""}
                          {a.notes ? `. ${a.notes}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={statusBadge[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
                        {a.risk && a.risk.level !== "baixo" ? (
                          <span className={cn("text-xs font-semibold", a.risk.level === "alto" ? "text-alert" : "text-erp-ink")}>{RISK_LABEL[a.risk.level]}</span>
                        ) : null}
                        {a.status === "agendado" && a.confirmationRequested ? (
                          <span className="inline-flex items-center gap-1 text-xs text-erp-ink">
                            <MessageCircleQuestion className="size-3.5" aria-hidden /> sem resposta
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
