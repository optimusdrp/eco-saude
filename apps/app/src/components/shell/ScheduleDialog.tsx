"use client";

import { WAITLIST_PERIOD_LABEL, type WaitlistPeriod } from "@ecosaude/core/crm";
import { AlertTriangle, Bot, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { ContactForm } from "@/components/crm/patients/ContactForm";
import type { FreeSlot, ScheduleSuggestion } from "@/lib/events";
import { useAppEvent } from "@/lib/hooks";
import { createAppointmentAction } from "@/modules/crm/actions/agenda";

/**
 * AGENDAR SEM SAIR DO LUGAR
 * Um único diálogo de agendamento, aberto de qualquer tela
 * (conversa, agenda, trilho do paciente, ficha, Ctrl+K) com:
 *  - horários livres do profissional já calculados (sem olhar a grade)
 *  - opção de avisar o paciente na própria conversa
 *  - "Agendar pelo pedido" (conversa): chega com o que foi entendido da mensagem
 *    (IA ou regras) e mostra SÓ os horários livres que batem com o pedido.
 *    Os horários vêm da agenda real; a recepção confere e confirma.
 */
export interface ProfessionalOption {
  id: string;
  name: string;
  specialty: string | null;
  slotMinutes: number;
}

/** Durações oferecidas além da padrão do profissional */
export const DURATIONS = [15, 20, 30, 40, 45, 60, 90, 120, 180];

type Slot = FreeSlot;

export function ScheduleDialog({ professionals }: { professionals: ProfessionalOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id ?? "");
  const [period, setPeriod] = useState<WaitlistPeriod>("qualquer");
  const [service, setService] = useState("");
  // Horários guardados junto da "chave" da busca: trocar profissional/período
  // mostra "carregando" sem precisar limpar o estado dentro do efeito
  const [loaded, setLoaded] = useState<{ key: string; slots: Slot[] } | null>(null);
  // Duração ("" = padrão do profissional)
  const [duration, setDuration] = useState("");
  // Cadastro de paciente novo dentro do agendamento (nome já digitado na busca)
  const [creating, setCreating] = useState<string | null>(null);
  const slotsKey = `${professionalId}|${period}|${duration}`;
  const slots = loaded?.key === slotsKey ? loaded.slots : null;
  const [picked, setPicked] = useState<{ date: string; time: string } | null>(null);
  const [manual, setManual] = useState(false);
  // Horário vindo de um clique na grade da agenda
  const [preset, setPreset] = useState<{ date: string; time: string } | null>(null);
  // Pedido entendido da conversa ("Agendar pelo pedido") e se a pessoa quer ver todos os horários
  const [suggestion, setSuggestion] = useState<ScheduleSuggestion | null>(null);
  // Duração real (Ajustes > IA > Duração real): a aplicada/medida para este profissional e procedimento
  const [durationHint, setDurationHint] = useState<{ key: string; minutes: number; source: "aplicada" | "sugerida"; n?: number } | null>(null);
  const [durationTouched, setDurationTouched] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [state, action] = useActionState(createAppointmentAction, {});
  const [handled, setHandled] = useState<typeof state | null>(null);

  useAppEvent("eco:open-schedule", (detail) => {
    setContact(detail?.contactId ? { id: detail.contactId, name: detail.contactName ?? "Paciente" } : null);
    setConversationId(detail?.conversationId);
    if (detail?.professionalId) setProfessionalId(detail.professionalId);
    setService(detail?.service ?? "");
    setPicked(null);
    setPreset(detail?.date && detail.time ? { date: detail.date, time: detail.time } : null);
    setManual(Boolean(detail?.date && detail.time));
    setDuration("");
    setDurationTouched(false);
    setDurationHint(null);
    setCreating(null);
    const sug = detail?.suggestion ?? null;
    setSuggestion(sug);
    setShowAll(false);
    setPeriod(sug?.period ?? "qualquer");
    if (sug) {
      setProfessionalId(sug.professionalId);
      setService(sug.service ?? detail?.service ?? "");
      setPicked(sug.preselect);
      setManual(false);
    }
    setHandled(state);
    setOpen(true);
  });
  // Os horários do pedido valem enquanto profissional, período e duração forem os sugeridos
  const usingSuggestion = !!suggestion && !showAll && professionalId === suggestion.professionalId && period === suggestion.period && duration === "";
  const shownSlots = usingSuggestion ? suggestion.slots : slots;

  // Horários livres do profissional escolhido
  useEffect(() => {
    if (!open || !professionalId) return;
    let cancelled = false;
    const key = `${professionalId}|${period}|${duration}`;
    fetch(`/api/agenda/horarios?prof=${professionalId}&periodo=${period}${duration ? `&duracao=${duration}` : ""}`)
      .then((r) => r.json())
      .then((d: { slots: Slot[] }) => !cancelled && setLoaded({ key, slots: d.slots }))
      .catch(() => !cancelled && setLoaded({ key, slots: [] }));
    return () => {
      cancelled = true;
    };
  }, [open, professionalId, period, duration]);

  // Duração sugerida para o profissional + procedimento (espera a digitação parar)
  useEffect(() => {
    if (!open || !professionalId) return;
    let cancelled = false;
    const key = `${professionalId}|${service.trim().toLowerCase()}`;
    const t = window.setTimeout(() => {
      fetch(`/api/agenda/duracao?prof=${professionalId}&servico=${encodeURIComponent(service.trim())}`)
        .then((r) => r.json())
        .then((d: { minutes: number | null; source?: "aplicada" | "sugerida"; n?: number }) => {
          if (cancelled) return;
          setDurationHint(d.minutes ? { key, minutes: d.minutes, source: d.source ?? "sugerida", n: d.n } : null);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, professionalId, service]);
  // Aplica a duração sugerida sozinho (se a pessoa não escolheu outra e não está usando os horários do pedido)
  const hintKey = `${professionalId}|${service.trim().toLowerCase()}`;
  const hint = durationHint?.key === hintKey ? durationHint : null;
  if (hint && !durationTouched && !suggestion && duration !== String(hint.minutes)) {
    setDuration(String(hint.minutes));
    setPicked(null);
  }

  // Deu certo: fecha o diálogo (ajuste de estado durante a renderização, padrão do React)...
  if (state !== handled && state.ok) {
    setHandled(state);
    setOpen(false);
  }
  // ...e atualiza a tela de trás (efeito colateral fica no useEffect)
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Agendar consulta" description={contact ? `Para ${contact.name}` : "Escolha o paciente, o profissional e o horário."} wide>
      {creating !== null ? (
        /* Paciente novo: o cadastro (com verificação de duplicidade) fica FORA do formulário do agendamento */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Cadastrar paciente</p>
            <button type="button" onClick={() => setCreating(null)} className="min-h-10 text-sm font-semibold text-crm hover:underline">
              Voltar à busca
            </button>
          </div>
          <ContactForm
            idPrefix="sched-new"
            initialName={creating}
            onUseExisting={(c) => {
              setContact(c);
              setCreating(null);
            }}
            onDone={(id, name) => {
              if (id) setContact({ id, name: name ?? creating });
              setCreating(null);
            }}
          />
        </div>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          {state !== handled ? <FormMessage state={state} /> : null}

          {suggestion ? (
            <>
              <input type="hidden" name="aiSuggestionId" value={suggestion.id} />
              <SuggestionBanner s={suggestion} />
            </>
          ) : null}

          {contact ? (
            <input type="hidden" name="contactId" value={contact.id} />
          ) : (
            <ContactPicker onPick={setContact} onCreate={setCreating} error={state !== handled ? state.errors?.contactId : undefined} />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Profissional"
              name="professionalId"
              value={professionalId}
              onChange={(e) => {
                setProfessionalId(e.target.value);
                setPicked(null);
              }}
            >
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.specialty ? `, ${p.specialty}` : ""}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Período"
              name="_period"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as WaitlistPeriod);
                setPicked(null);
              }}
            >
              {Object.entries(WAITLIST_PERIOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
          </div>

          {/* Horários livres em um toque */}
          {!manual ? (
            <fieldset>
              <legend className="text-sm font-semibold">{usingSuggestion ? "Horários livres que batem com o pedido" : "Próximos horários livres"}</legend>
              {shownSlots === null ? (
                <p className="mt-2 text-sm text-ink-soft">Calculando horários...</p>
              ) : shownSlots.length === 0 ? (
                <p className="mt-2 text-sm text-ink-soft">Nenhum horário livre nos próximos 14 dias neste período.</p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {shownSlots.map((s) => {
                    const active = picked?.date === s.date && picked.time === s.time;
                    return (
                      <button
                        key={s.startsAt}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPicked({ date: s.date, time: s.time })}
                        className={cn("min-h-11 rounded-xl px-2 text-sm font-semibold ring-1 transition-colors", active ? "bg-crm text-white ring-crm" : "bg-paper ring-line hover:ring-crm")}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4">
                {usingSuggestion ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAll(true);
                      setPicked(null);
                    }}
                    className="min-h-10 text-sm font-semibold text-crm hover:underline"
                  >
                    Ver todos os horários livres
                  </button>
                ) : null}
                <button type="button" onClick={() => setManual(true)} className="min-h-10 text-sm font-semibold text-crm hover:underline">
                  Escolher outro dia e hora
                </button>
              </div>
              {picked ? (
                <>
                  <input type="hidden" name="date" value={picked.date} />
                  <input type="hidden" name="time" value={picked.time} />
                </>
              ) : null}
              {state !== handled && (state.errors?.date || state.errors?.time) && !picked ? <p className="mt-1 text-sm font-semibold text-alert">Escolha um horário.</p> : null}
            </fieldset>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data" name="date" type="date" defaultValue={preset?.date} error={state !== handled ? state.errors?.date : undefined} />
              <Field label="Hora" name="time" type="time" step={300} defaultValue={preset?.time} error={state !== handled ? state.errors?.time : undefined} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Serviço" name="service" value={service} onChange={(e) => setService(e.target.value)} placeholder="Ex.: Consulta, Retorno, Avaliação" />
            <SelectField
              label="Duração"
              name="durationMinutes"
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value);
                setDurationTouched(true);
                setPicked(null);
              }}
            >
              <option value="">Padrão ({professionals.find((p) => p.id === professionalId)?.slotMinutes ?? 30} min)</option>
              {[...new Set([...DURATIONS, ...(hint ? [hint.minutes] : [])])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`}
                  </option>
                ))}
            </SelectField>
          </div>
          {hint ? (
            <p className="-mt-2 text-xs text-ink-soft">
              {hint.source === "aplicada"
                ? `Duração definida pela clínica para este procedimento: ${hint.minutes} min.`
                : `Duração real deste procedimento com este profissional: ${hint.minutes} min (${hint.n ?? 5}+ atendimentos medidos).`}
              {suggestion && duration !== String(hint.minutes) ? (
                <button
                  type="button"
                  onClick={() => {
                    setDuration(String(hint.minutes));
                    setDurationTouched(true);
                    setPicked(null);
                  }}
                  className="ml-1 font-semibold text-crm hover:underline"
                >
                  Usar {hint.minutes} min
                </button>
              ) : null}
            </p>
          ) : null}
          <Field key={suggestion?.id ?? "sem-pedido"} label="Observação para a equipe" name="notes" defaultValue={suggestion?.quote ? `Pedido do paciente: “${suggestion.quote}”` : undefined} />

          {conversationId ? (
            <>
              <input type="hidden" name="notifyConversationId" value={conversationId} />
              <input type="hidden" name="source" value="conversa" />
              <CheckboxField name="notify" defaultChecked label="Avisar o paciente na conversa" hint="Envia data, hora e profissional pelo mesmo canal." />
            </>
          ) : (
            <input type="hidden" name="source" value="recepcao" />
          )}

          {state !== handled && (state.data as { warning?: boolean } | undefined)?.warning ? (
            <CheckboxField name="force" label="Marcar mesmo assim" hint="Use só se combinou com o profissional ou o paciente." />
          ) : null}

          <SubmitButton pendingText="Agendando..." className="w-full sm:w-auto">
            Confirmar agendamento
          </SubmitButton>
        </form>
      )}
    </Dialog>
  );
}

/** O que foi entendido da conversa, com a origem e os avisos (a recepção confere). */
function SuggestionBanner({ s }: { s: ScheduleSuggestion }) {
  const ai = s.source === "ia";
  return (
    <section aria-label="Pedido do paciente" className={cn("rounded-xl p-3 ring-1", ai ? "bg-crm-tint/50 ring-crm/30" : "bg-fog ring-line")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", ai ? "bg-crm text-white" : "bg-paper text-ink-soft ring-1 ring-line")}>
          {ai ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          {ai ? "Entendido pela IA" : "Entendido pelas regras"}
        </span>
        {!ai && s.fallbackReason ? <span className="text-ink-soft">sem IA: {s.fallbackReason}</span> : null}
      </div>
      {s.chips.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="O que o paciente pediu">
          {s.chips.map((c) => (
            <li key={c} className="rounded-full bg-paper px-2.5 py-1 text-sm font-semibold ring-1 ring-line">
              {c}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">Não deu para entender dia, período ou profissional na conversa.</p>
      )}
      {s.quote ? <p className="mt-1.5 text-xs text-ink-soft">“{s.quote}”</p> : null}
      {s.warnings.length ? (
        <ul className="mt-2 space-y-0.5">
          {s.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-xs text-erp-ink">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 text-xs text-ink-soft">Confira antes de confirmar: nada é marcado sem o seu clique.</p>
    </section>
  );
}

/** Busca de paciente por nome ou telefone. */
function ContactPicker({
  onPick,
  onCreate,
  error,
}: {
  onPick: (c: { id: string; name: string }) => void;
  /** Paciente não encontrado: abre o cadastro já com o nome digitado */
  onCreate: (name: string) => void;
  error?: string;
}) {
  const [q, setQ] = useState("");
  // Resultado guardado junto do termo buscado (sabemos quando a busca terminou sem nada)
  const [found, setFound] = useState<{ q: string; results: { id: string; name: string; phone: string | null }[] } | null>(null);
  const results = found?.q === q ? found.results : [];
  const searched = found?.q === q;

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = window.setTimeout(() => {
      fetch(`/api/busca?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setFound({ q, results: (d.results ?? []).filter((x: { kind?: string }) => !x.kind || x.kind === "contato") }))
        .catch(() => setFound({ q, results: [] }));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div>
      <label htmlFor="schedule-search" className="text-sm font-semibold">
        Paciente
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
        <input
          id="schedule-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome ou telefone"
          autoComplete="off"
          className="block min-h-11 w-full rounded-xl bg-paper pr-3 pl-9 ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
          aria-invalid={!!error}
        />
      </div>
      {error ? <p className="mt-1 text-sm font-semibold text-alert">{error}</p> : null}
      {q.trim().length >= 2 && results.length ? (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick({ id: r.id, name: r.name })} className="flex min-h-11 w-full items-center justify-between px-3 text-left hover:bg-crm-tint">
                <span className="font-semibold">{r.name}</span>
                <span className="text-xs text-ink-soft">{r.phone ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {q.trim().length >= 2 && searched && results.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Ninguém encontrado com esse nome ou telefone.</p> : null}
      <button type="button" onClick={() => onCreate(/\d{6,}/.test(q) ? "" : q.trim())} className="mt-2 min-h-10 text-sm font-semibold text-crm hover:underline">
        + {q.trim().length >= 2 && !/\d{6,}/.test(q) ? `Cadastrar “${q.trim()}” como novo paciente` : "Cadastrar novo paciente"}
      </button>
    </div>
  );
}
