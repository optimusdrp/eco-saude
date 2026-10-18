"use client";

/**
 * JORNADA EM LISTA: todos os contatos filtrados numa tabela,
 * boa para revisar em sequência e para telas grandes.
 * Clique no cabeçalho para ordenar; a etapa pode ser trocada na própria linha.
 */
import { CHANNEL_LABEL, JOURNEY_STAGE_LABEL, JOURNEY_STAGES, type JourneyStage } from "@ecosaude/core/crm";
import { ArrowDown, Flame, MessageCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { isStale } from "./Card";
import { SORT_LABEL, type JourneyCard, type JourneySort } from "./types";

export function ListView({
  cards,
  sort,
  onSort,
  canEdit,
  selecting,
  selected,
  onToggle,
  onMove,
}: {
  cards: JourneyCard[];
  sort: JourneySort;
  onSort: (s: JourneySort) => void;
  canEdit: boolean;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onMove: (card: JourneyCard, stage: JourneyStage) => void;
}) {
  // Cabeçalho de coluna (função comum, não componente: evita recriar componente a cada render)
  const th = (children: React.ReactNode, by?: JourneySort, className?: string) => (
    <th key={String(children)} scope="col" className={cn("px-3 py-2 text-left text-xs font-semibold text-ink-soft", className)} aria-sort={by && sort === by ? "descending" : undefined}>
      {by ? (
        <button type="button" onClick={() => onSort(by)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort === by && "text-ink")} title={`Ordenar por: ${SORT_LABEL[by]}`}>
          {children}
          {sort === by ? <ArrowDown className="size-3" aria-hidden /> : null}
        </button>
      ) : (
        children
      )}
    </th>
  );

  if (cards.length === 0) return <p className="rounded-2xl border border-dashed border-ink/20 p-8 text-center text-ink-soft">Nenhum contato com estes filtros.</p>;

  return (
    <div className="thin-scroll relative overflow-x-auto rounded-2xl bg-paper ring-1 ring-line">
      <table className="w-full min-w-[46rem] text-sm">
        <thead className="border-b border-line">
          <tr>
            {selecting ? <th scope="col" className="w-10 px-3"><span className="sr-only">Selecionar</span></th> : null}
            {th("Nome", "nome")}
            {th("Etapa")}
            {th("Na etapa", "parados")}
            {th("Próxima consulta", "consulta")}
            {th("Responsável")}
            {th("Origem", undefined, "hidden xl:table-cell")}
            {th("Último contato", undefined, "hidden xl:table-cell")}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {cards.map((c) => {
            const stale = isStale(c);
            return (
              <tr key={c.id} className={cn("hover:bg-fog/60", selected.has(c.id) && "bg-crm-tint/50")}>
                {selecting ? (
                  <td className="px-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} className="size-4 accent-[var(--color-crm)]" aria-label={`Selecionar ${c.name}`} />
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  <button type="button" onClick={() => emit("eco:open-patient", c.id)} className="text-left font-semibold hover:text-crm hover:underline">
                    {c.name}
                  </button>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
                    {c.channel ? CHANNEL_LABEL[c.channel] : null}
                    {c.waiting && c.conversationId ? (
                      <Link href={`/crm/conversas/${c.conversationId}`} className="inline-flex items-center gap-1 font-bold text-crm hover:underline">
                        <MessageCircle className="size-3" aria-hidden /> esperando resposta
                      </Link>
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <select
                      value={c.stage}
                      onChange={(e) => onMove(c, e.target.value as JourneyStage)}
                      className="min-h-9 rounded-lg bg-fog px-2 text-xs font-semibold ring-1 ring-line"
                      aria-label={`Etapa de ${c.name}`}
                    >
                      {JOURNEY_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {JOURNEY_STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    JOURNEY_STAGE_LABEL[c.stage]
                  )}
                </td>
                <td className={cn("px-3 py-2 tabular whitespace-nowrap", stale && "font-bold text-erp-ink")}>
                  {stale ? <Flame className="mr-1 inline size-3.5" aria-hidden /> : null}
                  {c.daysInStage} {c.daysInStage === 1 ? "dia" : "dias"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{c.next ?? <span className="text-ink-soft">sem consulta</span>}</td>
                <td className="px-3 py-2">{c.ownerName ?? <span className="text-ink-soft">ninguém</span>}</td>
                <td className="hidden px-3 py-2 xl:table-cell">{c.source ?? <span className="text-ink-soft">não informada</span>}</td>
                <td className="hidden px-3 py-2 whitespace-nowrap xl:table-cell">
                  {c.lastTouchDays === null ? <span className="text-ink-soft">nunca</span> : c.lastTouchDays === 0 ? "hoje" : `há ${c.lastTouchDays} ${c.lastTouchDays === 1 ? "dia" : "dias"}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
