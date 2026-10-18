"use client";

import { ScanSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { runAuditNowAction } from "@/modules/crm/actions/quality";

/** "Auditar agora": adianta o próximo lote da amostra semanal. */
export function RunAudit() {
  const router = useRouter();
  const [state, action] = useActionState(runAuditNowAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col items-start gap-1 sm:items-end">
      <SubmitButton variant="secondary" pendingText="Avaliando...">
        <ScanSearch className="size-4" aria-hidden /> Auditar agora
      </SubmitButton>
      {state.message ? (
        <p role="status" className={cn("max-w-xs text-xs sm:text-right", state.ok ? "text-ink-soft" : "font-semibold text-alert")}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
