"use client";

/**
 * RECEPÇÃO AO VIVO
 * O que a recepção precisa saber AGORA, recalculado a cada 30 s no navegador:
 *  1. Atrasados: passou 10 min do horário e ninguém marcou "Chegou" -> Chegou / Faltou
 *  2. Em consulta: já chegaram e o horário ainda não terminou
 *  3. Próximos: quem chega a seguir, com contagem regressiva e dicas
 *     (1ª consulta, risco de falta, sem confirmação)
 */
import { ATTENDANCE_TOLERANCE_MIN, RISK_LABEL } from "@ecosaude/core/crm";
import { AlarmClock, CalendarDays, Sparkles, Stethoscope } from "lucide-react";
import Link from "next/link";
import { Badge, colorOf } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { QuickStatus, untilLabel } from "./parts";
import type { TodayAppointment, TodayData } from "./types";

/** Minutos de tolerância antes de considerar "atrasado" */
const LATE_AFTER_MIN = 10;

export function Reception({
  data,
  nowMin,
  compact,
  onOpen,
}: {
  data: TodayData;
  nowMin: number;
  compact: boolean;
  onOpen: (id: string) => void;
}) {
  const appts = data.appointments;
  if (appts.length === 0) {
    return (
      <div className="rounded-xl bg-fog px-4 py-6 text-center">
        <p className="font-semibold">Nenhuma consulta hoje.</p>
        {data.nextDay ? (
          <Link href={`/crm/agenda?data=${data.nextDay.date}`} className="mt-1 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-crm hover:underline">
            <CalendarDays className="size-4" aria-hidden />
            Próximo dia com consultas: {data.nextDay.label} ({data.nextDay.count})
          </Link>
        ) : null}
      </div>
    );
  }

  const open = (a: TodayAppointment) => a.status === "agendado" || a.status === "confirmado";
  const late = appts.filter((a) => open(a) && a.startMin + LATE_AFTER_MIN <= nowMin);
  const inRoom = appts.filter((a) => a.status === "compareceu" && a.startMin <= nowMin && nowMin < a.endMin);
  const next = appts.filter((a) => open(a) && a.startMin + LATE_AFTER_MIN > nowMin).slice(0, compact ? 3 : 5);
  const attended = appts.filter((a) => a.status === "compareceu").length;
  const missed = appts.filter((a) => a.status === "faltou").length;
  const remaining = appts.filter((a) => open(a) && a.startMin + LATE_AFTER_MIN > nowMin).length;

  return (
    <div className="space-y-4">
      {/* Placar do dia */}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Score label="Atendidos" value={attended} className="text-bi" />
        <Score label="Faltas" value={missed} className={missed ? "text-alert" : ""} />
        <Score label="A chegar" value={remaining} />
      </dl>

      {late.length ? (
        <Group icon={<AlarmClock className="size-4" aria-hidden />} title="Atrasados" tone="alert">
          {late.map((a) => (
            <Row key={a.id} a={a} onOpen={onOpen} meta={`atrasado ${nowMin - a.startMin} min`} metaTone="alert">
              {data.canEdit ? (
                <>
                  <QuickStatus appt={a} status="compareceu" label="Chegou" variant="primary" />
                  <QuickStatus appt={a} status="faltou" label="Faltou" variant="ghost" />
                </>
              ) : null}
            </Row>
          ))}
        </Group>
      ) : null}

      {inRoom.length ? (
        <Group icon={<Stethoscope className="size-4" aria-hidden />} title="Em consulta">
          {inRoom.map((a) => (
            <Row key={a.id} a={a} onOpen={onOpen} meta={`termina ${untilLabel(a.endMin - nowMin)}`} />
          ))}
        </Group>
      ) : null}

      <Group title="Próximos">
        {next.length === 0 ? (
          <p className="text-sm text-ink-soft">Ninguém mais para chegar hoje.</p>
        ) : (
          next.map((a) => {
            const canMark = data.canEdit && a.startMin - ATTENDANCE_TOLERANCE_MIN <= nowMin;
            return (
              <Row key={a.id} a={a} onOpen={onOpen} meta={untilLabel(a.startMin - nowMin)}>
                {canMark ? <QuickStatus appt={a} status="compareceu" label="Chegou" /> : null}
              </Row>
            );
          })
        )}
      </Group>
    </div>
  );
}

function Score({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl bg-fog px-2 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={cn("font-display text-2xl font-bold tabular", className)}>{value}</dd>
    </div>
  );
}

function Group({ icon, title, tone, children }: { icon?: React.ReactNode; title: string; tone?: "alert"; children: React.ReactNode }) {
  return (
    <div>
      <h3 className={cn("mb-1.5 flex items-center gap-1.5 text-sm font-bold", tone === "alert" ? "text-alert" : "text-ink-soft")}>
        {icon}
        {title}
      </h3>
      <ul className="divide-y divide-line">{children}</ul>
    </div>
  );
}

function Row({
  a,
  meta,
  metaTone,
  onOpen,
  children,
}: {
  a: TodayAppointment;
  meta: string;
  metaTone?: "alert";
  onOpen: (id: string) => void;
  children?: React.ReactNode;
}) {
  const hints: string[] = [];
  if (a.firstVisit) hints.push("1ª consulta: confira documento e cadastro");
  if (a.status === "agendado") hints.push(a.confirmationRequested ? "pediu confirmação, sem resposta" : "sem confirmação");
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <button type="button" onClick={() => onOpen(a.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="w-16 shrink-0">
          <span className="block font-display text-base font-bold tabular">{a.time}</span>
          <span className={cn("block text-xs font-semibold", metaTone === "alert" ? "text-alert" : "text-ink-soft")}>{meta}</span>
        </span>
        <span className={cn("h-9 w-1 shrink-0 rounded-full", colorOf(a.professionalColor).dot)} aria-hidden />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold">{a.contactName}</span>
            {a.firstVisit ? (
              <Badge tone="crm" className="px-1.5">
                <Sparkles className="size-3" aria-hidden />
                1ª
              </Badge>
            ) : null}
            {a.risk && a.risk.level !== "baixo" ? <Badge tone={a.risk.level === "alto" ? "alert" : "warning"}>{RISK_LABEL[a.risk.level]}</Badge> : null}
          </span>
          <span className="block truncate text-sm text-ink-soft">
            {a.professionalName}
            {a.service ? `, ${a.service}` : ""}
            {hints.length ? `. ${hints.join("; ")}` : ""}
          </span>
        </span>
      </button>
      {children ? <span className="ml-auto flex shrink-0 items-start gap-1.5">{children}</span> : null}
    </li>
  );
}
