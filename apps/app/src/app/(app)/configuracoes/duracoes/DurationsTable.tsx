"use client";

/**
 * Tabela da duração real por profissional e procedimento, com "Aplicar".
 * No celular cada linha vira um cartão (sem rolagem lateral).
 */
import { Timer } from "lucide-react";
import { useActionState } from "react";
import { FormMessage } from "@/components/ui";
import { Badge, EmptyState } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { applyDurationAction } from "@/modules/crm/actions/agenda";
import type { DurationView } from "@/modules/crm/ml/durations";

export function DurationsTable({ rows, measured }: { rows: DurationView[]; measured: number }) {
  if (!rows.length) {
    return (
      <EmptyState title="Ainda sem medições" className="bg-paper">
        <p>Na agenda, marque “Chegou” quando o paciente chegar e “Finalizar atendimento” quando ele sair.</p>
        <p className="mt-1">Com 5 atendimentos medidos de um procedimento, a sugestão aparece aqui.</p>
      </EmptyState>
    );
  }
  const pros = [...new Set(rows.map((r) => r.professionalName))];
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-soft">{measured} atendimentos medidos nos últimos 6 meses.</p>
      {pros.map((name) => (
        <section key={name} aria-labelledby={`pro-${name}`}>
          <h2 id={`pro-${name}`} className="mb-2 text-lg font-bold">
            {name}
          </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {rows
              .filter((r) => r.professionalName === name)
              .map((r) => (
                <DurationCard key={`${r.professionalId}-${r.serviceKey}`} r={r} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DurationCard({ r }: { r: DurationView }) {
  const [state, action, pending] = useActionState(applyDurationAction, {});
  const longer = r.suggestion !== null && r.suggestion > r.scheduledMedian;
  return (
    <li className="rounded-2xl bg-paper p-4 ring-1 ring-line">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{r.serviceLabel || "Sem procedimento informado"}</h3>
        {r.applied ? <Badge tone="success">aplicada: {r.applied} min</Badge> : null}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Marcada" value={`${r.scheduledMedian} min`} />
        <Stat label="Real (típica)" value={`${r.realMedian} min`} tone={r.realMedian > r.scheduledMedian ? "alert" : undefined} />
        <Stat label="Sugerida" value={r.suggestion ? `${r.suggestion} min` : "—"} tone={r.suggestion ? "crm" : undefined} />
      </dl>
      <p className="mt-2 text-xs text-ink-soft">
        {r.n} {r.n === 1 ? "atendimento medido" : "atendimentos medidos"}.{" "}
        {r.lateMedian > 3 ? `Pacientes chegam em média ${r.lateMedian} min atrasados.` : r.lateMedian < -3 ? `Pacientes chegam em média ${-r.lateMedian} min antes.` : "Pacientes chegam no horário."}
        {r.suggestion === null
          ? " Com 5 medições aparece a sugestão."
          : longer
            ? " As consultas estão passando do tempo marcado: a agenda tende a atrasar."
            : r.suggestion < r.scheduledMedian
              ? " As consultas terminam antes do tempo marcado: dá para encurtar e abrir mais horários."
              : ""}
      </p>
      {r.suggestion ? (
        <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="professionalId" value={r.professionalId} />
          <input type="hidden" name="serviceKey" value={r.serviceKey} />
          <input type="hidden" name="serviceLabel" value={r.serviceLabel} />
          <input type="hidden" name="minutes" value={r.suggestion} />
          {r.applied !== r.suggestion ? (
            <button type="submit" disabled={pending} className={buttonStyles("primary")}>
              <Timer className="size-4" aria-hidden /> Usar {r.suggestion} min nos próximos agendamentos
            </button>
          ) : null}
          {r.applied ? (
            <button type="submit" name="remove" value="1" disabled={pending} className={buttonStyles("ghost")}>
              Voltar à padrão ({r.professionalSlot} min)
            </button>
          ) : null}
        </form>
      ) : null}
      {state.message ? (
        <div className="mt-2">
          <FormMessage state={state} />
        </div>
      ) : null}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "alert" | "crm" }) {
  return (
    <div className="rounded-xl bg-fog px-2 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={cn("font-display text-lg font-bold tabular", tone === "alert" && "text-alert", tone === "crm" && "text-crm")}>{value}</dd>
    </div>
  );
}
