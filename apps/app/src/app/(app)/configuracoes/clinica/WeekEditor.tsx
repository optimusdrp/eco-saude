"use client";

/**
 * EDITOR DA SEMANA DO PROFISSIONAL
 *
 * Cada dia é independente: liga/desliga, um ou mais períodos (o vão entre eles
 * é o intervalo) e, se quiser, uma duração de consulta só daquele dia.
 * Atalhos: modelos prontos e "copiar este dia para os dias de atendimento".
 * O resultado vai num campo oculto (JSON) e é validado de novo no servidor.
 */
import {
  toHHMM,
  toMinutes,
  validateWeekly,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  weeklyCapacity,
  type DaySchedule,
  type WeeklySchedule,
} from "@ecosaude/core/crm";
import { CopyPlus, Plus, X } from "lucide-react";
import { cn } from "@/components/ui/styles";

type Key = keyof WeeklySchedule;
const ORDER: Key[] = ["1", "2", "3", "4", "5", "6", "0"]; // segunda a domingo
const DURATIONS = [10, 15, 20, 30, 40, 45, 50, 60, 90, 120];
const hours = (min: number) => (min / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const durationLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60}` : ""}`);

const TEMPLATES: { label: string; week: () => WeeklySchedule }[] = [
  { label: "Seg a sex, 08 às 12 e 13 às 18", week: () => fill(["1", "2", "3", "4", "5"], [["08:00", "12:00"], ["13:00", "18:00"]]) },
  { label: "Seg a sex, 08 às 18 direto", week: () => fill(["1", "2", "3", "4", "5"], [["08:00", "18:00"]]) },
  { label: "Seg a sex à tarde e sáb de manhã", week: () => ({ ...fill(["1", "2", "3", "4", "5"], [["13:00", "19:00"]]), ...fill(["6"], [["08:00", "12:00"]]) }) },
];

function fill(days: Key[], periods: [string, string][]): WeeklySchedule {
  const out: WeeklySchedule = {};
  for (const d of days) out[d] = { periods: periods.map(([start, end]) => ({ start, end })) };
  return out;
}

