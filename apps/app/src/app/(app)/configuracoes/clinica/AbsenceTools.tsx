"use client";

/** Marcar e remover ausências (férias, congresso, folga) de um profissional. */
import { CalendarOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Dialog, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { buttonStyles } from "@/components/ui/styles";
import { deleteAbsenceAction, saveAbsenceAction } from "@/modules/crm/actions/clinic";

const REASONS = ["Férias", "Congresso ou curso", "Folga", "Licença", "Feriado"];

export function AbsenceButton({ professionals }: { professionals: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        className={buttonStyles("secondary")}
      >
        <CalendarOff className="size-4" aria-hidden /> Marcar ausência
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Marcar ausência" description="Nesses dias o profissional não terá horários livres. Consultas já marcadas não são canceladas.">
        <AbsenceForm key={key} professionals={professionals} />
      </Dialog>
    </>
  );
}

function AbsenceForm({ professionals }: { professionals: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, action] = useActionState(saveAbsenceAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  const [start, setStart] = useState(state.values?.startsOn ?? "");
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <SelectField label="Profissional" name="professionalId" id="abs-pro" defaultValue={state.values?.professionalId ?? professionals[0]?.id}>
        {professionals.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <Field label="De" name="startsOn" id="abs-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} error={state.errors?.startsOn} />
        <Field label="Até" name="endsOn" id="abs-end" type="date" defaultValue={state.values?.endsOn} min={start || undefined} error={state.errors?.endsOn} hint="Inclusive." />
      </div>
      <div>
        <Field label="Motivo" name="reason" id="abs-reason" list="abs-reasons" defaultValue={state.values?.reason} placeholder="Férias" maxLength={120} hint="Aparece só para a equipe." />
        <datalist id="abs-reasons">
          {REASONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
      <SubmitButton pendingText="Salvando...">Marcar ausência</SubmitButton>
    </form>
  );
}

export function DeleteAbsence({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [state, action] = useActionState(deleteAbsenceAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" pendingText="..." aria-label={`Remover ausência: ${label}`}>
        <Trash2 className="size-4" aria-hidden /> Remover
      </SubmitButton>
    </form>
  );
}
