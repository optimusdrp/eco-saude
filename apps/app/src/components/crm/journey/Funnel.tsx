/**
 * FUNIL DE 90 DIAS
 * Dos contatos que chegaram nos últimos 90 dias: quantos conversaram com a
 * equipe, quantos marcaram consulta e quantos compareceram. Cada degrau
 * mostra o percentual sobre o degrau anterior (onde a clínica perde gente).
 */
import { cn } from "@/components/ui/styles";
import type { FunnelStep, JourneyData } from "./types";

const tone = ["bg-crm", "bg-bi", "bg-erp", "bg-ok"];

export function Funnel({ steps, lostReasons, lossGroups }: { steps: FunnelStep[]; lostReasons: { reason: string; n: number }[]; lossGroups?: JourneyData["lossGroups"] }) {
  const top = steps[0]?.value ?? 0;
  // Maior queda entre degraus: é ali que vale agir primeiro
  let worst = -1;
  let worstRate = 101;
  steps.forEach((s, i) => {
    if (i === 0) return;
    const prev = steps[i - 1]!.value;
    const rate = prev ? (s.value / prev) * 100 : 100;
    if (prev && rate < worstRate) {
      worstRate = rate;
      worst = i;
    }
  });

  return (
    <section aria-labelledby="funil-t" className="mb-4 grid gap-3 rounded-2xl bg-paper p-4 ring-1 ring-line lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <h2 id="funil-t" className="text-sm font-bold">
          Funil dos últimos 90 dias
        </h2>
        {top === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">Nenhum contato novo nos últimos 90 dias.</p>
        ) : (
          <ol className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
            {steps.map((s, i) => {
              const prev = i ? steps[i - 1]!.value : null;
              const rate = prev ? Math.round((s.value / prev) * 100) : null;
              return (
                <li key={s.label} className="min-w-0">
                  <p className="flex items-baseline gap-1.5">
                    <span className="font-display text-2xl font-bold tabular">{s.value}</span>
                    <span className="text-sm font-semibold">{s.label}</span>
                  </p>
                  {/* Barra proporcional ao total que chegou */}
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-fog" role="img" aria-label={`${Math.round((s.value / top) * 100)}% dos que chegaram`}>
                    <span className={cn("block h-full rounded-full", tone[i])} style={{ width: `${(s.value / top) * 100}%` }} />
                  </div>
                  <p className={cn("mt-1 text-xs", i === worst ? "font-bold text-alert" : "text-ink-soft")}>
                    {rate === null ? s.hint : `${rate}% do degrau anterior${i === worst ? ", maior perda" : ""}`}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="rounded-xl bg-fog p-3">
        <h3 className="text-sm font-bold">Por que perdemos</h3>
        {lossGroups ? (
          /* Motivos organizados (Ajustes > IA): categorias fixas, com o que os pacientes disseram */
          lossGroups.total === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">Nenhuma perda nos últimos 90 dias.</p>
          ) : (
            <ul className="mt-1.5 space-y-2 text-sm">
              {lossGroups.groups.map((g) => (
                <li key={g.category}>
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{g.label}</span>
                    <span className="shrink-0 tabular">
                      <strong>{g.n}</strong> <span className="text-xs text-ink-soft">({Math.round((g.n / lossGroups.total) * 100)}%)</span>
                    </span>
                  </p>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden>
                    <span className="block h-full rounded-full bg-alert/70" style={{ width: `${(g.n / lossGroups.total) * 100}%` }} />
                  </div>
                  {g.quotes[0] ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft" title={g.quotes.join(" / ")}>
                      “{g.quotes[0]}”
                    </p>
                  ) : null}
                </li>
              ))}
              <li className="text-xs text-ink-soft">
                {lossGroups.total} {lossGroups.total === 1 ? "perda" : "perdas"} em 90 dias, organizadas pela leitura das conversas.
              </li>
            </ul>
          )
        ) : lostReasons.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">Nenhum contato perdido.</p>
        ) : (
          <ul className="mt-1.5 space-y-1 text-sm">
            {lostReasons.map((r) => (
              <li key={r.reason} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate first-letter:uppercase" title={r.reason}>
                  {r.reason}
                </span>
                <span className="shrink-0 font-bold tabular">{r.n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
