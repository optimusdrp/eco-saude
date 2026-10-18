"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { CheckboxField, Dialog, FormMessage, SubmitButton } from "@/components/ui";
import { buttonStyles } from "@/components/ui/styles";
import { rescheduleAppointmentAction } from "@/modules/crm/actions/agenda";
import { OfferPanel } from "../OfferPanel";
import { hhmm, type BoardAppointment } from "./types";

/**
 * CONFIRMAR REMARCAÇÃO POR ARRASTE
 * Soltar uma consulta noutro horário não muda nada sozinho: mostra o
 * "de/para", pergunta se avisa o paciente e só então remarca.
 * Se o horário antigo ficou livre, já oferece à lista de espera.
 */
export interface PendingMove {
  appt: BoardAppointment;
  professionalId: string;
  professionalName: string;
  date: string;
  dayLabel: string;
  startMin: number;
}

export function MoveDialog({ move, onClose, waitlistEnabled }: { move: PendingMove | null; onClose: () => void; waitlistEnabled: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState(rescheduleAppointmentAction, {});
  const [handled, setHandled] = useState(state);
  const [freed, setFreed] = useState<{ professionalId: string; startsAt: string; endsAt: string; appointmentId: string; label: string } | null>(null);
  const [done, setDone] = useState(false);

  // Resultado da remarcação (ajuste de estado durante a renderização)
  if (state !== handled) {
    setHandled(state);
    if (state.ok) {
      setDone(true);
      const f = (state.data as { freed?: { professionalId: string; startsAt: string; endsAt: string; appointmentId: string } } | undefined)?.freed;
      if (f && move) setFreed({ ...f, label: `Horário anterior (${move.appt.time}, ${move.appt.professionalName}) ficou livre` });
    }
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  // Novo arraste: começa do zero
  const [lastMove, setLastMove] = useState(move);
  if (move !== lastMove) {
    setLastMove(move);
    setDone(false);
    setFreed(null);
  }

  if (!move) return null;
  const length = move.appt.endMin - move.appt.startMin;
  const sameSlot = move.date === move.appt.date && move.startMin === move.appt.startMin && move.professionalId === move.appt.professionalId;
  const warning = !state.ok && (state.data as { warning?: boolean } | undefined)?.warning;

  return (
    <Dialog open onClose={onClose} title="Remarcar consulta" description={move.appt.contactName}>
      {done ? (
        <div className="space-y-4">
          <FormMessage state={state} />
          {freed && waitlistEnabled ? <OfferPanel slot={freed} title="Ofereça o horário que ficou livre" /> : null}
          <button type="button" onClick={onClose} className={buttonStyles("secondary")}>
            Fechar
          </button>
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={move.appt.id} />
          <input type="hidden" name="version" value={move.appt.version} />
          <input type="hidden" name="professionalId" value={move.professionalId} />
          <input type="hidden" name="date" value={move.date} />
          <input type="hidden" name="time" value={hhmm(move.startMin)} />
          <input type="hidden" name="durationMinutes" value={length} />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-fog p-3 text-sm">
            <div>
              <p className="text-xs text-ink-soft">De</p>
              <p className="font-semibold">{move.appt.when}</p>
              <p className="text-ink-soft">{move.appt.professionalName}</p>
            </div>
            <ArrowRight className="size-5 text-crm" aria-hidden />
            <div>
              <p className="text-xs text-ink-soft">Para</p>
              <p className="font-semibold capitalize">
                {move.dayLabel}, {hhmm(move.startMin)}–{hhmm(move.startMin + length)}
              </p>
              <p className="text-ink-soft">{move.professionalName}</p>
            </div>
          </div>
          <FormMessage state={state} />
          {sameSlot ? <p className="text-sm text-ink-soft">É o mesmo horário de agora.</p> : null}
          <CheckboxField name="notify" defaultChecked label="Avisar o paciente do novo horário" hint="Pelo canal preferido. Quem pediu SAIR não recebe." />
          {warning ? <CheckboxField name="force" label="Remarcar mesmo assim" hint="Fora do expediente ou paciente com outra consulta no horário." /> : null}
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingText="Remarcando...">Confirmar remarcação</SubmitButton>
            <button type="button" onClick={onClose} className={buttonStyles("ghost")}>
              Desistir
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
