"use client";

/**
 * LISTA DE CONVERSAS
 * - Medidor da meta de 1ª resposta (quantos passaram de 15 min e a espera mais antiga)
 * - Busca, filtros com contagem, canal e ordem (tudo na URL: dá para compartilhar o link)
 * - Modo seleção: marcar várias e resolver/assumir/adiar/transferir de uma vez
 * - Itens com anel de espera ao vivo, não lidas, urgência, intenção, rascunho e adiada
 */
import { CHANNEL_LABEL, CHANNELS, FIRST_RESPONSE_TARGET_MIN } from "@ecosaude/core/crm";
import { AlertTriangle, ArrowDownUp, CheckSquare, Flame, PencilLine, Search, Settings2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useState } from "react";
import { WaitRing } from "@/components/crm/WaitRing";
import { Badge, ChannelBadge, channelDot } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { bulkConversationAction } from "@/modules/crm/actions/conversations";
import { ago, waitLabel } from "@/modules/crm/format";
import { useDraftIds } from "./drafts";
import type { InboxCounts, InboxItem, InboxPrefs } from "./types";

export const FILTER_LABEL = {
  esperando: "Esperando",
  abertas: "Abertas",
  minhas: "Minhas",
  sem_dono: "Sem responsável",
  adiadas: "Adiadas",
  resolvidas: "Resolvidas",
} as const;
export type Filter = keyof typeof FILTER_LABEL;

