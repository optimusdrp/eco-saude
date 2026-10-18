"use client";

/**
 * MESA DE MENSAGENS (cliente)
 *
 * Desktop largo: [lista] [conversa] [painel com abas]   (painel pode ser ocultado)
 * Tablet:        [lista] [conversa]  + painel num diálogo ("Detalhes")
 * Celular:       lista OU conversa, com "voltar"
 *
 * Personalização (salva no navegador): densidade da lista, trecho da mensagem,
 * painel lateral, aba padrão, ir para a próxima ao resolver/adiar, Enter envia.
 *
 * Atalhos (fora da caixa de texto):
 *   J / ↓ próxima conversa   K / ↑ anterior   / buscar   R responder
 *   E resolver   A assumir   F buscar na conversa   P painel   ? ajuda
 */
import { CHANNEL_LABEL } from "@ecosaude/core/crm";
import { ArrowLeft, Flame, Keyboard, PanelRightClose, PanelRightOpen, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AutoRefresh, PatientLink } from "@/components/crm/widgets";
import { Dialog } from "@/components/ui";
import { Badge, ChannelBadge, EmptyState, StageBadge } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { useLiveNow } from "@/lib/hooks";
import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { Composer, type QuickReply } from "./Composer";
import { ContextPanel } from "./ContextPanel";
import { ConversationList, type Filter } from "./ConversationList";
import { MessageList } from "./MessageList";
import { ScheduleFromChatButton } from "./ScheduleFromChat";
import { ResumeButton, SummaryBar, useSummary } from "./SummaryBar";
import { SuggestionChip, ThreadControls } from "./ThreadControls";
import { DEFAULT_INBOX_PREFS, PREFS_KEY, type InboxCounts, type InboxItem, type ThreadData } from "./types";

const SHORTCUTS: [string, string][] = [
  ["J ou ↓", "Próxima conversa"],
  ["K ou ↑", "Conversa anterior"],
  ["/", "Buscar conversa"],
  ["R", "Responder (vai para a caixa de texto)"],
  ["E", "Resolver"],
  ["A", "Assumir"],
  ["F", "Buscar dentro da conversa"],
  ["S", "Resumir a conversa"],
  ["P", "Mostrar ou ocultar o painel"],
  ["?", "Esta ajuda"],
];

