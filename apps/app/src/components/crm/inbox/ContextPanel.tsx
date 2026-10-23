"use client";

/**
 * PAINEL LATERAL DA CONVERSA (abas)
 *  Assistente -> intenção, respostas sugeridas, agenda e janela de 24h (contagem ao vivo)
 *  Paciente   -> contato, etapa, etiquetas, consentimento, consultas, outros canais
 *  Histórico  -> últimos acontecimentos da linha do tempo
 * A aba escolhida fica salva nas preferências.
 */
import { CHANNEL_LABEL } from "@ecosaude/core/crm";
import { Clock, Lock, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { PatientLink, ScheduleButton } from "@/components/crm/widgets";
import { Badge, StageBadge } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { formatPhone } from "@/modules/crm/format";
import { IntentBox } from "./IntentBox";
import { ProfileSuggestions } from "./ProfileSuggestions";
import { PromisesBox } from "./PromisesBox";
import { SentimentBox } from "./SentimentBox";
import { ScheduleFromChatButton } from "./ScheduleFromChat";
import { SuggestionChip } from "./ThreadControls";
import type { InboxPrefs, ThreadData } from "./types";

const TABS: { id: InboxPrefs["panelTab"]; label: string }[] = [
  { id: "assistente", label: "Assistente" },
  { id: "paciente", label: "Paciente" },
  { id: "historico", label: "Histórico" },
];

export function ContextPanel({
  thread,
  tab,
  onTab,
  nowMs,
  canReply,
  canSchedule,
}: {
  thread: ThreadData;
  tab: InboxPrefs["panelTab"];
  onTab: (t: InboxPrefs["panelTab"]) => void;
  nowMs: number;
  canReply: boolean;
  canSchedule: boolean;
}) {
  const c = thread.contact;
  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" aria-label="Painel da conversa" className="flex gap-1 border-b border-line px-3 pt-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`painel-${t.id}`}
            onClick={() => onTab(t.id)}
            className={cn("-mb-px min-h-10 border-b-2 px-3 text-sm font-semibold", tab === t.id ? "border-crm text-crm" : "border-transparent text-ink-soft hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id={`painel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {tab === "assistente" ? (
          <>
            <IntentBox thread={thread} canEdit={canReply} />
            <SentimentBox thread={thread} canEdit={canReply} />
            <PromisesBox thread={thread} canEdit={canReply} />

            {canReply && thread.status !== "resolvida" && thread.suggestions.length ? (
              <section>
                <h2 className="text-sm font-bold">Respostas sugeridas</h2>
                <p className="text-xs text-ink-soft">Clique para levar à caixa de texto e ajustar antes de enviar.</p>
                <div className="mt-2 space-y-2">
                  {thread.suggestions.map((s) => (
                    <SuggestionChip key={s} text={s} />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-xl bg-fog p-3">
              <h2 className="text-sm font-bold">Agenda</h2>
              {thread.next ? (
                <p className="mt-1 text-sm">
                  Próxima consulta: <strong>{thread.next.label}</strong> com {thread.next.professional} ({thread.next.status}).
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">Sem consulta marcada.</p>
              )}
              {thread.slots.length && thread.suggestionPro ? (
                <p className="mt-2 text-xs text-ink-soft">
                  Livres com {thread.suggestionPro}: {thread.slots.join("; ")}
                </p>
              ) : null}
              {canSchedule ? (
                <div className="mt-3 space-y-1 text-center">
                  {/* Lê dia, período, profissional e procedimento da conversa e abre o agendamento preenchido */}
                  <ScheduleFromChatButton variant="primary" conversationId={thread.id} contactId={c.id} contactName={c.name} />
                  <ScheduleButton contactId={c.id} contactName={c.name} conversationId={thread.id} label="Escolher do zero" variant="ghost" className="w-full" />
                </div>
              ) : null}
            </section>

            <WindowCard thread={thread} nowMs={nowMs} />
          </>
        ) : null}

        {tab === "paciente" ? (
          <>
            <section className="space-y-2">
              <PatientLink id={c.id} name={c.name} className="text-lg" />
              <div className="flex flex-wrap items-center gap-1.5">
                <StageBadge stage={c.stage} />
                {c.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
              <dl className="space-y-1.5 text-sm">
                <Row icon={<Phone className="size-4" aria-hidden />} label="Celular">
                  {c.phone ? (
                    <a href={`tel:+${c.phone}`} className="font-semibold hover:underline">
                      {formatPhone(c.phone)}
                    </a>
                  ) : (
                    "não informado"
                  )}
                </Row>
                <Row icon={<Mail className="size-4" aria-hidden />} label="E-mail">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="break-all font-semibold hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    "não informado"
                  )}
                </Row>
              </dl>
            </section>

            <dl className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Compareceu" value={thread.stats.compareceu} />
              <Stat label="Faltou" value={thread.stats.faltou} tone={thread.stats.faltou ? "alert" : undefined} />
              <Stat label="Cancelou" value={thread.stats.cancelado} />
            </dl>

            <dl className="space-y-1 text-sm">
              <Line label="Contato desde">{c.since}</Line>
              <Line label="Última consulta">{c.lastVisit ?? "nenhuma"}</Line>
              <Line label="Origem">{c.source ?? "não informada"}</Line>
              <Line label="Convênio">{c.insurance ?? "não informado"}</Line>
              {c.referredBy ? <Line label="Indicação">{c.referredBy}</Line> : null}
              {thread.bestTime ? <Line label="Costuma responder">{thread.bestTime}</Line> : null}
              <Line label="Mensagens de relacionamento">{c.optedOut ? "pediu para não receber (SAIR)" : c.consentMarketing ? "autorizadas (LGPD)" : "sem autorização"}</Line>
            </dl>

            <ProfileSuggestions thread={thread} canEdit={canReply} />

            {thread.otherChannels.length ? (
              <section>
                <h2 className="text-sm font-bold">Também fala pelo</h2>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {thread.otherChannels.map((o) => (
                    <li key={o.id}>
                      <Link href={`/crm/conversas/${o.id}`} className="inline-flex min-h-9 items-center rounded-full bg-fog px-3 text-sm font-semibold text-crm ring-1 ring-line hover:ring-crm">
                        {CHANNEL_LABEL[o.channel]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {c.optedOut ? <p className="rounded-xl bg-alert-tint p-3 text-sm font-semibold text-alert">Este paciente pediu para não receber lembretes e campanhas.</p> : null}
          </>
        ) : null}

        {tab === "historico" ? (
          thread.events.length ? (
            <ol className="relative space-y-3 border-l-2 border-line pl-4">
              {thread.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full bg-crm ring-4 ring-paper" aria-hidden />
                  <p className="text-sm">{e.text}</p>
                  <p className="text-xs text-ink-soft first-letter:uppercase">{e.when}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-soft">Nada registrado ainda.</p>
          )
        ) : null}
      </div>
    </div>
  );
}

/** Janela de 24h da Meta, com contagem regressiva e barra de tempo restante */
export function WindowCard({ thread, nowMs }: { thread: ThreadData; nowMs: number }) {
  const w = thread.window;
  const left = w.closesAtMs ? Math.max(0, w.closesAtMs - nowMs) : 0;
  const open = w.unlimited || left > 0;
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return (
    <section className={cn("rounded-xl p-3 text-sm", open ? "bg-ok-tint text-ok-ink" : "bg-erp-tint text-erp-ink")}>
      <h2 className="flex items-center gap-1 font-bold">
        {open ? <Clock className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
        Janela do {CHANNEL_LABEL[thread.channel]}
      </h2>
      <p className="mt-1">
        {w.unlimited
          ? "Este canal não limita o horário das respostas."
          : open
            ? `Aberta por mais ${h ? `${h} h ` : ""}${m} min (até ${w.closesLabel}).`
            : "Fechada: só modelos aprovados até o paciente escrever de novo."}
      </p>
      {!w.unlimited && open ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper/70" role="img" aria-label={`${Math.round((left / 86_400_000) * 100)}% da janela restante`}>
          <span className={cn("block h-full", left < 2 * 3_600_000 ? "bg-erp" : "bg-ok")} style={{ width: `${Math.min(100, (left / 86_400_000) * 100)}%` }} />
        </div>
      ) : null}
      {open && !w.unlimited && left < 2 * 3_600_000 ? <p className="mt-1 text-xs font-semibold">Fecha em breve: responda agora para não depender de modelo aprovado.</p> : null}
    </section>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="flex items-center gap-1.5 text-ink-soft">
        {icon}
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "alert" }) {
  return (
    <div className="rounded-xl bg-fog px-2 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={cn("font-display text-xl font-bold tabular", tone === "alert" && "text-alert")}>{value}</dd>
    </div>
  );
}
