"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui/styles";

/**
 * MINI CALENDÁRIO com a "temperatura" de cada dia (quantas consultas).
 * Um toque leva para o dia; as setas trocam de mês.
 */
const WEEK = ["S", "T", "Q", "Q", "S", "S", "D"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function shiftMonth(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function MiniCalendar({
  date,
  today,
  counts,
  hrefFor,
  rangeDates,
}: {
  date: string;
  today: string;
  counts: Record<string, number>;
  hrefFor: (date: string) => string;
  /** Dias do período exibido (destaque da semana) */
  rangeDates: string[];
}) {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // semana começa na segunda
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const max = Math.max(1, ...Object.values(counts));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Link href={hrefFor(shiftMonth(date, -1))} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-fog" aria-label="Mês anterior">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <p className="font-display font-bold capitalize">
          {MONTHS[m - 1]} {y}
        </p>
        <Link href={hrefFor(shiftMonth(date, 1))} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-fog" aria-label="Próximo mês">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs" role="grid" aria-label="Escolher dia">
        {WEEK.map((w, i) => (
          <span key={i} className="py-1 font-semibold text-ink-soft" aria-hidden>
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const n = counts[d] ?? 0;
          const heat = n === 0 ? 0 : Math.max(0.18, n / max);
          const inRange = rangeDates.includes(d);
          return (
            <Link
              key={d}
              href={hrefFor(d)}
              aria-current={d === date ? "date" : undefined}
              aria-label={`${Number(d.slice(8))} de ${MONTHS[m - 1]}${n ? `, ${n} consulta${n > 1 ? "s" : ""}` : ""}`}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-lg font-semibold tabular hover:ring-1 hover:ring-crm",
                inRange && "bg-crm-tint",
                d === date && "bg-ink text-white hover:ring-0",
                d === today && d !== date && "text-crm ring-1 ring-crm",
              )}
            >
              {Number(d.slice(8))}
              {/* Temperatura: quanto mais consultas, mais forte o ponto */}
              <span
                className={cn("mt-0.5 h-1 w-3 rounded-full", d === date ? "bg-white" : "bg-crm")}
                style={{ opacity: heat }}
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