export function InboxLayout({
  items,
  hasMore,
  counts,
  thread,
  selectedId,
  filter,
  channel,
  q,
  sort,
  pages,
  serverNowMs,
  timeZone,
  userId,
  team,
  canReply,
  canBulk,
  canSchedule,
  quickReplies,
  vars,
}: {
  items: InboxItem[];
  hasMore: boolean;
  counts: InboxCounts;
  thread: ThreadData | null;
  selectedId: string | null;
  filter: Filter;
  channel: string | null;
  q: string;
  sort: "espera" | "recentes";
  pages: number;
  serverNowMs: number;
  /** Fuso da clínica (no navegador não há contexto de requisição) */
  timeZone: string;
  userId: string;
  team: { id: string; name: string }[];
  canReply: boolean;
  /** Ações em várias conversas (permissão conversas.massa) */
  canBulk: boolean;
  canSchedule: boolean;
  quickReplies: QuickReply[];
  vars: Record<string, string> | null;
}) {
  const router = useRouter();
  const [prefs, update, reset] = useStoredPrefs(PREFS_KEY, DEFAULT_INBOX_PREFS);
  const nowMs = useLiveNow(serverNowMs, 15_000);
  const searchRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [details, setDetails] = useState(false);
  const [threadSearch, setThreadSearch] = useState<string | null>(null);
  // Resumo da conversa ("Resumir"): começa com o último resumo guardado, se houver
  const summary = useSummary(thread?.id ?? "", thread?.summary ?? null);

  /** Link mantendo filtros: id = conversa (null = lista); next sobrescreve parâmetros */
  const href = (id: string | null, next: Record<string, string> = {}) => {
    const cur: Record<string, string | undefined> = {
      filtro: filter !== "esperando" ? filter : undefined,
      canal: channel ?? undefined,
      q: q || undefined,
      ordem: undefined,
      mais: pages > 1 ? String(pages) : undefined,
    };
    // ordem só vai na URL quando difere do padrão do filtro
    const defaultSort = filter === "esperando" || filter === "sem_dono" ? "espera" : "recentes";
    if (sort !== defaultSort) cur.ordem = sort;
    for (const [k, v] of Object.entries(next)) cur[k] = k === "mais" && v === "+" ? String(pages + 1) : v || undefined;
    if (cur.filtro === "esperando") cur.filtro = undefined;
    const sp = new URLSearchParams(Object.entries(cur).filter((e): e is [string, string] => !!e[1]));
    const s = sp.toString();
    return `${id ? `/crm/conversas/${id}` : "/crm/conversas"}${s ? `?${s}` : ""}`;
  };

  // Vizinhas na lista (atalhos J/K e "ir para a próxima" ao resolver)
  const index = items.findIndex((i) => i.id === selectedId);
  const neighbor = (dir: 1 | -1) => {
    if (items.length === 0) return null;
    if (index === -1) return items[0]!.id;
    return items[index + dir]?.id ?? null;
  };
  const nextAfterDone = items[index + 1]?.id ?? (index > 0 ? items[index - 1]?.id : null) ?? null;
  const nextHref = selectedId ? (nextAfterDone ? href(nextAfterDone) : href(null)) : null;

  // Atalhos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      const k = e.key.toLowerCase();
      const go = (id: string | null) => {
        if (!id) return;
        e.preventDefault();
        router.push(href(id));
      };
      if (k === "j" || e.key === "ArrowDown") go(neighbor(1));
      else if (k === "k" || e.key === "ArrowUp") go(neighbor(-1));
      else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (k === "r") {
        const area = document.getElementById("composer");
        if (area) {
          e.preventDefault();
          area.focus();
        }
      } else if (k === "e" || k === "a" || k === "s") {
        const btn = document.querySelector<HTMLButtonElement>(`[data-shortcut="${k}"]`);
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      } else if (k === "f" && thread) {
        e.preventDefault();
        setThreadSearch(thread.id);
      } else if (k === "p") {
        e.preventDefault();
        update({ showPanel: !prefs.showPanel });
      } else if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const panelWide = !!thread && prefs.showPanel;

  return (
    <div
      className={cn(
        "-mx-3 -mt-4 grid grid-cols-[minmax(0,1fr)] sm:-mx-5 lg:-mx-8 lg:h-[calc(100dvh-3.5rem)]",
        "lg:grid-cols-[21rem_minmax(0,1fr)]",
        panelWide ? "xl:grid-cols-[22rem_minmax(0,1fr)_20rem]" : "xl:grid-cols-[22rem_minmax(0,1fr)]",
      )}
    >
      <AutoRefresh seconds={10} />

      {/* ------------------------------ Lista ------------------------------ */}
      <div className={cn("min-h-0 min-w-0 border-line lg:flex lg:flex-col lg:border-r", selectedId ? "hidden" : "flex flex-col")}>
        <ConversationList
          items={items}
          hasMore={hasMore}
          counts={counts}
          selectedId={selectedId}
          filter={filter}
          channel={channel}
          q={q}
          sort={sort}
          nowMs={nowMs}
          timeZone={timeZone}
          prefs={prefs}
          team={team}
          canReply={canBulk}
          href={href}
          searchRef={searchRef}
          onSettings={() => setSettings(true)}
        />
      </div>

      {/* ----------------------------- Conversa ----------------------------- */}
      {thread ? (
        <section aria-label={`Conversa com ${thread.contact.name}`} className="flex h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] min-w-0 flex-col bg-fog lg:h-auto lg:min-h-0">
          <header className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-3 py-2.5">
            <Link href={href(null)} className="inline-flex size-10 items-center justify-center rounded-xl hover:bg-ink/5 lg:hidden" aria-label="Voltar para a lista">
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
            <div className="min-w-0 flex-1">
              <PatientLink id={thread.contact.id} name={thread.contact.name} className="block truncate text-lg" />
              <div className="flex flex-wrap items-center gap-2">
                <ChannelBadge channel={thread.channel} />
                <StageBadge stage={thread.contact.stage} />
                {thread.sentimentLevel >= 2 && thread.sentimentLabel ? (
                  <Badge tone={thread.sentimentLevel >= 3 ? "alert" : "warning"}>
                    <Flame className="size-3" aria-hidden /> {thread.sentimentLabel}
                  </Badge>
                ) : null}
                {thread.otherChannels.map((o) => (
                  <Link key={o.id} href={href(o.id)} className="text-xs font-semibold text-crm hover:underline">
                    também no {CHANNEL_LABEL[o.channel]}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <ResumeButton s={summary} />
              <IconBtn label="Buscar nesta conversa (F)" onClick={() => setThreadSearch(threadSearch === thread.id ? null : thread.id)} pressed={threadSearch === thread.id}>
                <Search className="size-4" aria-hidden />
              </IconBtn>
              {/* Painel: coluna no desktop largo, diálogo nas telas menores */}
              <span className="hidden xl:inline-flex">
                <IconBtn label={prefs.showPanel ? "Ocultar painel (P)" : "Mostrar painel (P)"} onClick={() => update({ showPanel: !prefs.showPanel })} pressed={prefs.showPanel}>
                  {prefs.showPanel ? <PanelRightClose className="size-4" aria-hidden /> : <PanelRightOpen className="size-4" aria-hidden />}
                </IconBtn>
              </span>
              <span className="xl:hidden">
                <IconBtn label="Detalhes do paciente e assistente" onClick={() => setDetails(true)}>
                  <PanelRightOpen className="size-4" aria-hidden />
                </IconBtn>
              </span>
            </div>
            <ThreadControls
              conversationId={thread.id}
              resolved={thread.status === "resolvida"}
              mine={thread.assigneeId === userId}
              assigneeId={thread.assigneeId}
              team={team}
              urgent={thread.urgent}
              unread={thread.unread}
              canReply={canReply}
              nextHref={nextHref}
              autoAdvance={prefs.autoAdvance}
            />
          </header>

          {/* Ameaça (Procon, processo, avaliação pública): atenção redobrada, sem esconder a conversa */}
          {!thread.urgent && thread.sentiment === "ameaca" ? (
            <div role="status" className="flex gap-2 border-b border-erp/30 bg-erp-tint px-4 py-2.5 text-sm text-erp-ink">
              <Flame className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <strong>O paciente falou em reclamação formal ou avaliação pública.</strong> Responda com calma, sem prometer o que não pode cumprir, e envolva a gestão.
              </p>
            </div>
          ) : null}

          {thread.urgent ? (
            <div role="alert" className="flex gap-2 border-b border-alert/30 bg-alert-tint px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alert" aria-hidden />
              <p className="line-clamp-2 sm:line-clamp-none" title={thread.urgentGuidance ?? undefined}>
                <strong className="text-alert">Atenção.</strong> {thread.urgentGuidance}
              </p>
            </div>
          ) : null}

          <SummaryBar s={summary} />

          <MessageList key={thread.id} messages={thread.messages} searchOpen={threadSearch === thread.id} onCloseSearch={() => setThreadSearch(null)} />

          {/* Sugestões quando o painel não está à vista */}
          {canReply && thread.status !== "resolvida" && thread.suggestions.length ? (
            <div className={cn("thin-scroll flex gap-2 overflow-x-auto border-t border-line bg-paper px-3 py-2", panelWide && "xl:hidden")}>
              {thread.suggestions.slice(0, 3).map((s) => (
                <div key={s} className="w-72 shrink-0">
                  <SuggestionChip text={s} />
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <Composer
              conversationId={thread.id}
              quickReplies={quickReplies}
              vars={vars ?? {}}
              windowOpen={thread.window.open && (thread.window.unlimited || (thread.window.closesAtMs ?? 0) > nowMs)}
              canReply={canReply}
              enterToSend={prefs.enterToSend}
              extraActions={canSchedule ? <ScheduleFromChatButton conversationId={thread.id} contactId={thread.contact.id} contactName={thread.contact.name} /> : null}
            />
          </div>
        </section>
      ) : (
        <div className="hidden items-center justify-center p-8 lg:flex">
          <EmptyState title="Escolha uma conversa" className="max-w-md bg-paper">
            <p>As que esperam resposta há mais tempo ficam no topo. Use J e K para passar de uma para outra e ? para ver todos os atalhos.</p>
            <p className="mt-2">Para testar, use o Simulador de canais e mande uma mensagem como paciente.</p>
          </EmptyState>
        </div>
      )}

      {/* --------------------------- Painel lateral --------------------------- */}
      {panelWide ? (
        <aside aria-label="Assistente e dados do paciente" className="hidden min-h-0 border-l border-line bg-paper xl:flex xl:flex-col">
          <ContextPanel thread={thread!} tab={prefs.panelTab} onTab={(t) => update({ panelTab: t })} nowMs={nowMs} canReply={canReply} canSchedule={canSchedule} />
        </aside>
      ) : null}

      {thread ? (
        <Dialog open={details} onClose={() => setDetails(false)} title={thread.contact.name}>
          <div className="-mx-5 -my-4">
            <ContextPanel thread={thread} tab={prefs.panelTab} onTab={(t) => update({ panelTab: t })} nowMs={nowMs} canReply={canReply} canSchedule={canSchedule} />
          </div>
        </Dialog>
      ) : null}

      {/* ----------------------------- Preferências ----------------------------- */}
      <Dialog open={settings} onClose={() => setSettings(false)} title="Personalizar conversas" description="Fica salvo neste navegador.">
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Lista</legend>
            <div role="group" aria-label="Densidade" className="flex rounded-xl bg-fog p-1">
              {(["confortavel", "compacta"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={prefs.density === d}
                  onClick={() => update({ density: d })}
                  className={cn("min-h-9 flex-1 rounded-lg text-sm font-semibold", prefs.density === d ? "bg-paper shadow-sm ring-1 ring-line" : "text-ink-soft")}
                >
                  {d === "confortavel" ? "Confortável" : "Compacta"}
                </button>
              ))}
            </div>
          </fieldset>
          <Toggle checked={prefs.showPreview} onChange={(v) => update({ showPreview: v })} label="Mostrar o trecho da última mensagem" />
          <Toggle checked={prefs.showPanel} onChange={(v) => update({ showPanel: v })} label="Painel do assistente ao lado (telas largas)" />
          <Toggle checked={prefs.autoAdvance} onChange={(v) => update({ autoAdvance: v })} label="Ao resolver ou adiar, abrir a próxima conversa" />
          <Toggle checked={prefs.enterToSend} onChange={(v) => update({ enterToSend: v })} label="Enter envia a mensagem" hint="Desligado: Enter quebra linha e Ctrl+Enter envia." />
          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
            <button type="button" onClick={reset} className="min-h-10 text-sm font-semibold text-ink-soft hover:text-ink">
              Voltar ao padrão
            </button>
            <button
              type="button"
              onClick={() => {
                setSettings(false);
                setHelp(true);
              }}
              className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-crm hover:underline"
            >
              <Keyboard className="size-4" aria-hidden />
              Atalhos de teclado
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog open={help} onClose={() => setHelp(false)} title="Atalhos de teclado" description="Funcionam fora da caixa de texto.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-md bg-fog px-2 py-0.5 font-semibold ring-1 ring-line">{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  );
}

function IconBtn({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn("inline-flex size-10 items-center justify-center rounded-xl text-ink-soft hover:bg-fog hover:text-ink", pressed && "bg-crm-tint text-crm")}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-crm)]" />
      <span>
        <span className="font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-ink-soft">{hint}</span> : null}
      </span>
    </label>
  );
}
