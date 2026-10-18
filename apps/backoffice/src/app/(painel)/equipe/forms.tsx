"use client";

import { STAFF_ROLE_LABEL, STAFF_ROLES } from "@ecosaude/core";
import { Copy, KeyRound } from "lucide-react";
import { useActionState, useState } from "react";
import { Button, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import type { ActionState } from "@/lib/server";
import { createStaffAction, resetPasswordAction, resetTwoFactorAction, updateStaffAction } from "./actions";

/** Caixa que mostra a senha temporária uma única vez, com botão de copiar. */
export function SecretBox({ state }: { state: ActionState }) {
  const [copied, setCopied] = useState(false);
  if (!state.secret) return null;
  return (
    <div className="rounded-xl bg-erp-tint p-3 text-erp-ink">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4" aria-hidden /> Senha temporária
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code data-testid="temp-password" className="rounded-lg bg-paper px-3 py-2 text-base text-ink ring-1 ring-line">
          {state.secret}
        </code>
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(state.secret ?? "");
            setCopied(true);
          }}
        >
          <Copy className="size-4" aria-hidden /> {copied ? "Copiada" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}

export function NewStaffForm() {
  const [state, action] = useActionState(createStaffAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <SecretBox state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nome" name="name" defaultValue={state.ok ? "" : state.values?.name} error={state.errors?.name} />
        <Field label="E-mail" name="email" type="email" defaultValue={state.ok ? "" : state.values?.email} error={state.errors?.email} />
        <SelectField label="Perfil" name="role" defaultValue={state.values?.role ?? "comercial"} error={state.errors?.role}>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {STAFF_ROLE_LABEL[r]}
            </option>
          ))}
        </SelectField>
      </div>
      <SubmitButton>Criar conta</SubmitButton>
    </form>
  );
}

/** Edição de um membro: perfil, ativo, redefinir senha e 2FA. */
export function StaffRowForms({
  member,
  isSelf,
}: {
  member: { id: string; name: string; role: string; active: boolean; totpEnabled: boolean };
  isSelf: boolean;
}) {
  const [updState, updAction] = useActionState(updateStaffAction, {});
  const [pwState, pwAction] = useActionState(resetPasswordAction, {});
  const [tfState, tfAction] = useActionState(resetTwoFactorAction, {});

  return (
    <div className="space-y-3">
      <FormMessage state={updState} />
      <FormMessage state={pwState} />
      <SecretBox state={pwState} />
      <FormMessage state={tfState} />

      <form action={updAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={member.id} />
        <SelectField label="Perfil" name="role" id={`role-${member.id}`} defaultValue={member.role} className="w-48" disabled={isSelf}>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {STAFF_ROLE_LABEL[r]}
            </option>
          ))}
        </SelectField>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold sm:min-h-10">
          <input type="checkbox" name="active" defaultChecked={member.active} disabled={isSelf} className="size-4 accent-[var(--color-crm)]" />
          Conta ativa
        </label>
        {isSelf ? (
          <p className="text-sm text-ink-soft">Esta é a sua conta.</p>
        ) : (
          <SubmitButton variant="secondary">Salvar</SubmitButton>
        )}
      </form>

      {isSelf ? null : (
        <div className="flex flex-wrap gap-2">
          <form action={pwAction}>
            <input type="hidden" name="id" value={member.id} />
            <SubmitButton variant="ghost" pendingText="Gerando...">
              Redefinir senha
            </SubmitButton>
          </form>
          {/* Útil quando a pessoa perdeu o celular e não consegue entrar */}
          {member.totpEnabled ? (
            <form action={tfAction}>
              <input type="hidden" name="id" value={member.id} />
              <SubmitButton variant="ghost" pendingText="Desativando...">
                Desativar 2FA
              </SubmitButton>
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}
