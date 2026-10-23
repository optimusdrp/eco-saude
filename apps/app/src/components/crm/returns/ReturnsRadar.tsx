"use client";

/**
 * RADAR DE RETORNOS (parte interativa)
 *
 *  - Faixa do radar: atrasados há mais de 30 dias, atrasados, vencem nesta
 *    semana e depois (clique filtra) + janela de 7/14/30/60 dias
 *  - "No radar": filtros (protocolo, busca, quem pode receber), ordem,
 *    seleção com PRÉVIA da mensagem antes de enviar em lote
 *  - "Acompanhar": quem já foi lembrado e ainda não agendou (respondeu ou
 *    não), com atalhos para conversar, agendar ou criar tarefa de ligação
 *  - Protocolos com resultado (lembretes x quem voltou a agendar)
 *
 * Preferências (aba, ordem, mostrar bloqueados) ficam no navegador.
 */
import { fillTemplate } from "@ecosaude/core/crm";
import { Eye, MessageCircle, MessagesSquare, Phone, Radar, Search, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { ProtocolButton } from "@/components/crm/ReturnsTools";
import { ActionButton, PatientLink } from "@/components/crm/widgets";
import { Dialog, FormMessage, SubmitButton } from "@/components/ui";
import { Badge, PageHeader } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { createTaskAction, sendReturnRemindersAction } from "@/modules/crm/actions/contacts";
import { DEFAULT_RETURNS_PREFS, WINDOWS, type RadarRow, type ReturnsData } from "./types";

type Bucket = "muito" | "atrasado" | "semana" | "depois";
const BUCKETS: { id: Bucket; label: string; tone: string; test: (d: number) => boolean }[] = [
  { id: "muito", label: "Atrasados há mais de 30 dias", tone: "bg-alert", test: (d) => d > 30 },
  { id: "atrasado", label: "Atrasados", tone: "bg-erp", test: (d) => d > 0 && d <= 30 },
  { id: "semana", label: "Vencem nesta semana", tone: "bg-crm", test: (d) => d <= 0 && d > -7 },
  { id: "depois", label: "Vencem depois", tone: "bg-bi", test: (d) => d <= -7 },
];
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ReturnsRadar({ data }: { data: ReturnsData }) {
  const router = useRouter();
  const [prefs, update] = useStoredPrefs("eco:retornos:prefs:v1", DEFAULT_RETURNS_PREFS);
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [protocol, setProtocol] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState(false);

  /* -------------------------------- Seleção -------------------------------- */
  const eligible = data.rows.filter((r) => !r.blocked);
  // Começa com os atrasados que podem receber (como antes)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(eligible.filter((r) => r.overdueDays >= 0).map((r) => r.key)));
  const [state, action] = useActionState(sendReturnRemindersAction, {});
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) {
      setPicked(new Set());
      setPreview(false);
    }
  }
  const refresh = useEffectEvent(() => router.refresh());
  useEffect(() => {
    if (state.ok) refresh();
  }, [state]);

  const term = plain(q.trim());
  const visible = data.rows
    .filter(
      (r) =>
        (prefs.showBlocked || !r.blocked) &&
        (!bucket || BUCKETS.find((b) => b.id === bucket)!.test(r.overdueDays)) &&
        (!protocol || r.protocolId === protocol) &&
        (!term || plain(r.name).includes(term)),
    )
    .sort((a, b) => (prefs.sort === "nome" ? a.name.localeCompare(b.name, "pt-BR") : prefs.sort === "vencimento" ? a.overdueDays - b.overdueDays : b.overdueDays - a.overdueDays));
  const pickedRows = data.rows.filter((r) => picked.has(r.key) && !r.blocked);
  const visibleEligible = visible.filter((r) => !r.blocked);
  const allVisibleOn = visibleEligible.length > 0 && visibleEligible.every((r) => picked.has(r.key));
  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const counts = BUCKETS.map((b) => ({ ...b, n: data.rows.filter((r) => b.test(r.overdueDays)).length }));
  const overdue = data.rows.filter((r) => r.overdueDays >= 0).length;
  const blocked = data.rows.filter((r) => r.blocked).length;
  const rate = data.impact.sent ? Math.round((data.impact.booked / data.impact.sent) * 100) : null;

  return (
    <>
      <PageHeader
        title="Radar de retornos"
        description="Quem já deveria ter voltado e ainda não tem consulta marcada, pelos protocolos da clínica. Lembretes só para quem autorizou (LGPD)."
        actions={<ProtocolButton />}
      />

      {/* --------------------------------- Números --------------------------------- */}
      <dl className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label="Na hora de voltar" value={String(overdue)} hint={`${data.rows.length - overdue} vencem em ${data.windowDays} dias`} />
        <Kpi label="Lembrados, sem agendar" value={String(data.followUps.length)} hint="últimos 30 dias" alert={data.followUps.length > 0} />
        <Kpi label="Lembretes (90 dias)" value={String(data.impact.sent)} hint={blocked ? `${blocked} no radar sem autorização` : "todos no radar podem receber"} />
        <Kpi label="Voltaram a agendar" value={rate === null ? "sem dados" : `${rate}%`} hint={data.impact.sent ? `${data.impact.booked} de ${data.impact.sent} em até 30 dias` : "ainda sem envios"} />
      </dl>

      {/* ------------------------------- Faixa do radar ------------------------------- */}
      <section aria-labelledby="faixa-t" className="mb-5 rounded-2xl bg-paper p-4 ring-1 ring-line">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="faixa-t" className="flex items-center gap-2 font-bold">
            <Radar className="size-5 text-crm" aria-hidden /> Vencimentos
          </h2>
          <nav aria-label="Janela" className="flex rounded-xl bg-fog p-1">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/crm/retornos${w === 14 ? "" : `?janela=${w}`}`}
                aria-current={data.windowDays === w ? "page" : undefined}
                className={cn("inline-flex min-h-8 items-center rounded-lg px-2.5 text-sm font-semibold", data.windowDays === w ? "bg-paper shadow-sm ring-1 ring-line" : "text-ink-soft hover:text-ink")}
              >
                {w} dias
              </Link>
            ))}
          </nav>
        </div>
        {data.rows.length === 0 ? (
          <p className="text-sm text-ink-soft">Ninguém vence nos próximos {data.windowDays} dias.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-fog" aria-hidden>
              {counts.map((b) => (b.n ? <span key={b.id} className={cn(b.tone, bucket && bucket !== b.id && "opacity-30")} style={{ flexGrow: b.n }} /> : null))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Filtrar por vencimento">
              {counts.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={bucket === b.id}
                  onClick={() => setBucket(bucket === b.id ? null : b.id)}
                  disabled={b.n === 0}
                  className={cn("rounded-xl px-3 py-2 text-left ring-1 disabled:opacity-40", bucket === b.id ? "bg-ink text-white ring-ink" : "bg-paper ring-line hover:ring-crm")}
                >
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className={cn("size-2 rounded-full", b.tone)} aria-hidden />
                    {b.label}
                  </span>
                  <span className="font-display text-2xl font-bold tabular">{b.n}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
          {/* Abas */}
          <div role="tablist" aria-label="Retornos" className="mb-3 flex gap-1 border-b border-line">
            <Tab on={prefs.tab === "radar"} onClick={() => update({ tab: "radar" })}>
              No radar ({data.rows.length})
            </Tab>
            <Tab on={prefs.tab === "acompanhar"} onClick={() => update({ tab: "acompanhar" })}>
              Acompanhar ({data.followUps.length})
            </Tab>
          </div>

          {prefs.tab === "radar" ? (
            <div role="tabpanel">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-48">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
                  <label htmlFor="ret-q" className="sr-only">
                    Buscar paciente
                  </label>
                  <input id="ret-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente" className="block min-h-10 w-full rounded-xl bg-fog pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:bg-paper focus:ring-2 focus:ring-crm" />
                </div>
                <select aria-label="Ordenar" value={prefs.sort} onChange={(e) => update({ sort: e.target.value as typeof prefs.sort })} className="min-h-10 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
                  <option value="atraso">Mais atrasados primeiro</option>
                  <option value="vencimento">Vencem antes primeiro</option>
                  <option value="nome">Nome (A a Z)</option>
                </select>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={prefs.showBlocked} onChange={(e) => update({ showBlocked: e.target.checked })} className="size-4 accent-[var(--color-crm)]" />
                  Mostrar quem não pode receber
                </label>
              </div>
              {protocol || bucket ? (
                <p className="mb-2 text-sm">
                  Filtrando{protocol ? ` pelo protocolo “${data.protocols.find((p) => p.id === protocol)?.name}”` : ""}
                  {bucket ? ` (${BUCKETS.find((b) => b.id === bucket)!.label.toLowerCase()})` : ""}.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setProtocol(null);
                      setBucket(null);
                    }}
                    className="font-semibold text-crm hover:underline"
                  >
                    Ver todos
                  </button>
                </p>
              ) : null}

              <FormMessage state={state} />

              {/* Barra de envio */}
              {data.canSend && eligible.length ? (
                <form action={action} className="sticky top-14 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-paper/95 px-3 py-2 ring-1 ring-line backdrop-blur lg:top-2">
                  {pickedRows.map((r) => (
                    <input key={r.key} type="hidden" name="pair" value={r.key} />
                  ))}
                  <label className="flex min-h-10 items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={allVisibleOn}
                      onChange={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          for (const r of visibleEligible) {
                            if (allVisibleOn) n.delete(r.key);
                            else n.add(r.key);
                          }
                          return n;
                        })
                      }
                      className="size-4 accent-[var(--color-crm)]"
                    />
                    Marcar os {visibleEligible.length} da lista
                  </label>
                  <span className="ml-auto flex flex-wrap gap-2">
                    <button type="button" onClick={() => setPreview(true)} disabled={pickedRows.length === 0} className={buttonStyles("ghost", "disabled:opacity-40")}>
                      <Eye className="size-4" aria-hidden /> Ver mensagem
                    </button>
                    <SubmitButton disabled={pickedRows.length === 0} pendingText="Enviando...">
                      <Send className="size-4" aria-hidden /> Enviar {pickedRows.length} {pickedRows.length === 1 ? "lembrete" : "lembretes"}
                    </SubmitButton>
                  </span>
                </form>
              ) : null}

              {visible.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">{data.rows.length ? "Ninguém com estes filtros." : "Ninguém para lembrar agora. Quando alguém passar do prazo de um protocolo, aparece aqui."}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {visible.map((r) => (
                    <RadarItem key={r.key} r={r} picked={picked.has(r.key)} onToggle={toggle} canSend={data.canSend} canSchedule={data.canSchedule} />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div role="tabpanel">
              <p className="mb-3 text-sm text-ink-soft">Quem recebeu lembrete nos últimos 30 dias e ainda não marcou consulta. Sem resposta há alguns dias? Vale uma ligação.</p>
              {data.followUps.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">Ninguém para acompanhar: quem foi lembrado já agendou ou ainda não houve envios.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.followUps.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <PatientLink id={f.contactId} name={f.name} />
                          {f.replied ? (
                            <Badge tone="crm">
                              <MessageCircle className="size-3" aria-hidden /> respondeu
                            </Badge>
                          ) : (
                            <Badge tone={f.remindedDays >= 3 ? "warning" : "neutral"}>sem resposta</Badge>
                          )}
                        </div>
                        <p className="text-sm text-ink-soft">
                          {f.protocol}. Lembrado {f.remindedLabel}.
                        </p>
                      </div>
                      <span className="flex flex-wrap items-center gap-1">
                        {f.conversationId ? (
                          <Link href={`/crm/conversas/${f.conversationId}`} className={buttonStyles(f.replied ? "primary" : "ghost")}>
                            <MessagesSquare className="size-4" aria-hidden /> {f.replied ? "Ver resposta" : "Conversa"}
                          </Link>
                        ) : null}
                        {data.canSchedule ? (
                          <button type="button" onClick={() => emit("eco:open-schedule", { contactId: f.contactId, contactName: f.name })} className={buttonStyles("secondary")}>
                            Agendar
                          </button>
                        ) : null}
                        {data.canTask && !f.replied ? (
                          <ActionButton
                            action={createTaskAction}
                            fields={{ contactId: f.contactId, title: `Ligar para ${f.name.split(" ")[0]} sobre o retorno (${f.protocol})` }}
                            label={
                              <>
                                <Phone className="size-4" aria-hidden /> Tarefa: ligar
                              </>
                            }
                            pendingText="..."
                            variant="ghost"
                          />
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* -------------------------------- Protocolos -------------------------------- */}
        <section aria-labelledby="prot-t" className="rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
          <h2 id="prot-t" className="text-lg font-bold">
            Protocolos
          </h2>
          <p className="mb-3 text-sm text-ink-soft">Regras de retorno e o resultado dos lembretes (90 dias). Clique para filtrar o radar.</p>
          {data.protocols.length === 0 ? <p className="text-sm text-ink-soft">Nenhum protocolo. Crie o primeiro, por exemplo “Revisão em 180 dias”.</p> : null}
          <ul className="space-y-2">
            {data.protocols.map((p) => {
              const conv = p.sent90 ? Math.round((p.booked90 / p.sent90) * 100) : null;
              return (
                <li key={p.id} className={cn("rounded-xl p-3 ring-1", protocol === p.id ? "bg-crm-tint ring-crm" : "bg-fog ring-transparent")}>
                  <button
                    type="button"
                    onClick={() => {
                      setProtocol(protocol === p.id ? null : p.id);
                      update({ tab: "radar" });
                    }}
                    aria-pressed={protocol === p.id}
                    className="block w-full text-left"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="block text-xs text-ink-soft">
                          {p.daysAfter} dias após {p.serviceMatch ? `“${p.serviceMatch}”` : "qualquer consulta"}
                        </span>
                      </span>
                      {p.active ? <Badge tone="success">ativo</Badge> : <Badge>pausado</Badge>}
                    </span>
                    <span className="mt-2 grid grid-cols-3 gap-1 text-center">
                      <Mini label="no radar" value={String(p.dueNow)} />
                      <Mini label="lembretes" value={String(p.sent90)} />
                      <Mini label="voltaram" value={conv === null ? "sem dados" : `${conv}%`} />
                    </span>
                    {conv !== null ? (
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-paper" role="img" aria-label={`${conv}% voltaram a agendar`}>
                        <span className="block h-full rounded-full bg-ok" style={{ width: `${conv}%` }} />
                      </span>
                    ) : null}
                  </button>
                  <div className="mt-1">
                    <ProtocolButton initial={{ id: p.id, name: p.name, serviceMatch: p.serviceMatch, daysAfter: p.daysAfter, message: p.message, active: p.active }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Prévia: como a mensagem chega, por protocolo */}
      <Dialog open={preview} onClose={() => setPreview(false)} title="Prévia do lembrete" description="É assim que a mensagem chega. Cada pessoa recebe com o próprio nome.">
        <div className="space-y-4">
          {[...new Set(pickedRows.map((r) => r.protocolId))].map((pid) => {
            const p = data.protocols.find((x) => x.id === pid);
            const who = pickedRows.filter((r) => r.protocolId === pid);
            if (!p) return null;
            const first = who[0]!;
            return (
              <section key={pid}>
                <h3 className="text-sm font-bold">
                  {p.name}: {who.length} {who.length === 1 ? "pessoa" : "pessoas"}
                </h3>
                <p className="mt-2 rounded-2xl rounded-tr-sm bg-crm-tint px-3.5 py-2 text-sm whitespace-pre-line">
                  {fillTemplate(p.message, { nome: first.name, primeiro_nome: first.name.split(" ")[0], clinica: data.clinicName })}
                </p>
                <p className="mt-1 text-xs text-ink-soft">Para: {who.map((r) => r.name).join(", ")}</p>
              </section>
            );
          })}
          <p className="text-xs text-ink-soft">Vai pelo canal preferido de cada um. Fora da janela de 24h do WhatsApp, segue como modelo aprovado de “retorno”.</p>
        </div>
      </Dialog>
    </>
  );
}

/* ---------------------------------- Peças ---------------------------------- */

function RadarItem({ r, picked, onToggle, canSend, canSchedule }: { r: RadarRow; picked: boolean; onToggle: (k: string) => void; canSend: boolean; canSchedule: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      {canSend ? (
        <input
          type="checkbox"
          aria-label={`Enviar lembrete para ${r.name}`}
          checked={picked && !r.blocked}
          disabled={!!r.blocked}
          onChange={() => onToggle(r.key)}
          className="mt-1.5 size-4 shrink-0 accent-[var(--color-crm)] disabled:opacity-30"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PatientLink id={r.contactId} name={r.name} />
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", r.overdueDays > 30 ? "bg-alert-tint text-alert" : r.overdueDays > 0 ? "bg-erp-tint text-erp-ink" : r.overdueDays === 0 ? "bg-crm-tint text-crm" : "bg-fog text-ink-soft")}>
            {r.overdueDays > 0 ? `atrasado ${r.overdueDays} ${r.overdueDays === 1 ? "dia" : "dias"}` : r.overdueDays === 0 ? "vence hoje" : `vence em ${-r.overdueDays} ${r.overdueDays === -1 ? "dia" : "dias"}`}
          </span>
        </div>
        <p className="text-sm text-ink-soft">
          {r.protocol}. Última consulta {r.lastVisit}, vence {r.due}
          {r.channel ? `, via ${r.channel}` : ""}.
        </p>
        {r.blocked ? <p className="text-xs font-semibold text-alert">{r.blocked}</p> : null}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {r.conversationId ? (
          <Link href={`/crm/conversas/${r.conversationId}`} className="inline-flex size-10 items-center justify-center rounded-xl text-ink-soft hover:bg-fog hover:text-crm" aria-label={`Abrir conversa com ${r.name}`} title="Abrir conversa">
            <MessagesSquare className="size-4" aria-hidden />
          </Link>
        ) : null}
        {canSchedule ? (
          <button type="button" onClick={() => emit("eco:open-schedule", { contactId: r.contactId, contactName: r.name })} className={buttonStyles("ghost")}>
            Agendar
          </button>
        ) : null}
      </span>
    </li>
  );
}

function Kpi({ label, value, hint, alert = false }: { label: string; value: string; hint: string; alert?: boolean }) {
  return (
    <div className={cn("rounded-2xl bg-paper px-3 py-2.5 ring-1 ring-line sm:px-4 sm:py-3", alert && "ring-2 ring-erp")}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-display text-2xl font-bold tabular sm:text-3xl">{value}</dd>
      <dd className="text-xs text-ink-soft">{hint}</dd>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-lg bg-paper px-1 py-1">
      <span className="block font-display text-base font-bold tabular">{value}</span>
      <span className="block text-[0.7rem] text-ink-soft">{label}</span>
    </span>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={cn("-mb-px min-h-10 border-b-2 px-3 text-sm font-semibold", on ? "border-crm text-crm" : "border-transparent text-ink-soft hover:text-ink")}>
      {children}
    </button>
  );
}
