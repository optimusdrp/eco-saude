"use client";

import { useActionState, useEffect, useEffectEvent } from "react";
import { Field, FormMessage, SelectField, SubmitButton, TextareaField } from "@/components/ui";
import { updateAppointmentDetailsAction } from "@/modules/crm/actions/agenda";
import { DURATIONS } from "@/components/shell/ScheduleDialog";

/**
 * CORRIGIR DETALHES DA CONSULTA: serviço, observações, duração e consultório.
 * Aumentar a duração esbarra na consulta seguinte? O banco recusa e a tela avisa.
 */
export function DetailsForm({
  appt,
  canChangeDuration,
  onDone,
  rooms = [],
}: {
  appt: { id: string; version: number; service: string | null; notes: string | null; duration: number; roomId?: string | null };
  /** Consultórios da unidade da consulta (o servidor confere se está livre) */
  rooms?: { id: string; name: string }[];
  canChangeDuration: boolean;
  onDone: () => void;
}) {
  const [state, action] = useActionState(updateAppointmentDetailsAction, {});
  const done = useEffectEvent(onDone);
  useEffect(() => {
    if (state.ok) done();
  }, [state]);
  // A duração atual sempre aparece na lista, mesmo que não seja uma das padrão
  const options = [...new Set([...DURATIONS, appt.duration])].sort((a, b) => a - b);

  return (
    <form action={action} className="space-y-3 rounded-xl bg-fog p-3">
      <input type="hidden" name="id" value={appt.id} />
      <input type="hidden" name="version" value={appt.version} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Serviço" name="service" id="ad-service" defaultValue={state.values?.service ?? appt.service ?? ""} placeholder="Consulta, Retorno..." />
        {canChangeDuration ? (
          <SelectField label="Duração" name="durationMinutes" id="ad-duration" defaultValue={state.values?.durationMinutes ?? String(appt.duration)} error={state.errors?.durationMinutes}>
            {options.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`}
              </option>
            ))}
          </SelectField>
        ) : (
          <input type="hidden" name="durationMinutes" value={appt.duration} />
        )}
      </div>
      {rooms.length ? (
        <SelectField label="Consultório" name="roomId" id="ad-room" defaultValue={state.values?.roomId ?? appt.roomId ?? ""} error={state.errors?.roomId} hint="Se o escolhido estiver ocupado nesse horário, o Tropi avisa.">
          <option value="">Sem consultório definido</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextareaField label="Observação para a equipe" name="notes" id="ad-notes" defaultValue={state.values?.notes ?? appt.notes ?? ""} rows={3} />
      <SubmitButton variant="secondary" pendingText="Salvando...">
        Salvar detalhes
      </SubmitButton>
    </form>
  );
}
