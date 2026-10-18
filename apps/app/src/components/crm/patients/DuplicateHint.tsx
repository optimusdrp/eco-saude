"use client";

import { JOURNEY_STAGE_LABEL, type JourneyStage } from "@ecosaude/core/crm";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/styles";

/**
 * AVISO DE CADASTRO PARECIDO (enquanto a pessoa digita)
 * Consulta /api/contatos/duplicados meio segundo depois da última tecla e
 * mostra quem já parece ser esta pessoa, com o motivo ("mesmo celular"...).
 */
export interface DuplicateResult {
  id: string;
  name: string;
  phone: string | null;
  stage: JourneyStage;
  strength: "forte" | "media";
  reasons: string[];
}

export interface DuplicateProbe {
  name: string;
  phone: string;
  email: string;
  birthDate: string;
}

export function useDuplicateCheck(probe: DuplicateProbe, excludeId?: string): DuplicateResult[] {
  const key = JSON.stringify([probe.name.trim(), probe.phone.replace(/\D/g, ""), probe.email.trim(), probe.birthDate, excludeId ?? ""]);
  // Resultado guardado junto com a busca que o gerou: busca nova = lista antiga some sozinha
  const [found, setFound] = useState<{ key: string; results: DuplicateResult[] } | null>(null);

  useEffect(() => {
    const enough = probe.name.trim().length >= 3 || probe.phone.replace(/\D/g, "").length >= 8 || probe.email.includes("@");
    if (!enough) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const qs = new URLSearchParams({ nome: probe.name, telefone: probe.phone, email: probe.email, nascimento: probe.birthDate, ignorar: excludeId ?? "" });
      fetch(`/api/contatos/duplicados?${qs}`)
        .then((r) => r.json())
        .then((d: { results?: DuplicateResult[] }) => !cancelled && setFound({ key, results: d.results ?? [] }))
        .catch(() => undefined);
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // key resume todos os campos da busca
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return found?.key === key ? found.results : [];
}

export function DuplicateHint({ results, onUse }: { results: DuplicateResult[]; onUse?: (r: DuplicateResult) => void }) {
  if (results.length === 0) return null;
  const strong = results.some((r) => r.strength === "forte");
  return (
    <div role="status" className={cn("rounded-xl p-3 text-sm", strong ? "bg-alert-tint" : "bg-erp-tint")}>
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        {strong ? "Esta pessoa parece já ter cadastro" : "Há cadastros com nome parecido"}
      </p>
      <ul className="mt-2 space-y-1.5">
        {results.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper/80 px-2.5 py-1.5">
            <span className="min-w-0">
              <span className="font-semibold">{r.name}</span>
              <span className="text-ink-soft">
                {" "}
                ({r.reasons.join(", ")}; {JOURNEY_STAGE_LABEL[r.stage].toLowerCase()})
              </span>
            </span>
            <span className="flex gap-3">
              {onUse ? (
                <button type="button" onClick={() => onUse(r)} className="min-h-9 font-semibold text-crm hover:underline">
                  Usar este
                </button>
              ) : null}
              <Link href={`/crm/contatos/${r.id}`} target="_blank" className="min-h-9 content-center font-semibold text-crm hover:underline">
                Abrir
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
