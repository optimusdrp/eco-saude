"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckboxField, Dialog, FormMessage, TextareaField } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { saveProfileAction } from "@/modules/pep/actions";

/**
 * RESUMO CLÍNICO DO PACIENTE (alergias, medicamentos em uso, problemas, antecedentes).
 * É o que todo profissional vê no topo do prontuário e o que dispara o alerta de alergia
 * na hora de prescrever. "Nega alergias" é diferente de "não perguntado".
 */
export interface ProfileValues {
  allergies: { name: string; reaction?: string; severity?: "leve" | "moderada" | "grave" }[];
  noKnownAllergies: boolean;
  medications: { name: string; dose?: string }[];
  problems: { name: string; cid?: string; since?: string; active: boolean }[];
  history: string | null;
  version: number;
}

const input = "min-h-10 w-full rounded-lg bg-paper px-2.5 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-pep";

export function ProfileEditor({ contactId, initial }: { contactId: string; initial: ProfileValues }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();
  const router = useRouter();

  const openEditor = () => {
    setV(initial);
    setMsg({});
    setOpen(true);
  };
  const save = () =>
    start(async () => {
      const clean: ProfileValues = {
        ...v,
        allergies: v.allergies.filter((a) => a.name.trim()).map((a) => ({ ...a, reaction: a.reaction || undefined, severity: a.severity || undefined })),
        medications: v.medications.filter((m) => m.name.trim()).map((m) => ({ ...m, dose: m.dose || undefined })),
        problems: v.problems.filter((p) => p.name.trim()),
      };
      const r = await saveProfileAction(contactId, clean);
      setMsg(r);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      <button type="button" onClick={openEditor} className={buttonStyles("ghost", "min-h-9 px-2.5")} aria-label="Editar resumo clínico">
        <Pencil className="size-4" aria-hidden />
        Editar
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Resumo clínico" description="Vale para todos os atendimentos deste paciente." wide>
        <div className="space-y-6">
          {/* Alergias */}
          <fieldset>
            <legend className="font-bold">Alergias</legend>
            <ul className="mt-2 space-y-2">
              {v.allergies.map((a, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_9rem_auto]">
                  <input aria-label="Alergia a" placeholder="Alergia a (ex.: dipirona)" className={input} value={a.name} onChange={(e) => setV({ ...v, allergies: v.allergies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <RemoveButton label="Remover alergia" onClick={() => setV({ ...v, allergies: v.allergies.filter((_, j) => j !== i) })} className="sm:order-last" />
                  <input aria-label="Reação" placeholder="Reação (ex.: urticária)" className={cn(input, "col-span-2 sm:col-span-1")} value={a.reaction ?? ""} onChange={(e) => setV({ ...v, allergies: v.allergies.map((x, j) => (j === i ? { ...x, reaction: e.target.value } : x)) })} />
                  <select
                    aria-label="Gravidade"
                    className={cn(input, "col-span-2 sm:col-span-1")}
                    value={a.severity ?? ""}
                    onChange={(e) => setV({ ...v, allergies: v.allergies.map((x, j) => (j === i ? { ...x, severity: (e.target.value || undefined) as never } : x)) })}
                  >
                    <option value="">Gravidade</option>
                    <option value="leve">Leve</option>
                    <option value="moderada">Moderada</option>
                    <option value="grave">Grave (anafilaxia)</option>
                  </select>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <AddButton onClick={() => setV({ ...v, noKnownAllergies: false, allergies: [...v.allergies, { name: "" }] })}>Alergia</AddButton>
              {!v.allergies.length ? <CheckboxField label="Paciente nega alergias" checked={v.noKnownAllergies} onChange={(e) => setV({ ...v, noKnownAllergies: e.target.checked })} /> : null}
            </div>
          </fieldset>

          {/* Medicamentos */}
          <fieldset>
            <legend className="font-bold">Medicamentos em uso</legend>
            <ul className="mt-2 space-y-2">
              {v.medications.map((m, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input aria-label="Medicamento" placeholder="Medicamento" className={input} value={m.name} onChange={(e) => setV({ ...v, medications: v.medications.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <RemoveButton label="Remover medicamento" onClick={() => setV({ ...v, medications: v.medications.filter((_, j) => j !== i) })} className="sm:order-last" />
                  <input aria-label="Dose e frequência" placeholder="Dose (ex.: 50 mg 1x ao dia)" className={cn(input, "col-span-2 sm:col-span-1")} value={m.dose ?? ""} onChange={(e) => setV({ ...v, medications: v.medications.map((x, j) => (j === i ? { ...x, dose: e.target.value } : x)) })} />
                </li>
              ))}
            </ul>
            <AddButton className="mt-2" onClick={() => setV({ ...v, medications: [...v.medications, { name: "" }] })}>
              Medicamento
            </AddButton>
          </fieldset>

          {/* Problemas */}
          <fieldset>
            <legend className="font-bold">Problemas e diagnósticos</legend>
            <p className="text-sm text-ink-soft">Os CIDs dos atendimentos finalizados entram aqui sozinhos. Marque como resolvido quando não estiver mais ativo.</p>
            <ul className="mt-2 space-y-2">
              {v.problems.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  {p.cid ? <span className="w-12 font-semibold tabular">{p.cid}</span> : null}
                  <input aria-label="Problema" placeholder="Problema" className={cn(input, "min-w-0 flex-1 basis-48")} value={p.name} onChange={(e) => setV({ ...v, problems: v.problems.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <label className="inline-flex min-h-10 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--color-pep)]" checked={!p.active} onChange={(e) => setV({ ...v, problems: v.problems.map((x, j) => (j === i ? { ...x, active: !e.target.checked } : x)) })} />
                    Resolvido
                  </label>
                  <RemoveButton label="Remover problema" onClick={() => setV({ ...v, problems: v.problems.filter((_, j) => j !== i) })} />
                </li>
              ))}
            </ul>
            <AddButton className="mt-2" onClick={() => setV({ ...v, problems: [...v.problems, { name: "", active: true }] })}>
              Problema
            </AddButton>
          </fieldset>

          <TextareaField label="Antecedentes" name="history" id="pf-history" value={v.history ?? ""} onChange={(e) => setV({ ...v, history: e.target.value })} hint="Pessoais, familiares, cirurgias, vacinas, hábitos." />

          <FormMessage state={msg} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Cancelar
            </button>
            <button type="button" onClick={save} disabled={pending} aria-busy={pending} className={buttonStyles("primary", "bg-pep hover:bg-pep-ink")}>
              {pending ? "Salvando..." : "Salvar resumo"}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function AddButton({ onClick, children, className }: { onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-pep hover:bg-pep-tint", className)}>
      <Plus className="size-4" aria-hidden />
      {children}
    </button>
  );
}

function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn("inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-alert-tint hover:text-alert", className)}>
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}
