"use client";

/**
 * OPINIÃO SOBRE UM PAR DE POSSÍVEIS DUPLICADOS
 *  - Mostra a opinião guardada (IA) ou a das regras.
 *  - "Pedir opinião da IA": a IA recebe só os NOMES e sinais sim/não
 *    (mesmo e-mail, mesmo celular, mesmo nascimento). Nunca o e-mail nem o número.
 *  - É uma opinião: quem unifica é sempre a pessoa, na tela de comparação.
 */
import { Bot, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/components/ui/styles";
import { duplicateOpinionAction } from "@/modules/crm/actions/insights";

export type DuplicateVerdictTone = "mesma_pessoa" | "familia" | "pessoas_diferentes" | "incerto";

export interface DuplicateOpinionProps {
  a: string;
  b: string;
  verdict: DuplicateVerdictTone;
  label: string;
  reason: string;
  source: "ia" | "regras";
  /** A IA está ligada em Ajustes (mostra o botão) */
  canAsk: boolean;
}

const TONE: Record<DuplicateVerdictTone, string> = {
  mesma_pessoa: "bg-alert-tint text-alert",
  familia: "bg-erp-tint text-erp-ink",
  pessoas_diferentes: "bg-fog text-ink-soft ring-1 ring-line",
  incerto: "bg-fog text-ink-soft ring-1 ring-line",
};

export function DuplicateOpinion(props: DuplicateOpinionProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ask = () =>
    start(async () => {
      setError(null);
      const r = await duplicateOpinionAction(props.a, props.b);
      if (r.ok) router.refresh();
      else setError(r.message);
    });

  return (
    <div className="mt-2 rounded-xl bg-paper px-3 py-2 ring-1 ring-line" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", TONE[props.verdict])}>
          {props.source === "ia" ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          {props.source === "ia" ? "IA" : "Regras"}: {props.label}
        </span>
        {props.canAsk ? (
          <button
            type="button"
            onClick={ask}
            disabled={pending}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-crm hover:bg-crm-tint disabled:opacity-50"
          >
            <Sparkles className={cn("size-3.5", pending && "animate-pulse")} aria-hidden />
            {pending ? "Consultando..." : props.source === "ia" ? "Perguntar de novo" : "Pedir opinião da IA"}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-ink-soft">{props.reason}</p>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