export function ConversationList({
  items,
  hasMore,
  counts,
  selectedId,
  filter,
  channel,
  q,
  sort,
  nowMs,
  timeZone,
  prefs,
  team,
  canReply,
  href,
  searchRef,
  onSettings,
}: {
  items: InboxItem[];
  hasMore: boolean;
  counts: InboxCounts;
  selectedId: string | null;
  filter: Filter;
  channel: string | null;
  q: string;
  sort: "espera" | "recentes";
  nowMs: number;
  /** Fuso da clínica: o horário "Volta às" sai no horário local dela */
  timeZone: string;
  prefs: InboxPrefs;
  team: { id: string; name: string }[];
  canReply: boolean;
  /** Monta o link mantendo filtros (id = conversa aberta) */
  href: (id: string | null, next?: Record<string, string>) => string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSettings: () => void;
}) {
  const drafts = useDraftIds();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const compact = prefs.density === "compacta";

  // Seleção só vale para conversas que ainda estão na lista
  const visiblePicked = items.filter((i) => picked.has(i.id)).map((i) => i.id);
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [notice, setNotice] = useState<string | null>(null);
  const stopSelecting = (message?: string) => {
    setSelecting(false);
    setPicked(new Set());
    setNotice(message ?? null);
  };

  const late = counts.atrasadas;
  const onTime = Math.max(0, counts.esperando - late);

  return (
    <section aria-label="Conversas" className="flex min-h-0 min-w-0 flex-col bg-paper">
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="flex items-center gap-2 px-1">
          <h1 className="flex-1 text-xl font-bold">Conversas</h1>
          {canReply ? (
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : (setSelecting(true), setNotice(null)))}
              aria-pressed={selecting}
              className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold", selecting ? "bg-ink text-white" : "text-ink-soft hover:bg-fog hover:text-ink")}
            >
              <CheckSquare className="size-4" aria-hidden />
              {selecting ? "Cancelar" : "Selecionar"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSettings}
            className="inline-flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-fog hover:text-ink"
            aria-label="Personalizar a tela de conversas"
            title="Personalizar"
          >
            <Settings2 className="size-4" aria-hidden />
          </button>
        </div>

        {/* Meta de 1ª resposta */}
        {counts.esperando ? (
          <div className="rounded-xl bg-fog px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className={cn("font-semibold", late ? "text-alert" : "text-pep-ink")}>
                {late ? `${late} acima da meta de ${FIRST_RESPONSE_TARGET_MIN} min` : `Todos dentro da meta de ${FIRST_RESPONSE_TARGET_MIN} min`}
              </span>
              {counts.maisAntigaMs ? <span className="text-ink-soft">mais antiga há {waitLabel(new Date(counts.maisAntigaMs), nowMs)}</span> : null}
            </div>
            <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-paper" role="img" aria-label={`${onTime} dentro da meta, ${late} acima da meta`}>
              <span className="bg-pep" style={{ width: `${(onTime / counts.esperando) * 100}%` }} />
              <span className="bg-alert" style={{ width: `${(late / counts.esperando) * 100}%` }} />
            </div>
          </div>
        ) : null}

        {/* Busca por nome ou telefone (mantém filtro, canal e ordem) */}
        <form action="/crm/conversas" role="search" className="relative">
          {filter !== "esperando" ? <input type="hidden" name="filtro" value={filter} /> : null}
          {channel ? <input type="hidden" name="canal" value={channel} /> : null}
          <label htmlFor="inbox-q" className="sr-only">
            Buscar conversa
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <input
            ref={searchRef}
            id="inbox-q"
            name="q"
            defaultValue={q}
            key={q}
            placeholder="Buscar por nome ou telefone (/)"
            className="block min-h-10 w-full rounded-xl bg-fog pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:bg-paper focus:ring-2 focus:ring-crm"
          />
        </form>
        {q ? (
          <p className="px-1 text-xs text-ink-soft">
            Buscando “{q}”.{" "}
            <Link href={href(selectedId, { q: "", mais: "" })} className="font-semibold text-crm hover:underline">
              Limpar busca
            </Link>
          </p>
        ) : null}

        <nav aria-label="Filtros" className="thin-scroll -mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => {
            const n = f === "resolvidas" ? null : counts[f];
            return (
              <Link
                key={f}
                href={href(null, { filtro: f, ordem: "", mais: "" })}
                aria-current={filter === f ? "page" : undefined}
                className={cn("inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold", filter === f ? "bg-ink text-white" : "bg-fog text-ink-soft hover:text-ink")}
              >
                {FILTER_LABEL[f]}
                {n !== null ? <span className="tabular opacity-70">{n}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <nav aria-label="Canal" className="thin-scroll -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pb-0.5">
            <Link href={href(selectedId, { canal: "" })} className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", !channel ? "bg-crm-tint text-crm" : "text-ink-soft hover:bg-fog")}>
              Todos
            </Link>
            {CHANNELS.map((c) => (
              <Link
                key={c}
                href={href(selectedId, { canal: c })}
                aria-current={channel === c ? "true" : undefined}
                className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", channel === c ? "bg-crm-tint text-crm" : "text-ink-soft hover:bg-fog")}
              >
                <span className={cn("size-1.5 rounded-full", channelDot[c])} aria-hidden />
                {CHANNEL_LABEL[c]}
              </Link>
            ))}
          </nav>
          <Link
            href={href(selectedId, { ordem: sort === "espera" ? "recentes" : "espera" })}
            className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-ink-soft hover:bg-fog hover:text-ink"
            title="Trocar a ordem da lista"
          >
            <ArrowDownUp className="size-3.5" aria-hidden />
            {sort === "espera" ? "Maior espera" : "Mais recentes"}
          </Link>
        </div>
      </div>

      {selecting ? <BulkBar ids={visiblePicked} total={items.length} team={team} onAll={() => setPicked(new Set(items.map((i) => i.id)))} onDone={stopSelecting} /> : null}
      {notice && !selecting ? (
        <p role="status" className="flex items-center justify-between gap-2 border-b border-line bg-pep-tint px-3 py-2 text-sm font-semibold text-pep-ink">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-paper/60" aria-label="Fechar aviso">
            <X className="size-4" aria-hidden />
          </button>
        </p>
      ) : null}

      <ul className="thin-scroll min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {items.length === 0 ? (
          <li className="p-6 text-center text-ink-soft">
            {q ? "Nenhuma conversa encontrada. Confira o filtro acima." : filter === "esperando" ? "Ninguém esperando resposta. Bom trabalho." : "Nenhuma conversa aqui."}
          </li>
        ) : null}
        {items.map((c) => {
          const active = c.id === selectedId;
          const waiting = c.waitingSinceMs !== null;
          const over = waiting && nowMs - c.waitingSinceMs! > FIRST_RESPONSE_TARGET_MIN * 60_000;
          const body = (
            <>
              <WaitRing name={c.contactName} since={waiting ? new Date(c.waitingSinceMs!) : null} now={nowMs} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate", c.unread ? "font-bold" : "font-semibold")}>{c.contactName}</span>
                  <span className={cn("shrink-0 text-xs tabular", waiting ? (over ? "font-bold text-alert" : "font-bold text-ink") : "text-ink-soft")}>
                    {waiting ? waitLabel(new Date(c.waitingSinceMs!), nowMs) : c.lastMessageMs ? ago(new Date(c.lastMessageMs), nowMs) : ""}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <ChannelBadge channel={c.channel} compact />
                  {prefs.showPreview ? (
                    <span className={cn("truncate text-sm", c.unread ? "text-ink" : "text-ink-soft")}>{c.preview}</span>
                  ) : (
                    <span className="text-xs text-ink-soft">{CHANNEL_LABEL[c.channel]}</span>
                  )}
                </span>
                {!compact || c.urgent || c.unread || c.sentimentLabel || drafts.has(c.id) ? (
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {c.urgent ? (
                      <Badge tone="alert">
                        <AlertTriangle className="size-3" aria-hidden /> Urgência
                      </Badge>
                    ) : null}
                    {/* Sentimento que pede atenção (mesmo no modo compacto) */}
                    {c.sentimentLabel ? (
                      <Badge tone={c.sentimentLevel >= 3 ? "alert" : "warning"}>
                        <Flame className="size-3" aria-hidden />
                        {c.sentimentLabel}
                        {c.sentimentByAi ? <Sparkles className="size-3" aria-label="entendido pela IA" /> : null}
                      </Badge>
                    ) : null}
                    {c.unread ? (
                      <Badge tone="dark">
                        {c.unread} nova{c.unread > 1 ? "s" : ""}
                      </Badge>
                    ) : null}
                    {drafts.has(c.id) && !active ? (
                      <Badge tone="warning">
                        <PencilLine className="size-3" aria-hidden /> Rascunho
                      </Badge>
                    ) : null}
                    {!compact && c.intentLabel && waiting ? (
                      <Badge tone="crm">
                        {c.intentByAi ? <Sparkles className="size-3" aria-label="entendido pela IA" /> : null}
                        {c.intentLabel}
                      </Badge>
                    ) : null}
                    {!compact && c.snoozedUntilMs ? <Badge>Volta às {new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(c.snoozedUntilMs)}</Badge> : null}
                    {!compact && c.assigneeName ? <span className="text-xs text-ink-soft">com {c.assigneeName}</span> : null}
                  </span>
                ) : null}
              </span>
            </>
          );
          const rowCls = cn("flex gap-3 px-3 hover:bg-fog/70", compact ? "py-2" : "py-3", active && "bg-crm-tint/60", c.urgent && "bg-alert-tint/60", !c.urgent && c.sentimentHot && "bg-erp-tint/40");
          return (
            <li key={c.id}>
              {selecting ? (
                <label className={cn(rowCls, "cursor-pointer items-start")}>
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-3 size-4 shrink-0 accent-[var(--color-crm)]"
                    aria-label={`Selecionar ${c.contactName}`}
                  />
                  {body}
                </label>
              ) : (
                <Link href={href(c.id)} aria-current={active ? "page" : undefined} className={rowCls} data-conversation={c.id}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
        {hasMore ? (
          <li className="p-3 text-center">
            <LoadMore href={href(selectedId, { mais: "+" })} />
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function LoadMore({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold text-crm hover:bg-crm-tint">
      Carregar mais conversas
    </Link>
  );
}

/* ---------------------------------- Em lote ---------------------------------- */

function BulkBar({ ids, total, team, onAll, onDone }: { ids: string[]; total: number; team: { id: string; name: string }[]; onAll: () => void; onDone: (message?: string) => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(bulkConversationAction, {});
  const finished = useEffectEvent(() => {
    onDone(state.message);
    router.refresh();
  });
  useEffect(() => {
    if (state.ok) finished();
  }, [state]);

  const hidden = ids.map((id) => <input key={id} type="hidden" name="id" value={id} />);
  const op = (value: string, label: string, extra?: Record<string, string>) => (
    <form action={action}>
      {hidden}
      <input type="hidden" name="op" value={value} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        disabled={pending || ids.length === 0}
        className="inline-flex min-h-9 items-center rounded-lg bg-paper px-2.5 text-sm font-semibold ring-1 ring-line hover:ring-crm disabled:opacity-40"
      >
        {label}
      </button>
    </form>
  );

  return (
    <div className="space-y-2 border-b border-line bg-crm-tint/50 px-3 py-2.5" role="region" aria-label="Ações em lote">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold" aria-live="polite">
          {ids.length} de {total} selecionada{ids.length === 1 ? "" : "s"}
        </span>
        <span className="flex gap-1">
          <button type="button" onClick={onAll} className="min-h-9 rounded-lg px-2 text-sm font-semibold text-crm hover:underline">
            Todas
          </button>
          <button type="button" onClick={() => onDone()} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-paper" aria-label="Sair da seleção">
            <X className="size-4" aria-hidden />
          </button>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {op("assumir", "Assumir")}
        {op("resolver", "Resolver")}
        {op("adiar", "Adiar 2 h", { hours: "2" })}
        <form action={action} className="flex">
          {hidden}
          <input type="hidden" name="op" value="atribuir" />
          <label htmlFor="bulk-assignee" className="sr-only">
            Transferir para
          </label>
          <select
            id="bulk-assignee"
            name="assigneeId"
            defaultValue="-"
            disabled={pending || ids.length === 0}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="min-h-9 max-w-40 rounded-lg bg-paper px-2 text-sm font-semibold ring-1 ring-line disabled:opacity-40"
          >
            <option value="-" disabled>
              Transferir para...
            </option>
            <option value="">Ninguém</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </form>
      </div>
      {state.message ? (
        <p role="status" className={cn("text-xs font-semibold", state.ok ? "text-pep-ink" : "text-alert")}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
