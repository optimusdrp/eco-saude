"use client";

import { ShieldCheck, ShieldOff } from "lucide-react";
import { useActionState } from "react";
import { Button, Field, FormMessage, SubmitButton } from "@/components/ui";
import {
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  startTwoFactorSetupAction,
} from "@/lib/auth/actions";
import { CodeField } from "../../../(auth)/forms";

/**
 * Verificação em duas etapas (2FA), OPCIONAL, na página "Minha conta".
 *
 * Desativada: botão "Ativar" -> mostra QR code -> pessoa digita um código -> ativa.
 * Ativada:    pede a senha para desativar.
 *
 * Com a 2FA ativa, o login pede o código do aplicativo depois da senha.
 */
export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  return enabled ? <DisableForm /> : <EnableFlow />;
}

/* ------------------------------- Ativação ---------------------------------- */

function EnableFlow() {
  // Passo 1: gerar o QR code. A action não recebe dados do formulário.
  const [setup, start, starting] = useActionState(async () => startTwoFactorSetupAction(), {});
  // Passo 2: conferir o código digitado
  const [confirm, confirmAction] = useActionState(confirmTwoFactorSetupAction, {});

  // Ativou com sucesso: a página recarrega os dados e mostra o painel "ativa"
  if (confirm.ok) return <FormMessage state={confirm} />;

  if (!setup.qr) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-ink-soft">
          <ShieldOff className="mt-0.5 size-5 shrink-0" aria-hidden />
          Desativada. Com ela ativa, além da senha, o login pede um código de 6 números do seu celular.
        </p>
        <FormMessage state={setup} />
        <form action={start}>
          <Button type="submit" disabled={starting}>
            {starting ? "Gerando QR code..." : "Ativar verificação em duas etapas"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <ol className="space-y-5">
      <li>
        <p className="font-semibold">1. Instale um aplicativo autenticador</p>
        <p className="text-sm text-ink-soft">Google Authenticator, Microsoft Authenticator ou outro de sua preferência.</p>
      </li>
      <li>
        <p className="font-semibold">2. Leia o QR code com o aplicativo</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora, em data URL */}
        <img
          src={setup.qr}
          alt="QR code para cadastrar no aplicativo autenticador"
          width={180}
          height={180}
          className="mt-3 rounded-xl bg-white p-1 ring-1 ring-line"
        />
        <details className="mt-2 text-sm">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-crm">Não consigo ler o QR code</summary>
          <p className="text-ink-soft">Digite esta chave no aplicativo (tipo: baseada em tempo):</p>
          <code data-testid="totp-secret" className="mt-1 block break-all rounded-lg bg-fog px-3 py-2 text-base ring-1 ring-line">
            {setup.secret}
          </code>
        </details>
        <p className="mt-2 text-xs text-ink-soft">
          Se você já tinha cadastrado o Tropi no aplicativo antes, apague o cadastro antigo: só este QR code vale.
        </p>
      </li>
      <li>
        <p className="mb-2 font-semibold">3. Digite o código que aparecer</p>
        <form action={confirmAction} className="space-y-3" noValidate>
          <FormMessage state={confirm} />
          <CodeField error={confirm.errors?.code} />
          <SubmitButton pendingText="Conferindo...">Confirmar e ativar</SubmitButton>
        </form>
      </li>
    </ol>
  );
}

/* ------------------------------ Desativação -------------------------------- */

function DisableForm() {
  const [state, action] = useActionState(disableTwoFactorAction, {});
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-ok-ink">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        Ativa. O login pede o código do aplicativo depois da senha.
      </p>
      <details className="rounded-xl bg-fog px-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Desativar</summary>
        <form action={action} className="space-y-3 pb-3" noValidate>
          <FormMessage state={state} />
          <Field label="Confirme com a sua senha" name="password" id="disable-2fa-password" type="password" autoComplete="current-password" error={state.errors?.password} />
          <SubmitButton variant="danger" pendingText="Desativando...">
            Desativar verificação em duas etapas
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
