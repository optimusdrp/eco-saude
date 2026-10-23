"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { installSpecialtyAction, saveProfessionalTemplatesAction } from "@/modules/pep/actions";

/**
 * Peças de Ajustes > Prontuário > Formulários (gestão).
 *  - ProfessionalTemplatesForm: primeira consulta e retorno de um profissional ("Automático" = pela especialidade).
 *  - InstallSpecialtyButton: adiciona os formulários prontos de uma especialidade da biblioteca.
 */

type Option = { id: string; name: string; specialty: string };

function TemplateSelect({ label, name, id, value, auto, templates }: { label: string; name: string; id: string; value: string | null; auto: string; templates: Option[] }) {
  const specialties = [...new Set(templates.map((t) => t.specialty))];
  return (
    <SelectField label={label} name={name} id={id} defaultValue={value ?? ""}>
      <option value="">Automático ({auto})</option>
      {specialties.map((sp) => (
        <optgroup key={sp} label={sp}>
          {templates
            .filter((t) => t.specialty === sp)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </optgroup>
      ))}
    </SelectField>
  );
}

export function ProfessionalTemplatesForm({ professionalId, first, ret, templates, autoFirst, autoReturn }: { professionalId: string; first: string | null; ret: string | null; templates: Option[]; autoFirst: string; autoReturn: string }) {
  const [state, action] = useActionState(saveProfessionalTemplatesAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="professionalId" value={professionalId} />
      <TemplateSelect label="Primeira consulta" name="firstTemplateId" id={`pf-${professionalId}`} value={first} auto={autoFirst} templates={templates} />
      <TemplateSelect label="Retorno" name="returnTemplateId" id={`pr-${professionalId}`} value={ret} auto={autoReturn} templates={templates} />
      <SubmitButton variant="secondary" pendingText="Salvando...">
        Salvar
      </SubmitButton>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function InstallSpecialtyButton({ specialty, label }: { specialty: string; label: string }) {
  const [state, action] = useActionState(installSpecialtyAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="specialty" value={specialty} />
      <SubmitButton variant="ghost" className="min-h-9 px-2.5" pendingText="..." aria-label={`Adicionar ${label}`}>
        <Plus className="size-4" aria-hidden />
        Adicionar
      </SubmitButton>
      {state.message && !state.ok ? <FormMessage state={state} /> : null}
    </form>
  );
}
