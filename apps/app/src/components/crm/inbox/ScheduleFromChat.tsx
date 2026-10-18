"use client";

/**
 * "AGENDAR PELO PEDIDO" (IA com plano B)
 *
 * Lê o que o paciente pediu na conversa ("quinta à tarde com a Dra. Beatriz") e
 * abre o diálogo de agendamento já preenchido: profissional, período, procedimento
 * e só os horários livres que batem com o pedido. Nada é marcado aqui: a recepção
 * confere e clica em "Confirmar agendamento".
 * Se a leitura falhar de vez, abre o agendamento normal (ninguém fica travado).
 */
import { CalendarPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { buttonStyles, cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { suggestScheduleAction } from "@/modules/crm/actions/ai";

export function ScheduleFromChatButton({
  conversationId,
  contactId,
  contactName,
  variant = "link",
  className,
}: {
  conversationId: string;
  contactId: string;
  contactName: string;
  /** link = discreto (barra do campo de texto); primary = botão cheio (painel) */
  variant?: "link" | "primary";
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = () =>
    start(async () => {
      setError(null);
      const res = await suggestScheduleAction({ conversationId });
      emit("eco:open-schedule", { contactId, contactName, conversationId, suggestion: res.ok ? res.suggestion : undefined });
      if (!res.ok) setError(res.message);
    });

  const label = pending ? "Lendo o pedido..." : "Agendar pelo pedido";
  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        title="Lê o dia, o período, o profissional e o procedimento que o paciente pediu e abre o agendamento preenchido"
        className={
          variant === "primary"
            ? buttonStyles("primary", cn("w-full", className))
            : cn("inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-crm hover:underline disabled:opacity-50 sm:min-h-9", className)
        }
      >
        <CalendarPlus className={cn("size-4", pending && "animate-pulse")} aria-hidden />
        {label}
      </button>
      {error ? (
        <span role="status" className="text-xs font-semibold text-alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