export function WeekEditor({ value, onChange, slotMinutes, onSlotChange, idPrefix }: { value: WeeklySchedule; onChange: (w: WeeklySchedule) => void; slotMinutes: number; onSlotChange: (m: number) => void; idPrefix: string }) {
  const issues = validateWeekly(value, slotMinutes);
  const cap = weeklyCapacity(value, slotMinutes);

  const setDay = (k: Key, day: DaySchedule | undefined) => {
    const next = { ...value };
    if (day) next[k] = day;
    else delete next[k];
    onChange(next);
  };
  const toggleDay = (k: Key) => {
    if (value[k]) return setDay(k, undefined);
    // Liga copiando o último dia ligado (o mais comum é repetir o horário)
    const model = ORDER.map((d) => value[d]).find(Boolean);
    setDay(k, model ? structuredClone(model) : { periods: [{ start: "08:00", end: "12:00" }] });
  };
  const copyToAll = (k: Key) => {
    const day = value[k]!;
    const next: WeeklySchedule = {};
    for (const d of ORDER) if (value[d]) next[d] = structuredClone(day);
    onChange(next);
  };
  const addPeriod = (k: Key) => {
    const day = value[k]!;
    const last = day.periods[day.periods.length - 1];
    const start = last ? Math.min(toMinutes(last.end) + 60, 22 * 60) : 8 * 60;
    setDay(k, { ...day, periods: [...day.periods, { start: toHHMM(start), end: toHHMM(Math.min(start + 4 * 60, 23 * 60 + 30)) }] });
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Horários de atendimento</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block font-semibold">Duração padrão da consulta</span>
          <select name="slotMinutes" value={slotMinutes} onChange={(e) => onSlotChange(Number(e.target.value))} className="mt-1 min-h-10 rounded-xl bg-paper px-2 ring-1 ring-line">
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">Aplicar um modelo</span>
          <select
            value=""
            onChange={(e) => {
              const t = TEMPLATES[Number(e.target.value)];
              if (t) onChange(t.week());
            }}
            className="mt-1 min-h-10 w-full rounded-xl bg-paper px-2 ring-1 ring-line"
          >
            <option value="">Escolha para substituir a semana...</option>
            {TEMPLATES.map((t, i) => (
              <option key={t.label} value={i}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
        {ORDER.map((k) => {
          const day = value[k];
          const n = Number(k);
          return (
            <li key={k} className={cn("grid gap-2 p-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]", !day && "bg-fog/60")}>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 self-start">
                <input type="checkbox" checked={!!day} onChange={() => toggleDay(k)} className="peer sr-only" />
                <span
                  aria-hidden
                  className="relative h-6 w-10 shrink-0 rounded-full bg-ink/20 transition-colors peer-checked:bg-crm peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-crm after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
                />
                <span className="font-semibold">
                  <span className="sm:hidden">{WEEKDAY_LONG[n]}</span>
                  <span className="hidden sm:inline">{WEEKDAY_SHORT[n]}</span>
                </span>
              </label>

              {day ? (
                <div className="min-w-0 space-y-2">
                  {day.periods.map((p, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        aria-label={`${WEEKDAY_LONG[n]}, período ${i + 1}: início`}
                        value={p.start}
                        onChange={(e) => setDay(k, { ...day, periods: day.periods.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })}
                        className="min-h-10 w-[7.5rem] rounded-xl bg-paper px-2 ring-1 ring-line"
                        id={i === 0 ? `${idPrefix}-${k}` : undefined}
                      />
                      <span className="text-sm text-ink-soft">às</span>
                      <input
                        type="time"
                        aria-label={`${WEEKDAY_LONG[n]}, período ${i + 1}: fim`}
                        value={p.end}
                        onChange={(e) => setDay(k, { ...day, periods: day.periods.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })}
                        className="min-h-10 w-[7.5rem] rounded-xl bg-paper px-2 ring-1 ring-line"
                      />
                      {day.periods.length > 1 ? (
                        <button type="button" onClick={() => setDay(k, { ...day, periods: day.periods.filter((_, j) => j !== i) })} className="inline-flex size-10 items-center justify-center rounded-xl text-ink-soft hover:bg-fog hover:text-alert" aria-label={`Tirar o período ${i + 1} de ${WEEKDAY_LONG[n]}`}>
                          <X className="size-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {day.periods.length < 4 ? (
                      <button type="button" onClick={() => addPeriod(k)} className="inline-flex min-h-9 items-center gap-1 font-semibold text-crm hover:underline">
                        <Plus className="size-4" aria-hidden /> Período
                      </button>
                    ) : null}
                    <button type="button" onClick={() => copyToAll(k)} className="inline-flex min-h-9 items-center gap-1 font-semibold text-crm hover:underline" title="Copia estes horários para todos os dias de atendimento">
                      <CopyPlus className="size-4" aria-hidden /> Copiar para os outros dias
                    </button>
                    <label className="inline-flex items-center gap-1 text-ink-soft">
                      Consultas de
                      <select
                        value={day.slotMinutes ?? ""}
                        onChange={(e) => setDay(k, { ...day, slotMinutes: e.target.value ? Number(e.target.value) : undefined })}
                        className="min-h-9 rounded-lg bg-paper px-1 text-ink ring-1 ring-line"
                        aria-label={`Duração da consulta em ${WEEKDAY_LONG[n]}`}
                      >
                        <option value="">{durationLabel(slotMinutes)} (padrão)</option>
                        {DURATIONS.filter((m) => m !== slotMinutes).map((m) => (
                          <option key={m} value={m}>
                            {durationLabel(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ) : (
                <p className="flex min-h-10 items-center text-sm text-ink-soft">Não atende</p>
              )}
            </li>
          );
        })}
      </ul>

      <input type="hidden" name="weeklySchedule" value={JSON.stringify(value)} />
      {issues.length ? (
        <ul role="alert" className="space-y-0.5 rounded-xl bg-alert-tint p-3 text-sm font-semibold text-alert">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft" role="status">
          {cap.days} {cap.days === 1 ? "dia" : "dias"} por semana, {hours(cap.minutes)} h de atendimento, até {cap.slots} consultas.
        </p>
      )}
    </fieldset>
  );
}
