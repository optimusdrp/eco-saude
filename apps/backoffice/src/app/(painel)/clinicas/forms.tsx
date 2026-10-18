"use client";

import {
  formatCents,
  MODULE_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_TRANSITIONS,
  type ModuleId,
  type SubscriptionStatus,
} from "@ecosaude/core";
import { useActionState, useState } from "react";
import { Field, FormMessage, SelectField, SubmitButton, TextareaField, cn } from "@/components/ui";
import {
  changeSubscriptionStatusAction,
  createClinicAction,
  createClinicManagerAction,
  createSubscriptionAction,
  resetClinicUserAccessAction,
  setOverrideAction,
  updateClinicAction,
} from "./actions";
import { SecretBox } from "../equipe/forms";

/* ------------------------------ Dados da clínica --------------------------- */

interface ClinicValues {
  id?: string;
  tradeName?: string | null;
  legalName?: string | null;
  cnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
}

/** Formulário usado para criar (sem id) e editar (com id) uma clínica. */
export function ClinicForm({
  clinic = {},
  leadId,
  disabled = false,
}: {
  clinic?: ClinicValues;
  leadId?: string;
  disabled?: boolean;
}) {
  const editing = Boolean(clinic.id);
  const [state, action] = useActionState(editing ? updateClinicAction : createClinicAction, {});
  // Depois de um erro, mostra o que a pessoa digitou; senão, o valor salvo
  const v = (name: keyof ClinicValues) => state.values?.[name] ?? clinic[name] ?? "";

  return (
    <form action={action} className="space-y-4" noValidate>
      {clinic.id ? <input type="hidden" name="id" value={clinic.id} /> : null}
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      <FormMessage state={state} />
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da clínica" name="tradeName" defaultValue={v("tradeName")} error={state.errors?.tradeName} required />
        <Field label="Razão social" name="legalName" defaultValue={v("legalName")} error={state.errors?.legalName} />
        <Field label="CNPJ" name="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" defaultValue={v("cnpj")} error={state.errors?.cnpj} />
        <Field label="E-mail" name="email" type="email" defaultValue={v("email")} error={state.errors?.email} />
        <Field label="Telefone" name="phone" type="tel" defaultValue={v("phone")} error={state.errors?.phone} />
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
          <Field label="Cidade" name="city" defaultValue={v("city")} error={state.errors?.city} />
          <Field label="UF" name="state" maxLength={2} defaultValue={v("state")} error={state.errors?.state} className="[&_input]:uppercase" />
        </div>
      </fieldset>
      {disabled ? null : <SubmitButton>{editing ? "Salvar dados" : "Cadastrar clínica"}</SubmitButton>}
    </form>
  );
}

/* ------------------------------- Nova contratação -------------------------- */

export interface PlanOption {
  id: string;
  moduleId: ModuleId;
  name: string;
  priceMonthlyCents: number;
}

export function NewSubscriptionForm({
  clinicId,
  plans,
  busyModules,
}: {
  clinicId: string;
  plans: PlanOption[];
  /** Módulos que já têm contratação aberta (não podem ter outra). */
  busyModules: ModuleId[];
}) {
  const [state, action] = useActionState(createSubscriptionAction, {});
  const [status, setStatus] = useState("teste");
  const available = plans.filter((p) => !busyModules.includes(p.moduleId));

  if (available.length === 0) {
    return <p className="text-ink-soft">Todos os módulos já têm contratação em aberto para esta clínica.</p>;
  }

  // Agrupa os planos por módulo no <select>
  const groups = [...new Set(available.map((p) => p.moduleId))];

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="clinicId" value={clinicId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Plano" name="planId" defaultValue={state.values?.planId ?? ""} error={state.errors?.planId} className="sm:col-span-2">
          <option value="" disabled>
            Escolha o módulo e o plano
          </option>
          {groups.map((m) => (
            <optgroup key={m} label={MODULE_LABEL[m]}>
              {available
                .filter((p) => p.moduleId === m)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {MODULE_LABEL[m]} {p.name}, {formatCents(p.priceMonthlyCents)}/mês
                  </option>
                ))}
            </optgroup>
          ))}
        </SelectField>
        <SelectField label="Começa como" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="teste">Teste gratuito</option>
          <option value="ativa">Ativa (já contratada)</option>
        </SelectField>
        {status === "teste" ? (
          <Field label="Dias de teste" name="trialDays" type="number" min={1} max={60} defaultValue={state.values?.trialDays ?? "7"} error={state.errors?.trialDays} />
        ) : (
          <SelectField label="Cobrança" name="billingCycle" defaultValue={state.values?.billingCycle ?? "mensal"}>
            <option value="mensal">Mensal</option>
            <option value="anual">Anual</option>
          </SelectField>
        )}
      </div>
      {status === "teste" ? <input type="hidden" name="billingCycle" value="mensal" /> : null}
      <SubmitButton>Adicionar contratação</SubmitButton>
    </form>
  );
}

/* --------------------------- Mudança de status ----------------------------- */

const actionLabel: Record<SubscriptionStatus, string> = {
  teste: "Voltar para teste",
  ativa: "Ativar",
  suspensa: "Suspender",
  cancelada: "Cancelar",
};

