"use client";

import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { moduleColor } from "@/components/ui/ModuleTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { modules } from "@/content/modules";
import { cn } from "@/lib/cn";
import { contactSchema, flattenErrors } from "@ecosaude/core/validation";

/**
 * Formulário "Pedir demonstração".
 * Fluxo: valida no navegador (zod) -> envia para /api/contato -> a API
 * valida de novo -> mostra a confirmação.
 */
type Status = "idle" | "sending" | "sent" | "error";

const sizes = [
  { value: "1-3", label: "1 a 3" },
  { value: "4-10", label: "4 a 10" },
  { value: "11-30", label: "11 a 30" },
  { value: "31+", label: "Mais de 30" },
] as const;

/** Classe padrão dos campos de texto (altura mínima de 48px para toque). */
const inputClass =
  "mt-1.5 block min-h-12 w-full rounded-xl bg-paper px-4 text-base text-ink ring-1 ring-line outline-none transition focus:ring-2 focus:ring-crm aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-alert";

export function Contact() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    // Monta o objeto no formato que o schema espera
    const data = {
      name: form.get("name"),
      email: form.get("email"),
      clinic: form.get("clinic"),
      size: form.get("size") ?? undefined,
      interests: form.getAll("interests"),
      consent: form.get("consent") === "on",
      website: form.get("website") || undefined,
    };

    const parsed = contactSchema.safeParse(data);
    if (!parsed.success) {
      const found = flattenErrors(parsed.error);
      setErrors(found);
      // leva o foco ao primeiro campo com erro (acessibilidade)
      const first = Object.keys(found)[0];
      if (first) event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setErrors({});
    setStatus("sending");
    try {
      const res = await fetch("/api/contato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 422) {
        const body = (await res.json()) as { errors?: Record<string, string> };
        setErrors(body.errors ?? {});
        setStatus("idle");
        return;
      }
      if (!res.ok) {
        setErrorText(
          res.status === 429
            ? "Recebemos muitos envios deste endereço. Tente de novo em uma hora."
            : "Não foi possível enviar agora. Confira sua conexão e tente de novo.",
        );
      }
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setErrorText("Não foi possível enviar agora. Confira sua conexão e tente de novo.");
      setStatus("error");
    }
  }

  /** Mensagem de erro de um campo, ligada ao campo por aria-describedby. */
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`${name}-erro`} className="mt-1.5 text-sm font-semibold text-alert">
        {errors[name]}
      </p>
    ) : null;

  return (
    <section id="demonstracao" aria-labelledby="demo-title" className="py-20 lg:py-28">
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <SectionHeading id="demo-title" title="Veja com os dados da sua rotina">
          Conte um pouco sobre a clínica e mostramos, em 30 minutos, como o Tropi Atendimento funciona
          na sua realidade. Sem compromisso.
        </SectionHeading>

        <div className="rounded-3xl bg-paper p-5 ring-1 ring-line sm:p-8">
          {status === "sent" ? (
            <div className="py-10 text-center" role="status">
              <CheckCircle2 className="mx-auto size-12 text-ok" aria-hidden />
              <h3 className="mt-4 text-2xl font-bold">Pedido enviado</h3>
              <p className="mx-auto mt-2 max-w-sm text-ink-soft">
                Vamos responder por e-mail com opções de horário.
              </p>
            </div>
          ) : (
            <form noValidate onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="font-semibold">Seu nome</label>
                <input id="name" name="name" autoComplete="name" className={inputClass}
                  aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-erro" : undefined} />
                {fieldError("name")}
              </div>

              <div>
                <label htmlFor="email" className="font-semibold">E-mail</label>
                <input id="email" name="email" type="email" autoComplete="email" inputMode="email" className={inputClass}
                  aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-erro" : undefined} />
                {fieldError("email")}
              </div>

              <div>
                <label htmlFor="clinic" className="font-semibold">Clínica</label>
                <input id="clinic" name="clinic" autoComplete="organization" className={inputClass}
                  aria-invalid={!!errors.clinic} aria-describedby={errors.clinic ? "clinic-erro" : undefined} />
                {fieldError("clinic")}
              </div>

              <div>
                <label htmlFor="size" className="font-semibold">Profissionais na clínica</label>
                <select id="size" name="size" defaultValue="" className={inputClass}
                  aria-invalid={!!errors.size} aria-describedby={errors.size ? "size-erro" : undefined}>
                  <option value="" disabled>Escolha</option>
                  {sizes.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                {fieldError("size")}
              </div>

              <fieldset className="sm:col-span-2" aria-describedby={errors.interests ? "interests-erro" : undefined}>
                <legend className="font-semibold">Módulos de interesse</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {modules.map((m) => (
                    <label key={m.id}
                      className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl px-3 ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-crm">
                      <input type="checkbox" name="interests" value={m.id} defaultChecked={m.id === "crm"} className="size-4 accent-[var(--color-crm)]" />
                      <span className={cn("size-2 rounded-full", moduleColor[m.id].dot)} aria-hidden />
                      {m.name}
                    </label>
                  ))}
                </div>
                {fieldError("interests")}
              </fieldset>

              {/* Campo-armadilha anti-robô: escondido de pessoas e leitores de tela */}
              <div className="hidden" aria-hidden>
                <label htmlFor="website">Site</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>

              <div className="sm:col-span-2">
                <label className="flex cursor-pointer items-start gap-3 text-[0.95rem] text-ink-soft">
                  <input type="checkbox" name="consent" className="mt-1 size-4 shrink-0 accent-[var(--color-crm)]"
                    aria-invalid={!!errors.consent} aria-describedby={errors.consent ? "consent-erro" : undefined} />
                  Autorizo o contato por e-mail para agendar a demonstração. Os dados não serão
                  usados para outra finalidade.
                </label>
                {fieldError("consent")}
              </div>

              <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center">
                <Button type="submit" variant="sun" size="lg" disabled={status === "sending"} className="sm:min-w-56">
                  {status === "sending" ? "Enviando..." : "Pedir demonstração"}
                </Button>
                {status === "error" ? (
                  <p className="text-sm font-semibold text-alert" role="alert">
                    {errorText}
                  </p>
                ) : null}
              </div>
            </form>
          )}
        </div>
      </Container>
    </section>
  );
}
