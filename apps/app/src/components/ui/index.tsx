"use client";

/**
 * Componentes interativos de formulário e diálogo do ambiente da clínica.
 * Acessíveis: rótulos ligados aos campos, erros anunciados, área de toque
 * mínima de 44px no celular.
 */
import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonStyles, cn, type Variant } from "./styles";

export { buttonStyles, cn };

/* --------------------------------- Botões ---------------------------------- */

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
  name,
  value,
  disabled = false,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: Variant;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  /** Nome acessível quando o texto do botão é curto ("Chegou") e há vários iguais na tela */
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} aria-busy={pending} aria-label={ariaLabel} className={buttonStyles(variant, className)}>
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
  /** id do campo; padrão = name. Informe quando o formulário se repete na página. */
  id?: string;
  error?: string;
  hint?: string;
  className?: string;
}

/**
 * Campo CONTROLADO (com `value`) dentro de <form action={...}>: depois de cada
 * envio o React limpa o formulário (form.reset()), e o navegador volta o campo
 * para o valor inicial, mas o estado do componente continua o mesmo. Resultado:
 * a tela mostra uma coisa e o próximo envio manda outra.
 * Este hook escuta o "reset" do formulário e devolve o valor controlado ao campo.
 */
function useKeepValueOnReset<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(value: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    const form = el?.form;
    if (!el || !form || value === undefined || value === null) return;
    const restore = () => {
      // O reset acontece depois do evento: aplica no próximo quadro
      requestAnimationFrame(() => {
        if (el.value !== String(value)) el.value = String(value);
      });
    };
    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
  }, [value]);
  return ref;
}

function FieldShell({ label, id, error, hint, className, children }: Omit<FieldProps, "name"> & { id: string; children: ReactNode }) {
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

export function Field({ label, name, id = name, error, hint, className, ...input }: FieldProps & Omit<ComponentPropsWithoutRef<"input">, "name" | "id">) {
  const ref = useKeepValueOnReset<HTMLInputElement>(input.value);
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <input ref={ref} id={id} name={name} className={inputBase} aria-invalid={!!error} aria-describedby={error ? `${id}-erro` : undefined} {...input} />
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
}: FieldProps & Omit<ComponentPropsWithoutRef<"select">, "name" | "id">) {
  const ref = useKeepValueOnReset<HTMLSelectElement>(select.value);
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <select ref={ref} id={id} name={name} className={inputBase} aria-invalid={!!error} aria-describedby={error ? `${id}-erro` : undefined} {...select}>
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
}: FieldProps & Omit<ComponentPropsWithoutRef<"textarea">, "name" | "id">) {
  const ref = useKeepValueOnReset<HTMLTextAreaElement>(area.value);
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <textarea
        ref={ref}
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

/** Caixa de seleção com rótulo clicável e área de toque grande. */
export function CheckboxField({ label, hint, className, ...input }: { label: string; hint?: string; className?: string } & ComponentPropsWithoutRef<"input">) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-1.5", className)}>
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-crm)]" {...input} />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-ink-soft">{hint}</span> : null}
      </span>
    </label>
  );
}

/* ------------------------------ Mensagens ---------------------------------- */

export function FormMessage({ state }: { state: { ok?: boolean; message?: string } }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn("rounded-xl px-3 py-2 text-sm font-semibold", state.ok ? "bg-pep-tint text-pep-ink" : "bg-alert-tint text-alert")}
    >
      {state.message}
    </p>
  );
}

/* -------------------------------- Diálogo ---------------------------------- */

/**
 * Diálogo modal usando o <dialog> nativo do navegador:
 * prende o foco, fecha com Esc e devolve o foco ao botão que abriu.
 * No celular ocupa a largura toda e "sobe" de baixo (estilo folha).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // id único: vários diálogos na mesma página não podem compartilhar o mesmo título
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby={titleId}
      className={cn(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl bg-paper p-0 text-ink shadow-2xl",
        "sm:m-auto sm:rounded-3xl",
        wide ? "sm:max-w-3xl" : "sm:max-w-lg",
      )}
    >
      {open ? (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-bold">
                {title}
              </h2>
              {description ? <div className="mt-0.5 text-sm text-ink-soft">{description}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-soft hover:bg-ink/5 hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>
          <div className="thin-scroll overflow-y-auto px-5 py-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
