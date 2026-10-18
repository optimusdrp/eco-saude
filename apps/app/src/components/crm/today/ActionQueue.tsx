"use client";

/**
 * FILA DE AÇÕES
 * Tudo o que pede uma ação hoje, numa lista só e em ordem de prioridade:
 *   urgência > responder > risco de falta > confirmar amanhã > tarefas > retornos
 * Filtros por tipo (com contagem), "só minhas tarefas" e cada item resolve
 * em um toque (abrir conversa, pedir confirmação, concluir tarefa...).
 */
import { RISK_LABEL } from "@ecosaude/core/crm";
import { AlertTriangle, ArrowRight, CalendarClock, ListChecks, MessagesSquare, ShieldAlert, Send } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { WaitRing } from "@/components/crm/WaitRing";
import { ActionButton, PatientLink } from "@/components/crm/widgets";
import { Badge, ChannelBadge } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { requestConfirmationsAction } from "@/modules/crm/actions/agenda";
import { completeTaskAction } from "@/modules/crm/actions/contacts";
import { waitLabel } from "@/modules/crm/format";
import type { TodayData } from "./types";

type Kind = "urgencia" | "responder" | "risco" | "confirmar" | "tarefa" | "retorno";

const KIND_LABEL: Record<Kind, string> = {
  urgencia: "Urgências",
  responder: "Responder",
  risco: "Risco de falta",
  confirmar: "Confirmar",
  tarefa: "Tarefas",
  retorno: "Retornos",
};

interface Item {
  /** Ordem: 0 = urgência, 1 = aviso de sentimento à gestão, 2 = o resto (na ordem em que entrou) */
  rank?: number;
  key: string;
  kind: Kind;
  node: ReactNode;
}

