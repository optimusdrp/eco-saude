"use client";

/**
 * Quadros menores do painel HOJE: Amanhã, Horários livres, Aniversariantes e Pulso da semana.
 */
import { Cake, Hourglass } from "lucide-react";
import Link from "next/link";
import { ActionButton, PatientLink } from "@/components/crm/widgets";
import { colorOf } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { requestConfirmationsAction } from "@/modules/crm/actions/agenda";
import type { FreeSlot } from "./parts";
import { hhmm, type TodayData } from "./types";

/* ---------------------------------- Amanhã ---------------------------------- */

export function Tomorrow({ data, onOpen }: { data: TodayData; onOpen: (id: string) => void }) {
  const list = data.tomorrow.appointments;
  if (list.length === 0) {
    return <p className="text-sm text-ink-soft">Nenhuma consulta marcada para amanhã ({data.tomorrow.label}).</p>;
  }
  const confirmed = list.filter((a) => a.status === "confirmado");
  const waiting = list.filter((a) => a.status === "agendado" && a.confirmationRequested);
  const notAsked = list.filter((a) => a.status === "agendado" && !a.confirmationRequested);
  const pct = (n: number) => `${(n / list.length) * 100}%`;
  const pending = [...waiting, ...notAsked].sort((a, b) => a.startMin - b.startMin);

  return (
    <div>
      <p className="font-display text-3xl font-bold tabular">
        {confirmed.length}
        <span className="text-lg text-ink-soft"> de {list.length} confirmadas</span>
      </p>
      {/* Barra: confirmadas / aguardando resposta / sem pedido */}
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-fog" role="img" aria-label={`${confirmed.length} confirmadas, ${waiting.length} aguardando resposta, ${notAsked.length} sem pedido de confirmação`}>
        <span className="bg-ok" style={{ width: pct(confirmed.length) }} />
        <span className="bg-erp" style={{ width: pct(waiting.length) }} />
        <span className="bg-ink/15" style={{ width: pct(notAsked.length) }} />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        <Legend className="bg-ok">Confirmadas {confirmed.length}</Legend>
        <Legend className="bg-erp">Aguardando {waiting.length}</Legend>
        <Legend className="bg-ink/15">Sem pedido {notAsked.length}</Legend>
      </ul>

      {pending.length ? (
        <ul className="mt-3 divide-y divide-line">
          {pending.slice(0, 6).map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onOpen(a.id)} className="flex w-full items-center gap-2 py-2 text-left text-sm hover:text-crm">
                <span className="w-11 font-bold tabular">{a.time}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{a.contactName}</span>
                <span className="shrink-0 text-xs text-ink-soft">{a.confirmationRequested ? "aguardando" : "sem pedido"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {notAsked.length && data.features.confirmations && data.canEdit ? (
          <ActionButton action={requestConfirmationsAction} multi={{ appointmentId: notAsked.map((a) => a.id) }} label={`Pedir confirmação para ${notAsked.length}`} pendingText="Enviando..." variant="primary" />
        ) : null}
        <Link href={`/crm/agenda?data=${isoDate(data.today, 1)}`} className="text-sm font-semibold text-crm hover:underline">
          Ver agenda de amanhã
        </Link>
      </div>
    </div>
  );
}

function isoDate(today: string, add: number) {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + add)).toISOString().slice(0, 10);
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} aria-hidden />
      {children}
    </li>
  );
}

/* ------------------------------ Horários livres ------------------------------ */