export function SubscriptionStatusForm({ id, status }: { id: string; status: SubscriptionStatus }) {
  const [state, action] = useActionState(changeSubscriptionStatusAction, {});
  const options = SUBSCRIPTION_TRANSITIONS[status];
  const [next, setNext] = useState<SubscriptionStatus | "">("");

  if (options.length === 0) return null;
  // Depois de uma mudança, a opção escolhida antes pode não valer mais para o novo status
  const choice = next && options.includes(next) ? next : "";
  const needsReason = choice === "cancelada" || choice === "suspensa";

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <fieldset>
        <legend className="text-sm font-semibold">Alterar situação</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((s) => (
            <label
              key={s}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-sm font-semibold ring-1 sm:min-h-10",
                choice === s
                  ? s === "cancelada"
                    ? "bg-alert-tint text-alert ring-alert"
                    : "bg-crm-tint text-crm ring-crm"
                  : "bg-paper ring-line hover:ring-ink/35",
              )}
            >
              <input type="radio" name="status" value={s} className="sr-only" checked={choice === s} onChange={() => setNext(s)} />
              {actionLabel[s]}
            </label>
          ))}
        </div>
      </fieldset>
      {needsReason ? (
        <TextareaField label="Motivo" name="reason" id={`reason-${id}`} error={state.errors?.reason} hint="Fica registrado na auditoria." />
      ) : null}
      {choice ? (
        <SubmitButton variant={choice === "cancelada" ? "danger" : "primary"} pendingText="Aplicando...">
          Confirmar: {SUBSCRIPTION_STATUS_LABEL[choice]}
        </SubmitButton>
      ) : null}
    </form>
  );
}

/* ------------------------ Funcionalidades (exceções) ----------------------- */

export interface FeatureRow {
  submoduleId: string;
  name: string;
  inPlan: boolean;
  override: boolean | null; // null = segue o plano
}

/**
 * Tabela de funcionalidades de uma contratação.
 * Cada linha mostra se está no plano e permite liberar/bloquear como exceção.
 * A mudança é salva na hora ao trocar a opção.
 */
export function FeatureOverrides({ subscriptionId, rows, disabled }: { subscriptionId: string; rows: FeatureRow[]; disabled: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <FeatureRowForm key={row.submoduleId} subscriptionId={subscriptionId} row={row} disabled={disabled} />
      ))}
    </ul>
  );
}

function FeatureRowForm({ subscriptionId, row, disabled }: { subscriptionId: string; row: FeatureRow; disabled: boolean }) {
  const [state, action, pending] = useActionState(setOverrideAction, {});
  const effective = row.override ?? row.inPlan;
  const mode = row.override === null ? "default" : row.override ? "on" : "off";

  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold">{row.name}</p>
        <p className="text-xs text-ink-soft">
          {row.inPlan ? "Incluída no plano" : "Fora do plano"}
          {row.override !== null ? (row.override ? ", liberada como exceção" : ", bloqueada como exceção") : ""}
        </p>
        {state.ok === false ? <p className="text-xs font-semibold text-alert">{state.message}</p> : null}
      </div>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="subscriptionId" value={subscriptionId} />
        <input type="hidden" name="submoduleId" value={row.submoduleId} />
        <span
          className={cn("w-20 text-right text-xs font-bold", effective ? "text-pep-ink" : "text-ink-soft")}
          aria-live="polite"
        >
          {pending ? "Salvando..." : effective ? "Liberada" : "Bloqueada"}
        </span>
        <label className="sr-only" htmlFor={`mode-${subscriptionId}-${row.submoduleId}`}>
          Regra para {row.name}
        </label>
        <select
          id={`mode-${subscriptionId}-${row.submoduleId}`}
          name="mode"
          defaultValue={mode}
          disabled={disabled || pending}
          // Envia o formulário assim que a opção muda
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="min-h-11 rounded-xl bg-paper px-2 text-sm ring-1 ring-line sm:min-h-9"
        >
          <option value="default">Seguir o plano</option>
          <option value="on">Liberar</option>
          <option value="off">Bloquear</option>
        </select>
      </form>
    </li>
  );
}

/* --------------------------- Acesso da clínica ----------------------------- */

/** Cria o acesso de gestão da clínica no ambiente da clínica (CRM e demais módulos). */
export function ClinicManagerForm({ clinicId }: { clinicId: string }) {
  const [state, action] = useActionState(createClinicManagerAction, {});
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="clinicId" value={clinicId} />
      <FormMessage state={state} />
      <SecretBox state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do gestor" name="name" id="mgr-name" defaultValue={state.ok ? "" : state.values?.name} error={state.errors?.name} />
        <Field label="E-mail de login" name="email" id="mgr-email" type="email" defaultValue={state.ok ? "" : state.values?.email} error={state.errors?.email} />
      </div>
      <SubmitButton pendingText="Criando...">Criar acesso de gestão</SubmitButton>
    </form>
  );
}

/** Botões de suporte ao acesso de um usuário da clínica (senha / 2 etapas). */
export function ClinicUserSupport({ userId, email, totpEnabled }: { userId: string; email: string; totpEnabled: boolean }) {
  const [state, action] = useActionState(resetClinicUserAccessAction, {});
  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap gap-1">
        <form action={action} onSubmit={(e) => { if (!window.confirm(`Gerar nova senha temporária para ${email}?`)) e.preventDefault(); }}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="kind" value="senha" />
          <SubmitButton variant="ghost" pendingText="...">Nova senha</SubmitButton>
        </form>
        {totpEnabled ? (
          <form action={action} onSubmit={(e) => { if (!window.confirm(`Desligar a verificação em duas etapas de ${email}?`)) e.preventDefault(); }}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="kind" value="2fa" />
            <SubmitButton variant="ghost" pendingText="...">Resetar 2 etapas</SubmitButton>
          </form>
        ) : null}
      </div>
      <FormMessage state={state} />
      <SecretBox state={state} />
    </div>
  );
}
