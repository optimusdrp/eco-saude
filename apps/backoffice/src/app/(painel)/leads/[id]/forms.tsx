"use client";

import { LEAD_STAGE_LABEL, LEAD_STAGES } from "@ecosaude/core";
import { useActionState, useState } from "react";
import { FormMessage, SelectField, SubmitButton, TextareaField } from "@/components/ui";
import { addLeadNoteAction, updateLeadAction } from "../actions";

/** Formulário de etapa e responsável do lead. */
export function LeadStatusForm({
  lead,
  owners,
  disabled,
}: {
  lead: { id: string; stage: string; ownerId: string | null; lostReason: string | null };
  owners: { id: string; name: string }[];
  disabled: boolean;
}) {
  const [state, action] = useActionState(updateLeadAction, {});
  // Mostra o campo "motivo" só quando a etapa escolhida é "perdido"
  const [stage, setStage] = useState(lead.stage);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={lead.id} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Etapa"
          name="stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          disabled={disabled}
          error={state.errors?.stage}
        >
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGE_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Responsável"
          name="ownerId"
          defaultValue={state.values?.ownerId ?? lead.ownerId ?? ""}
          key={state.values?.ownerId ?? lead.ownerId ?? "none"}
          disabled={disabled}
          error={state.errors?.ownerId}
        >
          <option value="">Sem responsável</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
      </div>
      {stage === "perdido" ? (
        <TextareaField
          label="Motivo da perda"
          name="lostReason"
          defaultValue={state.values?.lostReason ?? lead.lostReason ?? ""}
          hint="Ajuda a entender o que melhorar na oferta."
          disabled={disabled}
          error={state.errors?.lostReason}
        />
      ) : null}
      {disabled ? (
        <p className="text-sm text-ink-soft">Seu perfil pode ver, mas não alterar leads.</p>
      ) : (
        <SubmitButton>Salvar andamento</SubmitButton>
      )}
    </form>
  );
}

/** Nova anotação no histórico do lead. */
export function LeadNoteForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState(addLeadNoteAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <TextareaField
        label="Nova anotação"
        name="body"
        placeholder="Ex.: Ligou pedindo proposta para 2 unidades."
        defaultValue={state.ok ? "" : state.values?.body}
        error={state.errors?.body}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary">Adicionar anotação</SubmitButton>
        {state.ok ? (
          <p role="status" className="text-sm font-semibold text-ok-ink">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
