"use client";

/**
 * Pequenos componentes interativos usados em várias telas do CRM.
 * Ficam no navegador; as páginas (Server Components) só os posicionam.
 */
import { CalendarPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { SubmitButton } from "@/components/ui";
import { buttonStyles, cn, type Variant } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { useAutoRefresh } from "@/lib/hooks";
import type { ActionState } from "@/lib/server";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Atualiza a página periodicamente (conversas e agenda "ao vivo"). */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  useAutoRefresh(seconds);
  return null;
}

/** Nome do paciente clicável: abre o trilho do paciente ao lado. */
export function PatientLink({ id, name, className, children }: { id: string; name: string; className?: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => emit("eco:open-patient", id)}
      className={cn("min-w-0 text-left font-semibold underline-offset-4 hover:text-crm hover:underline", className)}
      aria-label={`Abrir painel de ${name}`}
    >
      {children ?? name}
    </button>
  );
}

/** Botão que abre o diálogo de agendamento já com o paciente escolhido. */
export function ScheduleButton({
  contactId,
  contactName,
  conversationId,
  service,
  label = "Agendar",
  variant = "primary",
  className,
}: {
  contactId?: string;
  contactName?: string;
  conversationId?: string;
  service?: string;
  label?: string;
  variant?: Variant;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => emit("eco:open-schedule", { contactId, contactName, conversationId, service })}
      className={buttonStyles(variant, className)}
    >
      <CalendarPlus className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/**
 * Botão de ação com formulário próprio (ex.: "Pedir confirmação", "Concluir").
 * Mostra o resultado logo abaixo e atualiza a página.
 */
export function ActionButton({
  action,
  fields,
  multi,
  label,
  pendingText,
  variant = "secondary",
  className,
  confirmText,
}: {
  action: Action;
  fields?: Record<string, string>;
  /** Campos repetidos (ex.: vários appointmentId) */
  multi?: Record<string, string[]>;
  label: ReactNode;
  pendingText?: string;
  variant?: Variant;
  className?: string;
  confirmText?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {Object.entries(multi ?? {}).flatMap(([k, values]) => values.map((v) => <input key={`${k}-${v}`} type="hidden" name={k} value={v} />))}
      <SubmitButton variant={variant} pendingText={pendingText} className={className}>
        {label}
      </SubmitButton>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className={cn("max-w-xs text-xs font-semibold", state.ok ? "text-pep-ink" : "text-alert")}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Texto que alterna entre "mostrar mais/menos" (listas longas no celular). */
export function Expandable({ children, more, label = "Ver mais" }: { children: ReactNode; more: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children}
      {open ? more : null}
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 min-h-10 text-sm font-semibold text-crm hover:underline">
        {open ? "Ver menos" : label}
      </button>
    </>
  );
}
