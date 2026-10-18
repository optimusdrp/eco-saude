"use client";

/**
 * Formulários de acesso. useActionState liga o formulário à server action
 * e devolve erros por campo sem recarregar a página.
 */
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui";
import { changePasswordAction, loginAction, verifyTwoFactorAction } from "@/lib/auth/actions";
import { checkResetTokenAction, requestPasswordResetAction, resetPasswordAction } from "@/lib/auth/recovery";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="E-mail" name="email" type="email" autoComplete="username" required defaultValue={state.values?.email} error={state.errors?.email} />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" required error={state.errors?.password} />
      <SubmitButton pendingText="Entrando..." className="w-full">
        Entrar
      </SubmitButton>
    </form>
  );
}

/** Código de 6 números: teclado numérico e preenchimento automático no celular. */
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
      <Field label={from ? "Senha atual" : "Senha temporária"} name="current" type="password" autoComplete="current-password" error={state.errors?.current} />
      <Field label="Nova senha" name="next" type="password" autoComplete="new-password" hint="Mínimo de 12 caracteres, com maiúscula, minúscula e número." error={state.errors?.next} />
      <Field label="Repita a nova senha" name="confirm" type="password" autoComplete="new-password" error={state.errors?.confirm} />
      <SubmitButton className="w-full sm:w-auto">Salvar nova senha</SubmitButton>
    </form>
  );
}

/* ---------------------------- Esqueci minha senha ---------------------------- */

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, {});
  // "Pedir de novo" esconde a confirmação DESTE resultado; o próximo envio traz outro
  const [dismissed, setDismissed] = useState<typeof state | null>(null);
  // Pedido aceito: troca o formulário pela confirmação (a mensagem é igual exista a conta ou não)
  if (state.ok && state !== dismissed) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-xl bg-pep-tint px-3 py-3 text-sm font-semibold text-pep-ink">
          {state.message}
        </p>
        <p className="text-sm text-ink-soft">
          Não chegou em alguns minutos? Confira se o e-mail está certo e peça de novo. Se ainda assim não chegar, a gestão da clínica pode criar uma senha temporária para você.
        </p>
        {/* "Voltar para o login" já fica no rodapé da página */}
        <button type="button" onClick={() => setDismissed(state)} className="min-h-11 font-semibold text-crm underline-offset-4 hover:underline">
          Pedir de novo
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.ok ? null : <FormMessage state={state} />}
      <Field label="E-mail" name="email" type="email" autoComplete="username" required autoFocus defaultValue={state.values?.email} error={state.errors?.email} />
      <SubmitButton pendingText="Enviando..." className="w-full">
        Enviar link
      </SubmitButton>
    </form>
  );
}

/* ------------------------- Nova senha pelo link do e-mail ------------------------ */

const TOKEN_KEY = "eco_reset_token";

/**
 * O token chega depois do "#" (o servidor nunca o recebe na URL). Ao abrir:
 *  1. lê o token e o tira da barra de endereço (não fica no histórico nem aparece se a tela for compartilhada);
 *  2. guarda só nesta aba (sessionStorage) para sobreviver a um recarregar;
 *  3. confere no servidor se o link ainda vale ANTES de pedir a senha.
 */
export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [check, setCheck] = useState<"conferindo" | "invalido" | { firstName: string; clinicName: string; minutesLeft: number }>("conferindo");
  const [state, action] = useActionState(resetPasswordAction, {});

  useEffect(() => {
    let t = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash)?.[1] ?? null;
    if (t) {
      try {
        sessionStorage.setItem(TOKEN_KEY, t);
      } catch {}
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      try {
        t = sessionStorage.getItem(TOKEN_KEY);
      } catch {}
    }
    if (!t) {
      // Sincroniza a tela com o endereço lido no navegador (só existe depois de montar)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCheck("invalido");
      return;
    }
    setToken(t);
    let alive = true;
    checkResetTokenAction(t)
      .then(
        (r) =>
          alive &&
          setCheck(
            r.ok
              ? {
                  firstName: r.firstName,
                  clinicName: r.clinicName,
                  minutesLeft: r.minutesLeft,
                }
              : "invalido",
          ),
      )
      .catch(() => alive && setCheck("invalido"));
    return () => {
      alive = false;
    };
  }, []);

  const expired = check === "invalido" || state.data?.expired === true;
  useEffect(() => {
    if (expired) {
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch {}
    }
  }, [expired]);

  if (check === "conferindo") {
    return (
      <p role="status" className="text-ink-soft">
        Conferindo o link...
      </p>
    );
  }
  if (expired) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Link inválido</h1>
        <p role="alert" className="rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          Este link expirou ou já foi usado. Por segurança, cada link vale por 30 minutos e uma única vez.
        </p>
        <Link href="/login/esqueci" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-crm px-4 font-semibold text-white hover:opacity-90">
          Pedir um novo link
        </Link>
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-soft underline-offset-4 hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-bold">Crie uma nova senha</h1>
      <p className="mt-1 mb-6 text-ink-soft">
        Olá, {check.firstName}! Esta será a nova senha do seu acesso à {check.clinicName}. O link vale por mais {check.minutesLeft} {check.minutesLeft === 1 ? "minuto" : "minutos"}.
      </p>
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="token" value={token ?? ""} />
        <FormMessage state={state} />
        <Field label="Nova senha" name="next" type="password" autoComplete="new-password" autoFocus hint="Mínimo de 12 caracteres, com maiúscula, minúscula e número." error={state.errors?.next} />
        <Field label="Repita a nova senha" name="confirm" type="password" autoComplete="new-password" error={state.errors?.confirm} />
        <SubmitButton pendingText="Salvando..." className="w-full">
          Salvar nova senha
        </SubmitButton>
      </form>
      <p className="mt-6 text-sm text-ink-soft">
        Ao salvar, todos os aparelhos conectados com a senha antiga são desconectados. Se a verificação em duas etapas estiver ativa, ela continua sendo pedida.
      </p>
    </>
  );
}
