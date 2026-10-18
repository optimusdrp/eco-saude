"use client";

import { LogOut } from "lucide-react";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui";
import { endSessionsAction } from "@/lib/auth/actions";

/**
 * Desconectar um aparelho (id) ou todos os outros (sem id).
 * O aparelho atual nunca é desconectado por aqui (use "Sair" no menu).
 */
export function EndSessions({ id, label }: { id?: string; label: string }) {
  const [state, action] = useActionState(endSessionsAction, {});
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <SubmitButton variant={id ? "ghost" : "secondary"} pendingText="Desconectando...">
        <LogOut className="size-4" aria-hidden /> {label}
      </SubmitButton>
      {state.message ? (
        <span role="status" className="text-xs font-semibold text-pep-ink">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
