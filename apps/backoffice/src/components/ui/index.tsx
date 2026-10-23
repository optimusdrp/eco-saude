"use client";

/**
 * Componentes de interface do backoffice.
 * Ficam juntos neste arquivo por serem pequenos e usados em todas as telas.
 * Tudo é acessível: rótulos ligados aos campos, erros anunciados e
 * áreas de toque de no mínimo 44px no celular.
 */
import { Loader2 } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonStyles, cn, type Variant } from "./styles";

// Reexporta para os componentes do navegador continuarem importando daqui
export { buttonStyles, cn };

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: Variant }) {
  return <button type={type} className={buttonStyles(variant, className)} {...props} />;
}

/** Botão de envio que mostra "carregando" enquanto o formulário é processado. */
export function SubmitButton({
  children,
  pendingText = "Salvando...",
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: Variant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonStyles(variant, className)}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? pendingText : children}
    </button>
  );
}

/* --------------------------------- Campos ---------------------------------- */

const inputBase =
  "mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 text-[0.95rem] text-ink ring-1 ring-line outline-none transition sm:min-h-10 " +
  "focus:ring-2 focus:ring-crm aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-alert disabled:bg-fog";

interface FieldProps {
  label: string;
  name: string;
  /** id do campo; padrão = name. Informe quando o mesmo formulário se repete na página. */
  id?: string;
  error?: string;
  hint?: string;
  className?: string;
}

function FieldShell({ label, id, error, hint, className, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
      {error ? (
        <p id={`${id}-erro`} className="mt-1 text-sm font-semibold text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  name,
  id = name,
  error,
  hint,
  className,
  ...input
}: FieldProps & Omit<ComponentPropsWithoutRef<"input">, "name">) {
  return (
    <FieldShell label={label} name={name} id={id} error={error} hint={hint} className={className}>
      <input
        id={id}
        name={name}
        className={inputBase}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-erro` : undefined}
        {...input}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  id = name,
  error,
  hint,
  className,
  children,
  ...select
}: FieldProps & Omit<ComponentPropsWithoutRef<"select">, "name">) {
  return (
    <FieldShell label={label} name={name} id={id} error={error} hint={hint} className={className}>
      <select
        id={id}
        name={name}
        className={inputBase}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-erro` : undefined}
        {...select}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextareaField({
  label,
  name,
  id = name,
  error,
  hint,
  className,
  ...area
}: FieldProps & Omit<ComponentPropsWithoutRef<"textarea">, "name">) {
  return (
    <FieldShell label={label} name={name} id={id} error={error} hint={hint} className={className}>
      <textarea
        id={id}
        name={name}
        className={cn(inputBase, "min-h-24 py-2.5")}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-erro` : undefined}
        {...area}
      />
    </FieldShell>
  );
}

/* ------------------------------ Mensagens ---------------------------------- */

/** Mensagem geral de um formulário (sucesso ou erro), anunciada a leitores de tela. */
export function FormMessage({ state }: { state: { ok?: boolean; message?: string } }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn(
        "rounded-xl px-3 py-2 text-sm font-semibold",
        state.ok ? "bg-ok-tint text-ok-ink" : "bg-alert-tint text-alert",
      )}
    >
      {state.message}
    </p>
  );
}
