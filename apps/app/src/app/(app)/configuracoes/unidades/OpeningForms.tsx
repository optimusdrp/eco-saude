"use client";

import { CLOSURE_KIND_LABEL, CLOSURE_KINDS, WEEKDAY_LONG, type OpeningHours } from "@ecosaude/core/crm";
import { CalendarOff, CalendarPlus, Clock, Minus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { deleteClosureAction, importHolidaysAction, saveClosureAction, saveOpeningHoursAction } from "@/modules/crm/actions/opening";

/**
 * Formulários de horário de funcionamento, feriados e fechamentos (Ajustes > Unidades).
 * Os diálogos fecham sozinhos quando dá certo, MENOS quando o servidor avisa que há consultas
 * marcadas no fechamento: aí a mensagem fica na tela para a pessoa ler.
 */

/** Atualiza a tela e fecha quando a ação dá certo (ajuste durante a renderização) */
function useDone<T extends { ok?: boolean; message?: string }>(state: T, close: () => void, keepOpenIf?: (s: T) => boolean) {
  const router = useRouter();
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    if (state.ok && !keepOpenIf?.(state)) close();
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
}

/* ------------------------------ Horário de funcionamento ------------------------------ */

type Day = { open: boolean; periods: { start: string; end: string }[] };
const ORDER = ["1", "2", "3", "4", "5", "6", "0"] as const;

function toDays(h: OpeningHours): Record<string, Day> {
  return Object.fromEntries(ORDER.map((k) => [k, { open: !!h[k]?.periods.length, periods: h[k]?.periods.length ? h[k]!.periods.map((p) => ({ ...p })) : [{ start: "08:00", end: "18:00" }] }]));
}

export function OpeningHoursButton({ unitId, unitName, main, own, inherited }: { unitId: string; unitName: string; main: boolean; own: OpeningHours | null; inherited: OpeningHours }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => (setKey((k) => k + 1), setOpen(true))} className={buttonStyles("ghost", "min-h-9 px-2.5")} aria-label={`Horário de funcionamento de ${unitName}`}>
        <Clock className="size-4" aria-hidden />
        Horário
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Horário de ${unitName}`}
        description="Vale para a resposta automática “fora do horário” e para avisar quando a semana de um profissional sai do funcionamento. Não esconde horários dos profissionais."
        wide
      >
        <HoursForm key={key} unitId={unitId} main={main} own={own} inherited={inherited} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function HoursForm({ unitId, main, own, inherited, onDone }: { unitId: string; main: boolean; own: OpeningHours | null; inherited: OpeningHours; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveOpeningHoursAction, {});
  useDone(state, onDone);
  const [inherit, setInherit] = useState(!main && own === null);
  const [days, setDays] = useState<Record<string, Day>>(() => toDays(own ?? inherited));
  const set = (k: string, fn: (d: Day) => Day) => setDays((all) => ({ ...all, [k]: fn(all[k]!) }));
  // O que vai para o servidor: só os dias que abrem
  const json = JSON.stringify(Object.fromEntries(ORDER.filter((k) => days[k]!.open).map((k) => [k, { periods: days[k]!.periods }])));

  return (
    <form
      // Envio manual: o React 19 limpa o formulário depois de um envio por `action`, o que
      // desmarcaria as caixas controladas (o estado do editor ficaria diferente da tela)
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="hours" value={json} />
      {!main ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:bg-crm-tint">
          <input type="checkbox" name="inherit" id={`oh-inherit-${unitId}`} checked={inherit} onChange={(e) => setInherit(e.target.checked)} className="mt-1 size-4 accent-[var(--color-crm)]" />
          <span className="text-sm">
            <span className="block font-semibold">Mesmo horário da unidade principal</span>
            <span className="text-ink-soft">Mudou o horário da principal, muda aqui também.</span>
          </span>
        </label>
      ) : null}

      <fieldset disabled={inherit} className={cn("space-y-2", inherit && "opacity-50")}>
        <legend className="sr-only">Dias e horários</legend>
        {ORDER.map((k) => {
          const d = days[k]!;
          const name = WEEKDAY_LONG[Number(k)]!;
          return (
            <div key={k} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2 ring-1 ring-line">
              <label className="flex w-36 cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={d.open} onChange={(e) => set(k, (x) => ({ ...x, open: e.target.checked }))} className="size-4 accent-[var(--color-crm)]" aria-label={`${name}: abre`} />
                {name}
              </label>
              {d.open ? (
                <div className="flex flex-wrap items-center gap-2">
                  {d.periods.map((p, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <input type="time" value={p.start} aria-label={`${name}, período ${i + 1}: abre às`} onChange={(e) => set(k, (x) => ({ ...x, periods: x.periods.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)) }))} className="min-h-10 rounded-lg bg-paper px-2 text-sm ring-1 ring-line" />
                      <span className="text-sm text-ink-soft">às</span>
                      <input type="time" value={p.end} aria-label={`${name}, período ${i + 1}: fecha às`} onChange={(e) => set(k, (x) => ({ ...x, periods: x.periods.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)) }))} className="min-h-10 rounded-lg bg-paper px-2 text-sm ring-1 ring-line" />
                      {d.periods.length > 1 ? (
                        <button type="button" onClick={() => set(k, (x) => ({ ...x, periods: x.periods.filter((_, j) => j !== i) }))} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-fog" aria-label={`Tirar o período ${i + 1} de ${name}`}>
                          <Minus className="size-4" aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {d.periods.length < 3 ? (
                    <button type="button" onClick={() => set(k, (x) => ({ ...x, periods: [...x.periods, { start: "14:00", end: "18:00" }] }))} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-crm hover:bg-crm-tint" aria-label={`Outro período em ${name}`}>
                      <Plus className="size-4" aria-hidden />
                      Período
                    </button>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-ink-soft">Fechado</span>
              )}
            </div>
          );
        })}
      </fieldset>
      <p className="text-xs text-ink-soft">Intervalo de almoço: use dois períodos (ex.: 08:00 às 12:00 e 14:00 às 18:00).</p>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton pendingText="Salvando..." disabled={pending}>
          {pending ? "Salvando..." : "Salvar horário"}
        </SubmitButton>
      </div>
    </form>
  );
}

/* ------------------------------ Feriados e fechamentos ------------------------------ */

export function ClosureButton({ units, today }: { units: { id: string; name: string }[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => (setKey((k) => k + 1), setOpen(true))} className={buttonStyles("secondary", "min-h-10")}>
        <CalendarOff className="size-4" aria-hidden />
        Novo fechamento
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo feriado ou fechamento" description="Nesses dias a unidade (ou a clínica inteira) não oferece horários e a resposta automática avisa que está fechado. Consultas já marcadas não são canceladas sozinhas.">
        <ClosureForm key={key} units={units} today={today} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function ClosureForm({ units, today, onDone }: { units: { id: string; name: string }[]; today: string; onDone: () => void }) {
  const [state, action] = useActionState(saveClosureAction, {});
  useDone(state, onDone, (s) => !!s.message?.includes("Atenção"));
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="De" name="startsOn" id="cl-start" type="date" min={today} required defaultValue={v("startsOn")} error={state.errors?.startsOn} />
        <Field label="Até" name="endsOn" id="cl-end" type="date" min={today} defaultValue={v("endsOn")} error={state.errors?.endsOn} hint="Vazio = só um dia" />
      </div>
      <Field label="Motivo" name="reason" id="cl-reason" required maxLength={120} defaultValue={v("reason")} error={state.errors?.reason} placeholder="Feriado municipal, Recesso de fim de ano..." />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Tipo" name="kind" id="cl-kind" defaultValue={v("kind", "feriado")}>
          {CLOSURE_KINDS.map((k) => (
            <option key={k} value={k}>
              {CLOSURE_KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
        {units.length > 1 ? (
          <SelectField label="Onde" name="unitId" id="cl-unit" defaultValue={v("unitId")}>
            <option value="">Clínica inteira</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                Só {u.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <input type="hidden" name="unitId" value="" />
        )}
      </div>
      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        {state.ok ? (
          <button type="button" onClick={onDone} className={buttonStyles("secondary")}>
            Fechar
          </button>
        ) : (
          <SubmitButton pendingText="Salvando...">Salvar fechamento</SubmitButton>
        )}
      </div>
    </form>
  );
}

export function HolidaysButton({ years }: { years: number[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => (setKey((k) => k + 1), setOpen(true))} className={buttonStyles("ghost", "min-h-10")}>
        <CalendarPlus className="size-4" aria-hidden />
        Trazer feriados nacionais
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Feriados nacionais" description="Entram para a clínica inteira. Feriados estaduais e municipais, cadastre em “Novo fechamento”. Trazer de novo não duplica.">
        <HolidaysForm key={key} years={years} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function HolidaysForm({ years, onDone }: { years: number[]; onDone: () => void }) {
  const [state, action] = useActionState(importHolidaysAction, {});
  // Fica aberto mostrando quantos feriados entraram (e se há consultas nesses dias)
  useDone(state, onDone, () => true);
  return (
    <form action={action} className="space-y-3">
      <SelectField label="Ano" name="year" id="hol-year" defaultValue={String(years[0])}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </SelectField>
      <CheckboxField name="optional" label="Incluir pontos facultativos" hint="Carnaval (segunda e terça) e Corpus Christi. Marque se a clínica fecha nesses dias." />
      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        {state.ok ? (
          <button type="button" onClick={onDone} className={buttonStyles("secondary")}>
            Fechar
          </button>
        ) : (
          <SubmitButton pendingText="Trazendo...">Trazer feriados</SubmitButton>
        )}
      </div>
    </form>
  );
}

export function DeleteClosureButton({ id, reason }: { id: string; reason: string }) {
  const [state, action] = useActionState(deleteClosureAction, {});
  useDone(state, () => undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" className="min-h-9 px-2" pendingText="..." aria-label={`Remover ${reason}`}>
        <Trash2 className="size-4" aria-hidden />
      </SubmitButton>
      {state.ok === false && state.message ? <FormMessage state={state} /> : null}
    </form>
  );
}