export function ActionQueue({
  data,
  nowMs,
  compact,
  onlyMine,
  onOnlyMine,
  onOpen,
}: {
  data: TodayData;
  nowMs: number;
  compact: boolean;
  onlyMine: boolean;
  onOnlyMine: (v: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Kind | "todos">("todos");
  const [expanded, setExpanded] = useState(false);
  const items: Item[] = [];

  /* 1. Urgências */
  for (const c of data.waiting.filter((w) => w.urgent)) {
    items.push({
      key: `u-${c.id}`,
      kind: "urgencia",
      rank: 0,
      node: (
        <div className="rounded-xl bg-alert-tint p-3 ring-1 ring-alert/30">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-alert" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-alert">Possível urgência: {c.contactName}</p>
              {c.preview ? <p className="mt-0.5 text-sm">“{c.preview}”</p> : null}
              {c.urgentGuidance ? <p className="mt-1.5 text-sm text-ink-soft">{c.urgentGuidance}</p> : null}
            </div>
            <Link href={`/crm/conversas/${c.id}`} className="inline-flex min-h-10 items-center rounded-xl bg-alert px-4 text-sm font-semibold text-white">
              Abrir conversa
            </Link>
          </div>
        </div>
      ),
    });
  }

  /* 2. Responder (anel de espera ao vivo) */
  for (const c of data.waiting.filter((w) => !w.urgent)) {
    items.push({
      key: `r-${c.id}`,
      kind: "responder",
      node: (
        <Link href={`/crm/conversas/${c.id}`} className="flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-fog/70">
          <WaitRing name={c.contactName} since={new Date(c.sinceMs)} now={nowMs} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="font-semibold">{c.contactName}</span>
              <ChannelBadge channel={c.channel} />
            </span>
            <span className="block truncate text-sm text-ink-soft">{c.preview}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-sm font-bold tabular">{waitLabel(new Date(c.sinceMs), nowMs)}</span>
            {c.intentLabel ? <Badge tone="crm">{c.intentLabel}</Badge> : null}
          </span>
        </Link>
      ),
    });
  }

  /* 3. Risco de falta (hoje que ainda não começou e amanhã) */
  const nowIso = new Date(nowMs).toISOString();
  const risky = [...data.appointments, ...data.tomorrow.appointments]
    .filter((a) => a.risk && a.risk.level !== "baixo" && a.startsAt > nowIso && (a.status === "agendado" || a.status === "confirmado"))
    .sort((x, y) => (y.risk?.score ?? 0) - (x.risk?.score ?? 0));
  for (const a of risky) {
    const risk = a.risk!;
    items.push({
      key: `k-${a.id}`,
      kind: "risco",
      node: (
        <div className="rounded-xl bg-fog p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button type="button" onClick={() => onOpen(a.id)} className="min-w-0 text-left">
              <span className="block font-semibold hover:underline">{a.contactName}</span>
              <span className="block text-sm text-ink-soft">
                {a.when}, {a.professionalName}
              </span>
            </button>
            <Badge tone={risk.level === "alto" ? "alert" : "warning"}>
              {RISK_LABEL[risk.level]} ({risk.score}%)
            </Badge>
          </div>
          <p className="mt-1 text-sm">{risk.reasons.join(". ")}.</p>
          {risk.suggestion ? <p className="mt-0.5 text-sm font-semibold">{risk.suggestion}</p> : null}
          {a.status === "agendado" && !a.confirmationRequested && data.features.confirmations && data.canEdit ? (
            <div className="mt-2">
              <ActionButton action={requestConfirmationsAction} fields={{ appointmentId: a.id }} label="Pedir confirmação agora" pendingText="Enviando..." variant="secondary" />
            </div>
          ) : a.status === "agendado" && a.confirmationRequested ? (
            <p className="mt-1 text-xs text-ink-soft">Confirmação pedida, aguardando resposta.</p>
          ) : null}
        </div>
      ),
    });
  }

  /* 4. Confirmar amanhã (um item com todos) */
  const toConfirm = data.tomorrow.appointments.filter((a) => a.status === "agendado" && !a.confirmationRequested);
  if (toConfirm.length && data.features.confirmations && data.canEdit) {
    items.push({
      key: "confirmar",
      kind: "confirmar",
      node: (
        <div className="rounded-xl p-3 ring-1 ring-line">
          <p className="flex items-center gap-2 font-semibold">
            <Send className="size-4 text-crm" aria-hidden />
            {toConfirm.length} {toConfirm.length === 1 ? "consulta de amanhã sem" : "consultas de amanhã sem"} pedido de confirmação
          </p>
          <ul className="my-2 flex flex-wrap gap-1.5">
            {toConfirm.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onOpen(a.id)} className="rounded-full bg-fog px-3 py-1 text-sm ring-1 ring-line hover:ring-crm">
                  <span className="font-semibold tabular">{a.time}</span> {a.contactName}
                </button>
              </li>
            ))}
          </ul>
          <ActionButton action={requestConfirmationsAction} multi={{ appointmentId: toConfirm.map((a) => a.id) }} label={`Pedir confirmação para ${toConfirm.length}`} pendingText="Enviando..." variant="primary" />
        </div>
      ),
    });
  }

  /* 5. Tarefas (atrasadas primeiro) */
  const tasks = data.tasks.filter((t) => !onlyMine || t.assigneeId === data.userId);
  for (const t of tasks) {
    items.push({
      key: `t-${t.id}`,
      kind: "tarefa",
      // Paciente irritado/ameaçando: logo depois das urgências (a gestão age antes de virar reclamação)
      rank: t.kind === "sentimento" ? 1 : 2,
      node: (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
          <div className="min-w-0">
            <p className={cn("font-semibold", (t.kind === "nps_baixo" || t.kind === "sentimento") && "text-alert")}>{t.title}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
              {t.contactId && t.contactName ? <PatientLink id={t.contactId} name={t.contactName} className="font-normal" /> : null}
              {t.assigneeName ? <span>com {t.assigneeName}</span> : null}
              {t.overdue ? <Badge tone="alert">atrasada desde {t.dueDate.slice(8, 10)}/{t.dueDate.slice(5, 7)}</Badge> : null}
            </p>
          </div>
          <ActionButton action={completeTaskAction} fields={{ id: t.id }} label="Concluir" pendingText="..." variant="secondary" />
        </div>
      ),
    });
  }

  /* 6. Retornos */
  if (data.returnsCount && data.features.campaigns) {
    items.push({
      key: "retornos",
      kind: "retorno",
      node: (
        <Link href="/crm/retornos" className="flex items-center justify-between gap-3 rounded-xl p-3 ring-1 ring-line hover:ring-crm">
          <span>
            <span className="block font-semibold">
              {data.returnsCount} {data.returnsCount === 1 ? "paciente está" : "pacientes estão"} na hora do retorno
            </span>
            <span className="text-sm text-ink-soft">Envie o lembrete em um clique no Radar de retornos.</span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-crm" aria-hidden />
        </Link>
      ),
    });
  }

  items.sort((a, b) => (a.rank ?? 2) - (b.rank ?? 2));
  const counts = items.reduce<Partial<Record<Kind, number>>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {});
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((k) => counts[k]);
  // Filtro escolhido sumiu (ex.: tarefa concluída): volta para "todos"
  const active = filter !== "todos" && !counts[filter] ? "todos" : filter;
  const visible = items.filter((i) => active === "todos" || i.kind === active);
  const limit = compact ? 5 : 8;
  const shown = expanded ? visible : visible.slice(0, limit);

  const icons: Record<Kind, ReactNode> = {
    urgencia: <AlertTriangle className="size-3.5" aria-hidden />,
    responder: <MessagesSquare className="size-3.5" aria-hidden />,
    risco: <ShieldAlert className="size-3.5" aria-hidden />,
    confirmar: <Send className="size-3.5" aria-hidden />,
    tarefa: <ListChecks className="size-3.5" aria-hidden />,
    retorno: <CalendarClock className="size-3.5" aria-hidden />,
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar a fila">
        <Chip on={active === "todos"} onClick={() => setFilter("todos")}>
          Tudo <span className="tabular opacity-70">{items.length}</span>
        </Chip>
        {kinds.map((k) => (
          <Chip key={k} on={active === k} onClick={() => setFilter(k)} alert={k === "urgencia"}>
            {icons[k]}
            {KIND_LABEL[k]} <span className="tabular opacity-70">{counts[k]}</span>
          </Chip>
        ))}
        {data.tasks.some((t) => t.assigneeId && t.assigneeId !== data.userId) || onlyMine ? (
          <label className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={onlyMine} onChange={(e) => onOnlyMine(e.target.checked)} className="size-4 accent-[var(--color-crm)]" />
            Só minhas tarefas
          </label>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 px-4 py-8 text-center">
          <p className="font-display text-lg font-bold">Tudo em dia</p>
          <p className="text-ink-soft">Nenhuma pendência agora. Novas mensagens aparecem aqui sozinhas.</p>
        </div>
      ) : (
        <ol className="space-y-2">
          {shown.map((i) => (
            <li key={i.key}>{i.node}</li>
          ))}
        </ol>
      )}
      {visible.length > limit ? (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 min-h-10 text-sm font-semibold text-crm hover:underline">
          {expanded ? "Mostrar menos" : `Mostrar mais ${visible.length - limit}`}
        </button>
      ) : null}
    </div>
  );
}

function Chip({ on, onClick, alert = false, children }: { on: boolean; onClick: () => void; alert?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1",
        on ? (alert ? "bg-alert text-white ring-alert" : "bg-ink text-white ring-ink") : alert ? "bg-alert-tint text-alert ring-alert/30" : "bg-paper text-ink-soft ring-line hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