export function FreeToday({ data, slots, waitlistTotal }: { data: TodayData; slots: FreeSlot[]; waitlistTotal: number }) {
  const working = data.professionals.filter((p) => p.start !== null);
  if (working.length === 0) return <p className="text-sm text-ink-soft">Ninguém atende hoje.</p>;
  if (!data.canEdit) return <p className="text-sm text-ink-soft">Seu acesso não permite agendar.</p>;
  if (slots.length === 0) return <p className="text-sm text-ink-soft">Sem horários livres no restante do dia.</p>;
  return (
    <div className="space-y-3">
      {waitlistTotal && data.features.waitlist ? (
        <Link href="/crm/espera" className="flex items-center gap-2 rounded-xl bg-crm-tint px-3 py-2 text-sm font-semibold text-crm hover:underline">
          <Hourglass className="size-4 shrink-0" aria-hidden />
          {waitlistTotal} {waitlistTotal === 1 ? "pessoa aguarda" : "pessoas aguardam"} vaga na lista de espera
        </Link>
      ) : null}
      {working.map((p) => {
        const own = slots.filter((s) => s.professionalId === p.id);
        if (own.length === 0) return null;
        return (
          <div key={p.id}>
            <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
              <span className={cn("size-2 rounded-full", colorOf(p.color).dot)} aria-hidden />
              {p.name}
              <span className="font-normal text-ink-soft">({own.length})</span>
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {own.slice(0, 10).map((s) => (
                <li key={s.min}>
                  <button
                    type="button"
                    onClick={() => emit("eco:open-schedule", { professionalId: p.id, date: data.today, time: hhmm(s.min) })}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-dashed border-crm/40 px-2.5 text-sm font-semibold text-crm tabular hover:border-crm hover:bg-crm-tint"
                    aria-label={`Agendar às ${hhmm(s.min)} com ${p.name}${s.waiting ? `, ${s.waiting} na lista de espera` : ""}`}
                  >
                    {hhmm(s.min)}
                    {s.waiting ? (
                      <span className="rounded-full bg-crm px-1.5 text-[0.65rem] text-white" aria-hidden>
                        {s.waiting}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
              {own.length > 10 ? <li className="self-center text-xs text-ink-soft">+{own.length - 10}</li> : null}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Aniversariantes ------------------------------ */

export function Birthdays({ data }: { data: TodayData }) {
  if (data.birthdays.length === 0) return <p className="text-sm text-ink-soft">Nenhum paciente faz aniversário hoje.</p>;
  return (
    <ul className="space-y-2">
      {data.birthdays.map((b) => (
        <li key={b.contactId} className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-erp-tint text-erp-ink" aria-hidden>
            <Cake className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <PatientLink id={b.contactId} name={b.name} className="block truncate" />
            <span className="text-xs text-ink-soft">{b.age !== null ? `faz ${b.age} anos. ` : ""}Abra a ficha para enviar os parabéns.</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ Pulso da semana ------------------------------ */

export function Pulse({ data }: { data: TodayData }) {
  const days = data.pulse.days;
  const attended = days.reduce((s, d) => s + d.attended, 0);
  const missed = days.reduce((s, d) => s + d.missed, 0);
  const contacts = days.reduce((s, d) => s + d.newContacts, 0);
  const rate = attended + missed ? Math.round((attended / (attended + missed)) * 100) : null;
  const max = Math.max(1, ...days.map((d) => d.attended + d.missed + d.cancelled));

  return (
    <div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
        <Metric label="Comparecimento" value={rate === null ? "sem dados" : `${rate}%`} hint={`${attended} atendidos`} />
        <Metric label="Faltas" value={String(missed)} hint="7 dias" tone={missed ? "alert" : undefined} />
        <Metric label="Novos contatos" value={String(contacts)} hint={`${data.createdToday.contacts} hoje`} />
        <Metric label="Satisfação" value={data.pulse.nps.avg === null ? "sem notas" : String(data.pulse.nps.avg).replace(".", ",")} hint={`${data.pulse.nps.count} notas, 30 dias`} />
      </dl>

      {/* Barras empilhadas por dia: atendidos, faltas, cancelados */}
      <div className="mt-4 flex h-28 items-end gap-2" role="img" aria-label={days.map((d) => `${d.label}: ${d.attended} atendidos, ${d.missed} faltas, ${d.cancelled} canceladas`).join("; ")}>
        {days.map((d) => {
          const total = d.attended + d.missed + d.cancelled;
          return (
            <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div className="flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-md bg-fog" style={{ height: `${Math.max(6, (total / max) * 100)}%` }}>
                <span className="bg-bi" style={{ height: total ? `${(d.attended / total) * 100}%` : 0 }} />
                <span className="bg-alert" style={{ height: total ? `${(d.missed / total) * 100}%` : 0 }} />
                <span className="bg-ink/15" style={{ height: total ? `${(d.cancelled / total) * 100}%` : 0 }} />
              </div>
              <span className={cn("text-[0.7rem] text-ink-soft first-letter:uppercase", d.date === data.today && "font-bold text-ink")}>{d.label}</span>
            </div>
          );
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        <Legend className="bg-bi">Atendidos</Legend>
        <Legend className="bg-alert">Faltas</Legend>
        <Legend className="bg-ink/15">Canceladas</Legend>
      </ul>
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "alert" }) {
  return (
    <div className="rounded-xl bg-fog px-3 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={cn("font-display text-xl font-bold tabular", tone === "alert" && "text-alert")}>{value}</dd>
      <dd className="text-xs text-ink-soft">{hint}</dd>
    </div>
  );
}
