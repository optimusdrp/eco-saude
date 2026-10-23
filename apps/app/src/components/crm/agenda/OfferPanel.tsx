"use client";

import { WAITLIST_OFFER_SIZE } from "@ecosaude/core/crm";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { offerSlotAction } from "@/modules/crm/actions/agenda";

/**
 * CANCELOU? O HORÁRIO JÁ TEM DONO
 * Mostra quem da lista de espera combina com o horário liberado e oferece a
 * até 3 pessoas ao mesmo tempo. A primeira que responder SIM fica com a vaga
 * (automático, sem a recepção precisar acompanhar).
 */
interface Candidate {
  id: string;
  name: string;
  period: string;
  professional: string;
  since: string;
  notes: string | null;
  /** Encaixe inteligente: chance de aceitar (0 a 100) e motivos; null = ordem de chegada */
  score: number | null;
  reasons: string[];
  learned: boolean;
}

export function OfferPanel({
  slot,
  title = "Oferecer este horário à lista de espera",
}: {
  slot: { professionalId: string; startsAt: string; endsAt: string; appointmentId?: string; label: string };
  title?: string;
}) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [state, action] = useActionState(offerSlotAction, {});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agenda/candidatos?prof=${slot.professionalId}&inicio=${encodeURIComponent(slot.startsAt)}`)
      .then((r) => r.json())
      .then((d: { candidates: Candidate[] }) => {
        if (cancelled) return;
        setCandidates(d.candidates);
        // Já marca os primeiros da fila (ordem de chegada)
        setSelected(d.candidates.slice(0, WAITLIST_OFFER_SIZE).map((c) => c.id));
      })
      .catch(() => !cancelled && setCandidates([]));
    return () => {
      cancelled = true;
    };
  }, [slot.professionalId, slot.startsAt]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  if (state.ok) return <FormMessage state={state} />;

  return (
    <section className="rounded-2xl bg-erp-tint p-4" aria-label={title}>
      <h3 className="font-bold text-erp-ink">{title}</h3>
      <p className="text-sm text-erp-ink">{slot.label}. Quem responder SIM primeiro fica com a vaga; os outros continuam na lista.</p>
      {candidates?.some((c) => c.score !== null) ? (
        <p className="mt-1 text-xs text-erp-ink">
          Ordenado por chance de aceitar{candidates.some((c) => c.learned) ? " (aprendida com as ofertas desta clínica)" : ""}. Os primeiros já vêm marcados; ajuste se quiser.
        </p>
      ) : null}
      {candidates === null ? (
        <p className="mt-2 text-sm">Procurando na lista de espera...</p>
      ) : candidates.length === 0 ? (
        <p className="mt-2 text-sm">Ninguém da lista de espera combina com este horário.</p>
      ) : (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="professionalId" value={slot.professionalId} />
          <input type="hidden" name="startsAt" value={slot.startsAt} />
          <input type="hidden" name="endsAt" value={slot.endsAt} />
          <input type="hidden" name="originAppointmentId" value={slot.appointmentId ?? ""} />
          <FormMessage state={state} />
          <ul className="space-y-1.5">
            {candidates.map((c) => {
              const on = selected.includes(c.id);
              const full = !on && selected.length >= WAITLIST_OFFER_SIZE;
              return (
                <li key={c.id}>
                  <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-paper px-3 py-2 ring-1", on ? "ring-2 ring-erp" : "ring-line", full && "opacity-50")}>
                    <input
                      type="checkbox"
                      name="entryId"
                      value={c.id}
                      checked={on}
                      disabled={full}
                      onChange={() => setSelected((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                      className="size-4 accent-[var(--color-erp-ink)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{c.name}</span>
                        {c.score !== null ? (
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular",
                              c.score >= 50 ? "bg-ok-tint text-ok-ink" : c.score >= 25 ? "bg-erp-tint text-erp-ink" : "bg-fog text-ink-soft",
                            )}
                            title="Chance estimada de aceitar"
                          >
                            {c.score}% de chance
                          </span>
                        ) : null}
                      </span>
                      {c.reasons.length ? <span className="block text-xs font-semibold text-ink">{c.reasons.join(". ")}.</span> : null}
                      <span className="block text-xs text-ink-soft">
                        {c.period}, {c.professional}, na lista {c.since}
                        {c.notes ? `. ${c.notes}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <SubmitButton pendingText="Enviando ofertas..." className="w-full sm:w-auto">
            Oferecer a {selected.length} {selected.length === 1 ? "paciente" : "pacientes"}
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
