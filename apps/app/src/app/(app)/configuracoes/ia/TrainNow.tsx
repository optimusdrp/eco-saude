"use client";

/** "Treinar agora": treina os modelos da clínica com os dados atuais (no servidor). */
import { BrainCircuit } from "lucide-react";
import { useState, useTransition } from "react";
import { buttonStyles, cn } from "@/components/ui/styles";
import { trainNowAction } from "@/modules/crm/actions/ai";

export function TrainNow() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-3">
      <button type="button" onClick={() => start(async () => setResult(await trainNowAction()))} disabled={pending} className={buttonStyles("secondary")}>
        <BrainCircuit className={cn("size-4", pending && "animate-pulse")} aria-hidden /> {pending ? "Treinando..." : "Treinar agora"}
      </button>
      {result ? (
        <p role="status" className={cn("mt-2 rounded-lg px-2.5 py-1.5 text-sm", result.ok ? "bg-ok-tint text-ok-ink" : "bg-erp-tint text-erp-ink")}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
