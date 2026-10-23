"use client";

/**
 * LISTA DE ESPERA (parte interativa)
 *
 *  - Números: na fila, espera média, taxa de preenchimento e tempo até aceitar (30 dias)
 *  - ENCAIXES: horários livres dos próximos 7 dias que já têm alguém compatível
 *    na fila; "Oferecer" envia a até 3 pessoas (quem disser SIM primeiro fica)
 *  - Fila com busca e filtros (profissional, período, situação), visão em fila
 *    única ou por profissional; alertas de espera longa, ofertas recusadas e
 *    de quem já tem consulta marcada
 *  - Ofertas abertas com contagem regressiva e histórico
 *
 * Preferências (visão, densidade, aba de ofertas) ficam no navegador.
 */
import { WAITLIST_PERIOD_LABEL, type WaitlistPeriod } from "@ecosaude/core/crm";
import { CalendarCheck2, CheckCircle2, CircleDashed, Clock, Columns3, Hourglass, List, MessagesSquare, Search, Send, Sparkles, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { OfferPanel } from "@/components/crm/agenda/OfferPanel";
import { ActionButton, AutoRefresh, PatientLink, ScheduleButton } from "@/components/crm/widgets";
import { AddToWaitlist, OfferFreeSlot } from "@/components/crm/WaitlistTools";
import { Dialog } from "@/components/ui";
import { Badge, colorOf, initials, PageHeader } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { useLiveNow } from "@/lib/hooks";
import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { cancelOfferAction, removeFromWaitlistAction } from "@/modules/crm/actions/agenda";
import { DEFAULT_WAITLIST_PREFS, LONG_WAIT_DAYS, type Opportunity, type WaitEntry, type WaitlistData } from "./types";

type StatusFilter = "todos" | "aguardando" | "oferecido" | "com_consulta";
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "45 min", "2 h 10" */
function countdown(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60}` : `${h} h`;
}

export function WaitlistBoard({ data }: { data: WaitlistData }) {
  const [prefs, update] = useStoredPrefs("eco:espera:prefs:v1", DEFAULT_WAITLIST_PREFS);
  const nowMs = useLiveNow(data.serverNowMs, 30_000);
  const [q, setQ] = useState("");
  const [pro, setPro] = useState<string>("");
  const [period, setPeriod] = useState<WaitlistPeriod | "">("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [offering, setOffering] = useState<Opportunity | null>(null);
  const [otherSlot, setOtherSlot] = useState(false);
  const compact = prefs.density === "compacta";

  const term = plain(q.trim());
  const entries = data.entries.filter(
    (e) =>
      (!term || plain(e.contactName).includes(term) || plain(e.notes ?? "").includes(term)) &&
      (!pro || (pro === "-" ? e.professionalId === null : e.professionalId === pro)) &&
      (!period || e.period === period) &&
      (status === "todos" || (status === "com_consulta" ? !!e.nextAppointment : e.status === status)),
  );
  const withAppointment = data.entries.filter((e) => e.nextAppointment).length;
  const st = data.stats;
  const fillRate = st.closed30 ? Math.round((st.filled30 / st.closed30) * 100) : null;
  const openOffers = data.offers.filter((o) => o.status === "aberta");
  const history = data.offers.filter((o) => o.status !== "aberta");
  const proOptions = data.professionals.map((p) => ({ id: p.id, name: p.name, slotMinutes: p.slotMinutes }));

  // Encaixes agrupados por profissional e dia (um cartão por dia, horários como botões)
  const groups: { key: string; dayLabel: string; professionalName: string; color: string; slots: Opportunity[]; people: { id: string; name: string }[] }[] = [];
  for (const o of [...data.opportunities].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = `${o.date}-${o.professionalId}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, dayLabel: o.dayLabel, professionalName: o.professionalName, color: o.professionalColor, slots: [], people: [] };
      groups.push(g);
    }
    g.slots.push(o);
    for (const m of o.matches) if (!g.people.some((p) => p.id === m.id)) g.people.push(m);
  }

  const entryCard = (e: WaitEntry) => <EntryCard key={e.id} e={e} nowMs={nowMs} compact={compact} canEdit={data.canEdit} professionals={proOptions} units={data.units} />;

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Lista de espera"
        description="Quem quer um horário antes. Ofereça a até 3 pessoas por vez: quem responder SIM primeiro fica com a vaga, sem a recepção ligar para ninguém."
        actions={
          data.canEdit ? (
            <>
              <button type="button" onClick={() => setOtherSlot(true)} className={buttonStyles("secondary")}>
                <Send className="size-4" aria-hidden /> Oferecer um horário
              </button>
              <AddToWaitlist professionals={proOptions} units={data.units} />
            </>
          ) : null
        }
      />

      {/* --------------------------------- Números --------------------------------- */}
      <dl className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi icon={<Hourglass className="size-4" aria-hidden />} label="Na fila" value={String(st.waiting + st.offered)} hint={st.offered ? `${st.offered} com oferta enviada agora` : "ninguém com oferta pendente"} />
        <Kpi icon={<Clock className="size-4" aria-hidden />} label="Espera média" value={`${st.avgDays} ${st.avgDays === 1 ? "dia" : "dias"}`} hint="desde que entrou na lista" />
        <Kpi icon={<CheckCircle2 className="size-4" aria-hidden />} label="Ofertas preenchidas" value={fillRate === null ? "sem dados" : `${fillRate}%`} hint={`${st.filled30} de ${st.closed30} nos últimos 30 dias`} />
        <Kpi
          icon={<Send className="size-4" aria-hidden />}
          label="Tempo até aceitar"
          value={st.avgAcceptMin === null ? "sem dados" : st.avgAcceptMin < 60 ? `${st.avgAcceptMin} min` : countdown(st.avgAcceptMin * 60_000)}
          hint="média entre a oferta e o SIM"
        />
      </dl>

      {/* --------------------------------- Encaixes --------------------------------- */}
      <section aria-labelledby="encaixes-t" className="mb-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="encaixes-t" className="flex items-center gap-2 text-lg font-bold">
              <Sparkles className="size-5 text-crm" aria-hidden /> Encaixes possíveis
            </h2>
            <p className="text-sm text-ink-soft">Horários livres dos próximos 7 dias que já têm alguém da fila compatível.</p>
          </div>
        </div>
        {data.opportunities.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink/20 px-4 py-6 text-center text-ink-soft">
            {data.entries.length ? "Nenhum horário livre combina com a fila nos próximos 7 dias." : "Quando houver gente na fila, os horários compatíveis aparecem aqui."}
          </p>
        ) : (
          <ul className="thin-scroll -mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
            {groups.map((g) => (
              <li key={g.key} className="w-64 shrink-0 snap-start">
                <div className={cn("flex h-full flex-col rounded-2xl border-l-4 bg-paper p-3 ring-1 ring-line", colorOf(g.color).border)}>
                  <p className="font-display text-lg font-bold first-letter:uppercase">{g.dayLabel}</p>
                  <p className="text-sm text-ink-soft">{g.professionalName}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex -space-x-2" aria-hidden>
                      {g.people.slice(0, 3).map((m) => (
                        <span key={m.id} className="flex size-8 items-center justify-center rounded-full bg-crm-tint text-[0.65rem] font-bold text-crm ring-2 ring-paper">
                          {initials(m.name)}
                        </span>
                      ))}
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold" title={g.people.map((m) => m.name).join(", ")}>
                      {g.people.map((m) => m.name.split(" ")[0]).join(", ")}
                    </span>
                  </div>
                  <p className="mt-2 mb-1 text-xs text-ink-soft">{data.canEdit ? "Escolha o horário para oferecer:" : "Horários livres:"}</p>
                  <ul className="mt-auto flex flex-wrap gap-1.5">
                    {g.slots.slice(0, 8).map((o) => (
                      <li key={o.startsAt}>
                        {data.canEdit ? (
                          <button
                            type="button"
                            onClick={() => setOffering(o)}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-crm px-2.5 text-sm font-semibold text-white tabular hover:bg-crm/90"
                            aria-label={`Oferecer ${o.label} com ${o.professionalName} (${o.matches.length} ${o.matches.length === 1 ? "combina" : "combinam"})`}
                            title={`Combina com: ${o.matches.map((m) => m.name).join(", ")}`}
                          >
                            {o.time}
                          </button>
                        ) : (
                          <span className="inline-flex min-h-9 items-center rounded-lg bg-fog px-2.5 text-sm font-semibold tabular">{o.time}</span>
                        )}
                      </li>
                    ))}
                    {g.slots.length > 8 ? <li className="self-center text-xs text-ink-soft">+{g.slots.length - 8}</li> : null}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        {/* ----------------------------------- Fila ----------------------------------- */}
        <section aria-labelledby="fila-t" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="fila-t" className="mr-auto text-lg font-bold">
              Fila <span className="tabular text-ink-soft">({data.entries.length})</span>
            </h2>
            <div role="group" aria-label="Visão" className="flex rounded-xl bg-paper p-1 ring-1 ring-line">
              {(["fila", "profissional"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={prefs.view === v}
                  onClick={() => update({ view: v })}
                  className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", prefs.view === v ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
                >
                  {v === "fila" ? <List className="size-4" aria-hidden /> : <Columns3 className="size-4" aria-hidden />}
                  {v === "fila" ? "Fila única" : "Por profissional"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => update({ density: compact ? "confortavel" : "compacta" })}
              aria-pressed={compact}
              className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm font-semibold ring-1 ring-line hover:ring-crm"
            >
              {compact ? "Confortável" : "Compacta"}
            </button>
          </div>

          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
                <label htmlFor="espera-q" className="sr-only">
                  Buscar na fila
                </label>
                <input
                  id="espera-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar nome ou observação"
                  className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
                />
              </div>
              <select aria-label="Profissional" value={pro} onChange={(e) => setPro(e.target.value)} className="min-h-10 max-w-56 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
                <option value="">Todos os profissionais</option>
                <option value="-">Qualquer profissional</option>
                {data.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={period === ""} onClick={() => setPeriod("")}>
                Qualquer período
              </Chip>
              {(Object.keys(WAITLIST_PERIOD_LABEL) as WaitlistPeriod[])
                .filter((p) => p !== "qualquer")
                .map((p) => (
                  <Chip key={p} on={period === p} onClick={() => setPeriod(period === p ? "" : p)}>
                    {WAITLIST_PERIOD_LABEL[p]}
                  </Chip>
                ))}
              <span className="mx-1 w-px self-stretch bg-line" aria-hidden />
              <Chip on={status === "todos"} onClick={() => setStatus("todos")}>
                Todos
              </Chip>
              <Chip on={status === "aguardando"} onClick={() => setStatus("aguardando")}>
                Aguardando
              </Chip>
              <Chip on={status === "oferecido"} onClick={() => setStatus("oferecido")}>
                Oferta enviada
              </Chip>
              {withAppointment ? (
                <Chip on={status === "com_consulta"} onClick={() => setStatus("com_consulta")}>
                  Já têm consulta ({withAppointment})
                </Chip>
              ) : null}
            </div>
          </div>

          {data.entries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/20 px-4 py-10 text-center">
              <p className="font-display text-lg font-bold">Ninguém na lista</p>
              <p className="mx-auto mt-1 max-w-md text-ink-soft">Use “Adicionar à lista” quando alguém pedir um horário que ainda não existe.</p>
            </div>
          ) : entries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">Ninguém com estes filtros.</p>
          ) : prefs.view === "fila" ? (
            <ol className="space-y-2">{entries.map(entryCard)}</ol>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {[{ id: null as string | null, name: "Qualquer profissional", color: "crm" }, ...data.professionals].map((p) => {
                const list = entries.filter((e) => e.professionalId === p.id);
                if (list.length === 0) return null;
                return (
                  <section key={p.id ?? "qualquer"} aria-label={p.name} className={cn("rounded-2xl border-t-4 bg-ink/[0.04] p-2", colorOf(p.color).border)}>
                    <h3 className="flex items-center justify-between px-1.5 pt-1 pb-2 text-sm font-bold">
                      {p.name}
                      <span className="rounded-full bg-paper px-2 tabular ring-1 ring-line">{list.length}</span>
                    </h3>
                    <ol className="space-y-2">{list.map(entryCard)}</ol>
                  </section>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------------------------------- Ofertas ---------------------------------- */}
        <section aria-labelledby="ofertas-t" className="min-w-0 self-start rounded-2xl bg-paper p-4 ring-1 ring-line">
          <h2 id="ofertas-t" className="text-lg font-bold">
            Ofertas
          </h2>
          <div role="tablist" aria-label="Ofertas" className="mt-2 mb-3 flex gap-1 border-b border-line">
            {(["abertas", "historico"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={prefs.offersTab === t}
                onClick={() => update({ offersTab: t })}
                className={cn("-mb-px min-h-10 border-b-2 px-3 text-sm font-semibold", prefs.offersTab === t ? "border-crm text-crm" : "border-transparent text-ink-soft hover:text-ink")}
              >
                {t === "abertas" ? `Abertas (${openOffers.length})` : "Histórico"}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {(prefs.offersTab === "abertas" ? openOffers : history).length === 0 ? (
              <p className="text-sm text-ink-soft">{prefs.offersTab === "abertas" ? "Nenhuma oferta esperando resposta." : "Nenhuma oferta encerrada ainda."}</p>
            ) : (
              <ul className="space-y-3">
                {(prefs.offersTab === "abertas" ? openOffers : history).map((o) => (
                  <li key={o.id} className="rounded-xl bg-fog p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold first-letter:uppercase">{o.label}</p>
                        <p className="text-xs text-ink-soft">
                          {o.professional}, enviada {o.createdLabel}
                        </p>
                      </div>
                      <OfferBadge o={o} nowMs={nowMs} />
                    </div>
                    <ul className="mt-2 space-y-1">
                      {o.candidates.map((c) => (
                        <li key={c.name} className="flex items-center gap-1.5">
                          <OutcomeIcon outcome={c.outcome} />
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <span className="text-xs text-ink-soft">{outcomeLabel[c.outcome] ?? c.outcome}</span>
                        </li>
                      ))}
                    </ul>
                    {o.status === "aberta" && data.canEdit ? (
                      <div className="mt-2">
                        <ActionButton action={cancelOfferAction} fields={{ offerId: o.id }} label="Cancelar oferta" variant="ghost" pendingText="..." confirmText="Cancelar esta oferta? Quem ainda não respondeu volta para a fila." />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Oferecer um encaixe */}
      <Dialog open={!!offering} onClose={() => setOffering(null)} title="Oferecer encaixe" description={offering ? `${offering.label} com ${offering.professionalName}` : undefined}>
        {offering ? (
          <OfferPanel
            key={`${offering.professionalId}-${offering.startsAt}`}
            title="Quem recebe a oferta"
            slot={{ professionalId: offering.professionalId, startsAt: offering.startsAt, endsAt: offering.endsAt, label: `Horário ${offering.label} com ${offering.professionalName}` }}
          />
        ) : null}
      </Dialog>

      {/* Escolher outro horário qualquer */}
      <Dialog open={otherSlot} onClose={() => setOtherSlot(false)} title="Oferecer um horário" description="Escolha um horário livre e veja quem da lista combina.">
        {otherSlot && proOptions.length ? <OfferFreeSlot professionals={proOptions} /> : <p className="text-sm text-ink-soft">Nenhum profissional ativo.</p>}
      </Dialog>
    </>
  );
}

/* ----------------------------------- Peças ----------------------------------- */

const outcomeLabel: Record<string, string> = { enviada: "aguardando resposta", aceitou: "aceitou", recusou: "recusou", atrasado: "respondeu depois" };

function OutcomeIcon({ outcome }: { outcome: string }) {
  if (outcome === "aceitou") return <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />;
  if (outcome === "recusou") return <XCircle className="size-4 shrink-0 text-alert" aria-hidden />;
  return <CircleDashed className="size-4 shrink-0 text-ink-soft" aria-hidden />;
}

function OfferBadge({ o, nowMs }: { o: WaitlistData["offers"][number]; nowMs: number }) {
  if (o.status === "aberta") return <Badge tone="warning">expira em {countdown(o.expiresMs - nowMs)}</Badge>;
  if (o.status === "preenchida") return <Badge tone="success">Preenchida{o.filledBy ? ` por ${o.filledBy.split(" ")[0]}` : ""}</Badge>;
  return <Badge>{o.status === "expirada" ? "Expirou" : "Cancelada"}</Badge>;
}

function Kpi({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-paper p-3 ring-1 ring-line sm:p-4">
      <dt className="flex items-center gap-1.5 text-sm text-ink-soft">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 font-display text-2xl font-bold tabular sm:text-3xl">{value}</dd>
      <dd className="text-xs text-ink-soft">{hint}</dd>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold ring-1", on ? "bg-ink text-white ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink")}
    >
      {children}
    </button>
  );
}

function EntryCard({
  e,
  nowMs,
  compact,
  canEdit,
  professionals,
  units,
}: {
  e: WaitEntry;
  nowMs: number;
  compact: boolean;
  canEdit: boolean;
  professionals: { id: string; name: string; slotMinutes: number }[];
  units: { id: string; name: string }[];
}) {
  const long = e.waitingDays >= LONG_WAIT_DAYS;
  return (
    <li className={cn("rounded-2xl bg-paper ring-1 ring-line", compact ? "p-2.5" : "p-3.5", e.openOffer && "ring-2 ring-erp")}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn("grid shrink-0 place-items-center rounded-full font-bold tabular", compact ? "size-7 text-xs" : "size-9 text-sm", e.position <= 3 ? "bg-crm text-white" : "bg-fog")} title={`${e.position}º da fila`}>
          {e.position}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PatientLink id={e.contactId} name={e.contactName} />
            {e.status === "oferecido" ? <Badge tone="warning">Oferta enviada</Badge> : null}
            {e.declined ? <Badge tone="alert">recusou {e.declined}</Badge> : null}
            {e.optedOut ? <Badge>pediu SAIR</Badge> : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-soft">
            <span>
              {e.professionalName ?? "Qualquer profissional"}, {WAITLIST_PERIOD_LABEL[e.period].toLowerCase()}
              {e.unitName ? `, ${e.unitName}` : ""}
            </span>
            <span className={cn("inline-flex items-center gap-1", long && "font-bold text-erp-ink")}>
              <Hourglass className="size-3.5" aria-hidden />
              {e.waitingDays === 0 ? "entrou hoje" : `${e.waitingDays} ${e.waitingDays === 1 ? "dia" : "dias"} na fila`}
            </span>
          </p>
          {!compact && e.notes ? <p className="mt-1 text-sm">“{e.notes}”</p> : null}
          {e.openOffer ? (
            <p className="mt-1.5 rounded-lg bg-erp-tint px-2.5 py-1.5 text-sm text-erp-ink">
              Oferta de <strong>{e.openOffer.label}</strong>, expira em {countdown(e.openOffer.expiresMs - nowMs)}.
            </p>
          ) : null}
          {e.nextAppointment ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ok-ink">
              <CalendarCheck2 className="size-4 shrink-0" aria-hidden /> Já tem consulta {e.nextAppointment}. Se só queria antecipar, mantenha; senão, remova da lista.
            </p>
          ) : null}
          {e.optedOut && !compact ? <p className="mt-1 text-xs text-ink-soft">Não recebe ofertas automáticas: ligue ou ofereça pela conversa.</p> : null}
        </div>
        {canEdit ? (
          <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
            {e.conversationId ? (
              <Link href={`/crm/conversas/${e.conversationId}`} className="inline-flex size-10 items-center justify-center rounded-xl text-ink-soft hover:bg-fog hover:text-crm" aria-label={`Abrir conversa com ${e.contactName}`} title="Abrir conversa">
                <MessagesSquare className="size-4" aria-hidden />
              </Link>
            ) : null}
            <ScheduleButton contactId={e.contactId} contactName={e.contactName} variant="secondary" label="Agendar" />
            <AddToWaitlist professionals={professionals} contact={{ id: e.contactId, name: e.contactName }} entry={{ professionalId: e.professionalId, period: e.period, notes: e.notes, unitId: e.unitId }} units={units} />
            <ActionButton action={removeFromWaitlistAction} fields={{ id: e.id }} label="Remover" variant="ghost" pendingText="..." confirmText={`Tirar ${e.contactName} da lista de espera?`} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
