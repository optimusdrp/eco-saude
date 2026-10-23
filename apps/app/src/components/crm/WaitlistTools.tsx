"use client";

import { WAITLIST_PERIOD_LABEL } from "@ecosaude/core/crm";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Dialog, FormMessage, SelectField, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { addToWaitlistAction } from "@/modules/crm/actions/agenda";
import { OfferPanel } from "./agenda/OfferPanel";

interface Pro {
  id: string;
  name: string;
  /** Duração da consulta (para calcular o fim do horário oferecido) */
  slotMinutes?: number;
}

/** Botão + diálogo para colocar um paciente na lista de espera. */
export function AddToWaitlist({
  professionals,
  contact,
  entry,
  units = [],
}: {
  professionals: Pro[];
  contact?: { id: string; name: string };
  /** Entrada existente: o botão vira "Editar" e mantém o lugar na fila */
  entry?: { professionalId: string | null; period: string; notes: string | null; unitId?: string | null };
  /** Unidades da clínica (a escolha só aparece com mais de uma) */
  units?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(addToWaitlistAction, {});
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(contact ?? null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [handled, setHandled] = useState(state);

  if (state !== handled) {
    setHandled(state);
    if (state.ok) setOpen(false);
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = window.setTimeout(() => {
      fetch(`/api/busca?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles(entry ? "ghost" : contact ? "secondary" : "primary")}>
        {entry ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {entry ? "Editar" : contact ? "Lista de espera" : "Adicionar à lista"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Lista de espera" description="Quando abrir um horário que combine, o paciente recebe a oferta automaticamente.">
        <form action={action} className="space-y-4">
          <FormMessage state={state} />
          {picked ? (
            <div className="flex items-center justify-between rounded-xl bg-fog px-3 py-2">
              <span className="font-semibold">{picked.name}</span>
              {!contact ? (
                <button type="button" onClick={() => setPicked(null)} className="text-sm font-semibold text-crm">
                  Trocar
                </button>
              ) : null}
              <input type="hidden" name="contactId" value={picked.id} />
            </div>
          ) : (
            <div>
              <label htmlFor="wl-search" className="text-sm font-semibold">
                Paciente
              </label>
              <input
                id="wl-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nome ou telefone"
                className="mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
              />
              {state.errors?.contactId ? <p className="mt-1 text-sm font-semibold text-alert">{state.errors.contactId}</p> : null}
              {q.trim().length >= 2 && results.length ? (
                <ul className="mt-2 divide-y divide-line rounded-xl ring-1 ring-line">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setPicked(r)} className="min-h-11 w-full px-3 text-left font-semibold hover:bg-crm-tint">
                        {r.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {units.length > 1 ? (
              <SelectField label="Unidade" name="unitId" id="wl-unit" defaultValue={entry?.unitId ?? ""} hint="Onde o paciente aceita ser atendido." className="sm:col-span-2">
                <option value="">Qualquer unidade</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <SelectField label="Profissional" name="professionalId" id="wl-pro" defaultValue={entry?.professionalId ?? ""}>
              <option value="">Qualquer profissional</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Período" name="period" id="wl-period" defaultValue={entry?.period ?? "qualquer"}>
              {Object.entries(WAITLIST_PERIOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
          </div>
          <TextareaField label="Observação" name="notes" id="wl-notes" placeholder="Ex.: pode vir em cima da hora" defaultValue={entry?.notes ?? ""} />
          <SubmitButton>{entry ? "Salvar" : "Colocar na lista"}</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

/** Escolher um horário livre de um profissional e oferecer à lista de espera. */
export function OfferFreeSlot({ professionals }: { professionals: Pro[] }) {
  const [pro, setPro] = useState(professionals[0]?.id ?? "");
  const [slots, setSlots] = useState<{ startsAt: string; label: string }[] | null>(null);
  const [chosen, setChosen] = useState<{ startsAt: string; label: string } | null>(null);
  const slotMinutes = professionals.find((p) => p.id === pro)?.slotMinutes ?? 30;

  useEffect(() => {
    if (!pro) return;
    let cancelled = false;
    fetch(`/api/agenda/horarios?prof=${pro}&dias=7`)
      .then((r) => r.json())
      .then((d) => !cancelled && setSlots(d.slots ?? []))
      .catch(() => !cancelled && setSlots([]));
    return () => {
      cancelled = true;
    };
  }, [pro]);

  return (
    <div className="space-y-3">
      <SelectField label="Profissional" name="_pro" id="offer-pro" value={pro} onChange={(e) => { setPro(e.target.value); setChosen(null); setSlots(null); }}>
        {professionals.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      {slots === null ? <p className="text-sm text-ink-soft">Calculando horários livres...</p> : null}
      {slots?.length === 0 ? <p className="text-sm text-ink-soft">Sem horários livres nos próximos 7 dias.</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {slots?.slice(0, 8).map((s) => (
          <button
            key={s.startsAt}
            type="button"
            onClick={() => setChosen(s)}
            aria-pressed={chosen?.startsAt === s.startsAt}
            className={cn("min-h-10 rounded-full px-3 text-sm font-semibold ring-1", chosen?.startsAt === s.startsAt ? "bg-crm text-white ring-crm" : "bg-paper ring-line hover:ring-crm")}
          >
            {s.label}
          </button>
        ))}
      </div>
      {chosen ? (
        <OfferPanel
          key={chosen.startsAt}
          slot={{
            professionalId: pro,
            startsAt: chosen.startsAt,
            endsAt: new Date(new Date(chosen.startsAt).getTime() + slotMinutes * 60_000).toISOString(),
            label: `Horário ${chosen.label} com ${professionals.find((p) => p.id === pro)?.name ?? ""}`,
          }}
        />
      ) : null}
    </div>
  );
}
