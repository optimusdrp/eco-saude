"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, TextareaField, cn } from "@/components/ui";
import { savePlanAction } from "./actions";

/** Formulário de plano: dados, preço e funcionalidades incluídas. */
export function PlanForm({
  plan,
  moduleId,
  submodules,
  activeSubscriptions,
}: {
  plan?: {
    id: string;
    name: string;
    description: string | null;
    priceMonthly: string;
    maxUsers: number | null;
    active: boolean;
    submoduleIds: string[];
  };
  moduleId: string;
  submodules: { id: string; name: string; key: string }[];
  activeSubscriptions: number;
}) {
  const [state, action] = useActionState(savePlanAction, {});
  const v = state.values;
  // Depois de um erro, mantém as funcionalidades que estavam marcadas no envio
  const selected = v ? (v.submoduleIds ?? "").split(",") : null;

  return (
    <form action={action} className="space-y-5" noValidate>
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
      <input type="hidden" name="moduleId" value={moduleId} />
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do plano" name="name" defaultValue={v?.name ?? plan?.name} error={state.errors?.name} />
        <Field
          label="Preço mensal (R$)"
          name="priceMonthly"
          inputMode="decimal"
          placeholder="249,90"
          defaultValue={v?.priceMonthly ?? plan?.priceMonthly}
          error={state.errors?.priceMonthly}
          hint={plan && activeSubscriptions > 0 ? `${activeSubscriptions} contratações mantêm o preço antigo.` : undefined}
        />
        <Field
          label="Limite de usuários"
          name="maxUsers"
          type="number"
          min={1}
          defaultValue={v?.maxUsers ?? plan?.maxUsers ?? ""}
          hint="Deixe em branco para ilimitado."
          error={state.errors?.maxUsers}
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end rounded-xl bg-fog px-3 ring-1 ring-line">
          <input type="checkbox" name="active" defaultChecked={v ? v.active === "on" : (plan?.active ?? true)} className="size-4 accent-[var(--color-crm)]" />
          <span>
            <span className="block text-sm font-semibold">Disponível para novas contratações</span>
          </span>
        </label>
      </div>

      <TextareaField label="Descrição" name="description" defaultValue={v?.description ?? plan?.description ?? ""} error={state.errors?.description} />

      <fieldset aria-describedby={state.errors?.submoduleIds ? "submoduleIds-erro" : undefined}>
        <legend className="text-sm font-semibold">Funcionalidades incluídas</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {submodules.map((s) => (
            <label
              key={s.id}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-line",
                "has-[:checked]:bg-crm-tint has-[:checked]:ring-crm",
              )}
            >
              <input
                type="checkbox"
                name="submoduleIds"
                value={s.id}
                defaultChecked={selected ? selected.includes(s.id) : plan ? plan.submoduleIds.includes(s.id) : true}
                className="size-4 accent-[var(--color-crm)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{s.name}</span>
                <span className="block text-xs text-ink-soft">{s.key}</span>
              </span>
            </label>
          ))}
        </div>
        {state.errors?.submoduleIds ? (
          <p id="submoduleIds-erro" className="mt-1 text-sm font-semibold text-alert">
            {state.errors.submoduleIds}
          </p>
        ) : null}
      </fieldset>

      <SubmitButton>{plan ? "Salvar plano" : "Criar plano"}</SubmitButton>
    </form>
  );
}
