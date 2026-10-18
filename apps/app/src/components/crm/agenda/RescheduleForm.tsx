"use client";

import { useActionState, useEffect, useEffectEvent, useState } from "react";
import { CheckboxField, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import type { ActionState } from "@/lib/server";
import { rescheduleAppointmentAction } from "@/modules/crm/actions/agenda";
import { DURATIONS } from "@/components/shell/ScheduleDialog";

/**
 * REMARCAR (dentro do detalhe da consulta)
 * 1. Escolha o profissional (o mesmo, por padrão) e a partir de que dia procurar.
 * 2. Toque num horário livre (o horário atual da consulta conta como livre).
 * 3. Opcional: avisar o paciente pelo canal dele.
 * Se o horário desejado não aparece na lista, "Outro horário" permite digitar.
 */
interface Slot {
  startsAt: string;
  date: string;
  time: string;
  label: string;
}

export function RescheduleForm({
  appt,
  professionals,
  today,
  onDone,
}: {
  appt: { id: string; version: number; professionalId: string; startsAt: string };
  professionals: { id: string; name: string }[];
  today: string;
  onDone: (state: ActionState) => void;
}) {
  const [state, action] = useActionState(rescheduleAppointmentAction, {});
  const [pro, setPro] = useState(appt.professionalId);
  const [since, setSince] = useState(today);
  const [picked, setPicked] = useState<{ date: string; time: string } | null>(null);
  const [manual, setManual] = useState(false);
  // Horários guardados com a "chave" da busca (evita limpar estado dentro do efeito)
  const key = `${pro}|${since}`;
  const [loaded, setLoaded] = useState<{ key: string; slots: Slot[] } | null>(null);
  // O horário atual da própria consulta não é opção (seria "remarcar para o mesmo horário")
  const slots = loaded?.key === key ? loaded.slots.filter((x) => !(pro === appt.professionalId && x.startsAt === appt.startsAt)) : null;

  useEffect(() => {
    let cancelled = false;
    const k = `${pro}|${since}`;
    fetch(`/api/agenda/horarios?prof=${pro}&desde=${since}&dias=7&limite=24&ignorar=${appt.id}`)
      .then((r) => r.json())
      .then((d: { slots: Slot[] }) => !cancelled && setLoaded({ key: k, slots: d.slots }))
      .catch(() => !cancelled && setLoaded({ key: k, slots: [] }));
    return () => {
      cancelled = true;
    };
  }, [pro, since, appt.id]);

  // Avisar o diálogo (fechar formulário, oferecer horário liberado) fora da renderização
  const notifyDone = useEffectEvent(onDone);
  useEffect(() => {
    if (state.ok) notifyDone(state);
  }, [state]);

  // Agrupa os horários por dia para ficar fácil de ler
  const byDay = new Map<string, Slot[]>();
  for (const s of slots ?? []) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);

  return (
    <div className="space-y-3 rounded-xl bg-crm-tint/50 p-3">
      <FormMessage state={state} />
      {/* Filtros FORA do <form>: o React limpa o formulário após cada envio, e
          isso desalinharia o profissional exibido do escolhido */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Profissional"
          name="_pro"
          id="rs-pro"
          value={pro}
          onChange={(e) => {
            setPro(e.target.value);
            setPicked(null);
          }}
        >
          {professionals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <Field label="Procurar a partir de" name="_since" id="rs-since" type="date" min={today} value={since} onChange={(e) => setSince(e.target.value || today)} />
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={appt.id} />
        <input type="hidden" name="version" value={appt.version} />
        <input type="hidden" name="professionalId" value={pro} />

      {manual ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data" name="date" id="rs-date" type="date" min={today} defaultValue={picked?.date ?? since} error={state.errors?.date} />
          <Field label="Horário" name="time" id="rs-time" type="time" defaultValue={picked?.time ?? ""} error={state.errors?.time} />
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold">Horários livres</p>
          {slots === null ? <p className="text-sm text-ink-soft">Procurando...</p> : null}
          {slots?.length === 0 ? <p className="text-sm text-ink-soft">Nenhum horário livre nestes 7 dias. Tente outra data ou outro profissional.</p> : null}
          <div className="mt-1 max-h-56 space-y-2 overflow-y-auto">
            {[...byDay.entries()].map(([date, list]) => (
              <div key={date}>
                <p className="text-xs text-ink-soft">{list[0]!.label.replace(/ às .*/, "")}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {list.map((s) => {
                    const on = picked?.date === s.date && picked.time === s.time;
                    return (
                      <button
                        key={s.startsAt}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked({ date: s.date, time: s.time })}
                        className={cn("min-h-10 rounded-full px-3 text-sm font-semibold ring-1", on ? "bg-crm text-white ring-crm" : "bg-paper ring-line hover:ring-crm")}
                      >
                        {s.time}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {picked ? (
            <>
              <input type="hidden" name="date" value={picked.date} />
              <input type="hidden" name="time" value={picked.time} />
            </>
          ) : null}
          {state.errors?.time && !picked ? <p className="mt-1 text-sm font-semibold text-alert">Escolha um horário.</p> : null}
        </div>
      )}
      <button type="button" onClick={() => setManual((v) => !v)} className="min-h-10 text-sm font-semibold text-crm hover:underline">
        {manual ? "Ver horários livres" : "Outro horário (digitar)"}
      </button>

      <SelectField label="Duração" name="durationMinutes" id="rs-duration" defaultValue="">
        <option value="">Manter (ou padrão do profissional)</option>
        {DURATIONS.map((m) => (
          <option key={m} value={m}>
            {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`}
          </option>
        ))}
      </SelectField>
      <CheckboxField name="notify" defaultChecked label="Avisar o paciente do novo horário" hint="Mensagem pelo canal preferido. Não envia para quem pediu SAIR." />
      {!state.ok && (state.data as { warning?: boolean } | undefined)?.warning ? (
        <CheckboxField name="force" label="Remarcar mesmo assim" hint="Fora do expediente ou paciente com outra consulta no horário." />
      ) : null}
      <SubmitButton pendingText="Remarcando..." disabled={!manual && !picked}>
        Confirmar remarcação
      </SubmitButton>
      </form>
    </div>
  );
}
