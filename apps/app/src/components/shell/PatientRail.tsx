"use client";

import {
  CHANNEL_LABEL,
  JOURNEY_STAGE_LABEL,
  RISK_LABEL,
  type Channel,
  type JourneyStage,
  type NoShowRisk,
} from "@ecosaude/core/crm";
import { CalendarPlus, ExternalLink, Pin, PinOff, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { StartConversation } from "@/components/crm/StartConversation";
import { ago, channelOptions, formatPhone } from "@/modules/crm/format";
import { useRail } from "./AppShell";

/**
 * TRILHO DO PACIENTE
 * Painel de contexto que abre ao clicar em qualquer paciente (conversa, agenda,
 * jornada...). Com o alfinete, ele fica FIXO enquanto a pessoa navega:
 * dá para sair da conversa, olhar a agenda e marcar sem perder o paciente de vista.
 */
interface Summary {
  id: string;
  name: string;
  stage: JourneyStage;
  phone: string | null;
  email: string | null;
  tags: string[];
  owner: string | null;
  optedOut: boolean;
  consent: boolean;
  preferredChannel: Channel | null;
  lastVisit: string | null;
  channels: { channel: Channel; externalId: string }[];
  conversations: { id: string; channel: Channel; unread: number }[];
  next: { when: string; professional: string; status: string; risk: NoShowRisk | null } | null;
  stats: { attended: number; noShows: number };
  tasks: { id: string; title: string; dueDate: string }[];
  events: { id: string; text: string; at: string }[];
  onWaitlist: boolean;
}

const riskClass = { baixo: "bg-ok-tint text-ok-ink", medio: "bg-erp-tint text-erp-ink", alto: "bg-alert-tint text-alert" };

export function PatientRail() {
  const rail = useRail();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!rail.contactId) return;
    let cancelled = false;
    fetch(`/api/contatos/${rail.contactId}/resumo`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Summary) => {
        if (!cancelled) {
          setData(d);
          setError(false);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [rail.contactId]);

  if (!rail.contactId) return null;
  const loaded = data?.id === rail.contactId ? data : null;

  return (
    <>
      {/* Fundo escurecido só no celular / quando não fixado */}
      {!rail.pinned ? <button type="button" aria-label="Fechar painel do paciente" className="fixed inset-0 z-40 bg-ink/30 lg:bg-transparent" onClick={rail.close} /> : null}
      <aside
        aria-label="Paciente"
        className={cn(
          "fixed z-50 flex flex-col bg-paper shadow-2xl ring-1 ring-line",
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl",
          "lg:inset-x-auto lg:top-0 lg:right-0 lg:bottom-0 lg:max-h-none lg:w-[23rem] lg:rounded-none",
        )}
      >
        <header className="flex items-start gap-2 border-b border-line p-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-crm">Trilho do paciente</p>
            <h2 className="truncate text-xl font-bold">{loaded?.name ?? (error ? "Não foi possível carregar" : "Carregando...")}</h2>
            {loaded ? (
              <p className="text-sm text-ink-soft">
                {JOURNEY_STAGE_LABEL[loaded.stage]}
                {loaded.owner ? `, com ${loaded.owner}` : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={rail.togglePin}
            aria-pressed={rail.pinned}
            aria-label={rail.pinned ? "Soltar painel" : "Fixar painel enquanto navega"}
            title={rail.pinned ? "Soltar" : "Fixar enquanto navega"}
            className={cn("hidden size-10 items-center justify-center rounded-xl lg:inline-flex", rail.pinned ? "bg-crm text-white" : "text-ink-soft hover:bg-ink/5")}
          >
            {rail.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
          </button>
          <button type="button" onClick={rail.close} aria-label="Fechar" className="inline-flex size-10 items-center justify-center rounded-xl text-ink-soft hover:bg-ink/5">
            <X className="size-5" aria-hidden />
          </button>
        </header>

        {loaded ? (
          <div className="thin-scroll flex-1 space-y-5 overflow-y-auto p-4">
            {/* Ações rápidas */}
            <div className="grid grid-cols-3 gap-2">
              <Link href={`/crm/contatos/${loaded.id}`} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-fog text-xs font-semibold hover:bg-crm-tint">
                <ExternalLink className="size-4" aria-hidden /> Ficha
              </Link>
              <StartConversation
                compact
                contactId={loaded.id}
                optedOut={loaded.optedOut}
                options={channelOptions({ conversations: loaded.conversations, identities: loaded.channels, phone: loaded.phone })}
              />
              <button
                type="button"
                onClick={() => emit("eco:open-schedule", { contactId: loaded.id, contactName: loaded.name, conversationId: loaded.conversations[0]?.id })}
                className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-crm text-xs font-semibold text-white hover:bg-crm-strong"
              >
                <CalendarPlus className="size-4" aria-hidden /> Agendar
              </button>
            </div>

            {/* Próxima consulta com risco de falta */}
            <section>
              <h3 className="text-sm font-bold">Próxima consulta</h3>
              {loaded.next ? (
                <div className="mt-1.5 rounded-xl bg-fog p-3 text-sm">
                  <p className="font-semibold">{loaded.next.when}</p>
                  <p className="text-ink-soft">
                    {loaded.next.professional}, {loaded.next.status === "confirmado" ? "confirmada" : "aguardando confirmação"}
                  </p>
                  {loaded.next.risk ? (
                    <div className="mt-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", riskClass[loaded.next.risk.level])}>{RISK_LABEL[loaded.next.risk.level]}</span>
                      <ul className="mt-1.5 list-disc pl-4 text-xs text-ink-soft">
                        {loaded.next.risk.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      {loaded.next.risk.suggestion ? <p className="mt-1 text-xs font-semibold">{loaded.next.risk.suggestion}</p> : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">Nenhuma marcada{loaded.onWaitlist ? ", está na lista de espera" : ""}.</p>
              )}
            </section>

            {/* Relação com a clínica */}
            <section className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-fog p-2">
                <p className="font-display text-xl font-bold tabular">{loaded.stats.attended}</p>
                <p className="text-xs text-ink-soft">consultas</p>
              </div>
              <div className="rounded-xl bg-fog p-2">
                <p className={cn("font-display text-xl font-bold tabular", loaded.stats.noShows ? "text-alert" : "")}>{loaded.stats.noShows}</p>
                <p className="text-xs text-ink-soft">faltas</p>
              </div>
              <div className="rounded-xl bg-fog p-2">
                <p className="text-sm font-bold">{loaded.lastVisit ?? "—"}</p>
                <p className="text-xs text-ink-soft">última visita</p>
              </div>
            </section>

            {/* Contato e consentimento */}
            <section className="text-sm">
              <h3 className="font-bold">Contato</h3>
              <dl className="mt-1.5 space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Telefone</dt>
                  <dd>{formatPhone(loaded.phone)}</dd>
                </div>
                {loaded.channels.map((c) => (
                  <div key={c.channel} className="flex justify-between gap-2">
                    <dt className="text-ink-soft">{CHANNEL_LABEL[c.channel]}</dt>
                    <dd className="truncate">
                      {c.externalId}
                      {loaded.preferredChannel === c.channel ? " (preferido)" : ""}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className={cn("mt-2 rounded-lg px-2 py-1 text-xs font-semibold", loaded.optedOut ? "bg-alert-tint text-alert" : loaded.consent ? "bg-ok-tint text-ok-ink" : "bg-fog text-ink-soft")}>
                {loaded.optedOut ? "Pediu para não receber mensagens" : loaded.consent ? "Autorizou mensagens de relacionamento" : "Sem consentimento para campanhas"}
              </p>
              {loaded.tags.length ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {loaded.tags.map((t) => (
                    <li key={t} className="rounded-full bg-fog px-2 py-0.5 text-xs ring-1 ring-line">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {loaded.tasks.length ? (
              <section>
                <h3 className="text-sm font-bold">Tarefas abertas</h3>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {loaded.tasks.map((t) => (
                    <li key={t.id} className="rounded-lg bg-erp-tint px-2 py-1 text-erp-ink">
                      {t.title}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h3 className="text-sm font-bold">Últimos acontecimentos</h3>
              <ol className="mt-1.5 space-y-2 text-sm">
                {loaded.events.length === 0 ? <li className="text-ink-soft">Nada registrado ainda.</li> : null}
                {loaded.events.map((e) => (
                  <li key={e.id}>
                    <p>{e.text}</p>
                    <p className="text-xs text-ink-soft">{ago(new Date(e.at))}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        ) : (
          <div className="p-4 text-sm text-ink-soft">{error ? "Tente novamente em instantes." : "Buscando dados do paciente..."}</div>
        )}
      </aside>
    </>
  );
}
