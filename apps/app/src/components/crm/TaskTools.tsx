"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useState } from "react";
import { Dialog, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { buttonStyles } from "@/components/ui/styles";
import { saveTaskAction } from "@/modules/crm/actions/tasks";

/**
 * TAREFAS: diálogo para criar ou editar, com responsável e paciente opcional.
 * Usado na tela de Tarefas e na ficha do paciente.
 */
export interface TaskValues {
  id?: string;
  title: string;
  dueDate: string;
  assigneeId: string;
  contact: { id: string; name: string } | null;
}

export function TaskButton({
  initial,
  team,
  today,
  fixedContact,
  label,
}: {
  initial?: TaskValues;
  team: { id: string; name: string }[];
  today: string;
  /** Paciente já definido (na ficha) */
  fixedContact?: { id: string; name: string };
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
        className={buttonStyles(initial ? "ghost" : "primary", initial ? "px-2" : undefined)}
        aria-label={initial ? `Editar tarefa: ${initial.title}` : undefined}
      >
        {initial ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {initial ? <span className="sr-only sm:not-sr-only">Editar</span> : (label ?? "Nova tarefa")}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={initial ? "Editar tarefa" : "Nova tarefa"}>
        <TaskForm
          key={formKey}
          initial={initial ?? { title: "", dueDate: today, assigneeId: "", contact: fixedContact ?? null }}
          team={team}
          fixedContact={!!fixedContact}
          onSaved={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function TaskForm({ initial, team, fixedContact, onSaved }: { initial: TaskValues; team: { id: string; name: string }[]; fixedContact: boolean; onSaved: () => void }) {
  const router = useRouter();
  const [state, action] = useActionState(saveTaskAction, {});
  const [contact, setContact] = useState(initial.contact);
  const saved = useEffectEvent(() => {
    onSaved();
    router.refresh();
  });
  useEffect(() => {
    if (state.ok) saved();
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="contactId" value={contact?.id ?? ""} />
      <Field label="O que fazer" name="title" id="tk-title" defaultValue={state.values?.title ?? initial.title} placeholder="Ligar para saber do resultado do exame" error={state.errors?.title} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quando" name="dueDate" id="tk-date" type="date" defaultValue={state.values?.dueDate ?? initial.dueDate} error={state.errors?.dueDate} />
        <SelectField label="Responsável" name="assigneeId" id="tk-assignee" defaultValue={state.values?.assigneeId ?? initial.assigneeId}>
          <option value="">Eu mesmo</option>
          {team.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      </div>
      {fixedContact ? (
        <p className="text-sm text-ink-soft">Paciente: {contact?.name}</p>
      ) : (
        <PatientField value={contact} onChange={setContact} />
      )}
      <SubmitButton pendingText="Salvando...">{initial.id ? "Salvar" : "Criar tarefa"}</SubmitButton>
    </form>
  );
}

/** Paciente opcional (busca por nome/telefone). */
function PatientField({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; results: { id: string; name: string }[] } | null>(null);
  const results = found?.q === q ? found.results : [];
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = window.setTimeout(() => {
      fetch(`/api/busca?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setFound({ q, results: d.results ?? [] }))
        .catch(() => setFound({ q, results: [] }));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-xl bg-fog px-3 py-2 text-sm">
        <span>
          Paciente: <strong>{value.name}</strong>
        </span>
        <button type="button" onClick={() => onChange(null)} className="min-h-9 font-semibold text-crm hover:underline">
          Remover
        </button>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor="tk-patient" className="text-sm font-semibold">
        Paciente (opcional)
      </label>
      <input
        id="tk-patient"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Nome ou telefone"
        autoComplete="off"
        className="mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
      />
      {q.trim().length >= 2 && results.length ? (
        <ul className="mt-2 divide-y divide-line rounded-xl ring-1 ring-line">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onChange({ id: r.id, name: r.name })} className="min-h-11 w-full px-3 text-left font-semibold hover:bg-crm-tint">
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
