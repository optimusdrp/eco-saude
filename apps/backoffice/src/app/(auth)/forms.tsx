"use client";

/**
 * Formulários das telas de acesso.
 * useActionState liga o formulário à server action e devolve o resultado
 * (erros por campo ou mensagem geral) sem recarregar a página.
 */
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui";
import {
  changePasswordAction,
  loginAction,
  verifyTwoFactorAction,
} from "@/lib/auth/actions";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field
        label="E-mail"
        name="email"
        type="email"
        autoComplete="username"
        required
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />
      <Field
        label="Senha"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.errors?.password}
      />
      <SubmitButton pendingText="Entrando..." className="w-full">
        Entrar
      </SubmitButton>
    </form>
  );
}

/** Campo de código de 6 números, otimizado para celular (teclado numérico e preenchimento automático). */
export function CodeField({ error }: { error?: string }) {
  return (
    <Field
      label="Código de 6 números"
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      required
      autoFocus
      className="[&_input]:text-center [&_input]:text-xl [&_input]:tracking-[0.4em]"
      error={error}
    />
  );
}

export function VerifyCodeForm() {
  const [state, action] = useActionState(verifyTwoFactorAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <CodeField error={state.errors?.code} />
      <SubmitButton pendingText="Conferindo..." className="w-full">
        Confirmar
      </SubmitButton>
    </form>
  );
}

export function ChangePasswordForm({ from }: { from?: "conta" }) {
  const [state, action] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {from ? <input type="hidden" name="from" value={from} /> : null}
      <FormMessage state={state} />
      <Field
        label={from ? "Senha atual" : "Senha temporária"}
        name="current"
        type="password"
        autoComplete="current-password"
        error={state.errors?.current}
      />
      <Field
        label="Nova senha"
        name="next"
        type="password"
        autoComplete="new-password"
        hint="Mínimo de 12 caracteres, com maiúscula, minúscula e número."
        error={state.errors?.next}
      />
      <Field
        label="Repita a nova senha"
        name="confirm"
        type="password"
        autoComplete="new-password"
        error={state.errors?.confirm}
      />
      <SubmitButton className="w-full sm:w-auto">Salvar nova senha</SubmitButton>
    </form>
  );
}
