"use client";

/**
 * JORNADA DO PACIENTE (quadro interativo)
 *
 *  - Funil dos últimos 90 dias e motivos de perda no topo
 *  - Filtros: busca, atalhos (parados, esperando resposta, com consulta,
 *    sem responsável, meus), canal, origem, responsável e etiqueta
 *  - Visão em QUADRO (arrastar entre etapas) ou em LISTA (tabela ordenável)
 *  - Seleção em lote: mover de etapa e definir responsável de vários contatos
 *  - "Desfazer" logo depois de mover um cartão
 *  - Personalizar (salvo no navegador): densidade, ordem, campos do cartão,
 *    etapas ocultas e recolhidas
 *
 * A maioria das mudanças de etapa acontece SOZINHA (respondeu, agendou,
 * compareceu...). Arrastar serve para corrigir.
 */
import { JOURNEY_STAGE_HINT, JOURNEY_STAGE_LABEL, JOURNEY_STAGES, type JourneyStage } from "@ecosaude/core/crm";
import { CheckSquare, ChevronsLeftRight, Columns3, List, RotateCcw, Search, Settings2, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import { Dialog, Field, SubmitButton, TextareaField } from "@/components/ui";
import { PageHeader } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { createTaskAction, moveStageAction } from "@/modules/crm/actions/contacts";
import { assignOwnerAction, bulkMoveStageAction } from "@/modules/crm/actions/journey";
import { Card, isStale } from "./Card";
import { Funnel } from "./Funnel";
import { NextStepDialog } from "./NextStepDialog";
import { ListView } from "./ListView";
import { DEFAULT_JOURNEY_PREFS, SORT_LABEL, type JourneyCard, type JourneyData, type JourneySort } from "./types";

const columnAccent: Record<JourneyStage, string> = {
  novo: "border-t-crm",
  em_conversa: "border-t-bi",
  agendado: "border-t-erp",
  paciente: "border-t-pep",
  reativar: "border-t-alert",
  perdido: "border-t-ink/30",
};

type Quick = "parados" | "esperando" | "consulta" | "sem_dono" | "meus";
const QUICK_LABEL: Record<Quick, string> = {
  parados: "Parados",
  esperando: "Esperando resposta",
  consulta: "Com consulta marcada",
  sem_dono: "Sem responsável",
  meus: "Meus contatos",
};
/** Cartões por etapa antes do "Mostrar mais" (quadro leve mesmo com muitos contatos) */
const PAGE = 40;

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function JourneyBoard({ data }: { data: JourneyData }) {
  const router = useRouter();
  const [prefs, update, reset] = useStoredPrefs("eco:jornada:prefs:v1", DEFAULT_JOURNEY_PREFS);
  const searchRef = useRef<HTMLInputElement>(null);

  // Movimento otimista: o cartão muda de coluna na hora; o servidor confirma depois
  const [cards, applyMove] = useOptimistic(data.cards, (state, m: { ids: string[]; stage: JourneyStage }) => state.map((c) => (m.ids.includes(c.id) ? { ...c, stage: m.stage, daysInStage: 0 } : c)));

  /* -------------------------------- Filtros -------------------------------- */
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<Quick[]>([]);
  const [channel, setChannel] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [tag, setTag] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const sources = useMemo(() => [...new Set(data.cards.map((c) => c.source).filter((s): s is string => !!s))].sort(), [data.cards]);
  const tags = useMemo(() => [...new Set(data.cards.flatMap((c) => c.tags))].sort(), [data.cards]);
  const channels = useMemo(() => [...new Set(data.cards.map((c) => c.channel).filter((s): s is NonNullable<typeof s> => !!s))].sort(), [data.cards]);

  const term = plain(q.trim());
  const filtered = cards.filter(
    (c) =>
      (!term || plain(c.name).includes(term) || c.tags.some((t) => plain(t).includes(term))) &&
      (!quick.includes("parados") || isStale(c)) &&
      (!quick.includes("esperando") || c.waiting) &&
      (!quick.includes("consulta") || !!c.next) &&
      (!quick.includes("sem_dono") || !c.ownerId) &&
      (!quick.includes("meus") || c.ownerId === data.userId) &&
      (!channel || c.channel === channel) &&
      (!source || c.source === source) &&
      (!owner || (owner === "-" ? !c.ownerId : c.ownerId === owner)) &&
      (!tag || c.tags.includes(tag)),
  );
  const sorter: Record<JourneySort, (a: JourneyCard, b: JourneyCard) => number> = {
    parados: (a, b) => b.daysInStage - a.daysInStage,
    recentes: (a, b) => a.daysInStage - b.daysInStage,
    nome: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
    consulta: (a, b) => (a.nextMs ?? Infinity) - (b.nextMs ?? Infinity),
  };
  const sorted = [...filtered].sort(sorter[prefs.sort]);
  const byStage = (s: JourneyStage) => sorted.filter((c) => c.stage === s);
  const activeFilters = quick.length + [channel, source, owner, tag, term].filter(Boolean).length;
  const clearFilters = () => {
    setQ("");
    setQuick([]);
    setChannel("");
    setSource("");
    setOwner("");
    setTag("");
  };

  /* --------------------------- Arrastar e seleção --------------------------- */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<JourneyStage | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* ------------------------------ Mover etapas ------------------------------ */
  const [moveState, moveAction] = useActionState(moveStageAction, {});
  const [bulkState, bulkAction] = useActionState(bulkMoveStageAction, {});
  const [ownerState, ownerAction] = useActionState(assignOwnerAction, {});
  const [taskState, taskAction] = useActionState(createTaskAction, {});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [undo, setUndo] = useState<{ card: JourneyCard; from: JourneyStage; to: JourneyStage } | null>(null);
  const [lostFor, setLostFor] = useState<{ ids: string[]; label: string } | null>(null);
  const [taskFor, setTaskFor] = useState<JourneyCard | null>(null);
  // Próximo passo (Ajustes > IA): cartão com o rascunho aberto
  const [nextFor, setNextFor] = useState<JourneyCard | null>(null);
  const closeNext = useCallback(() => setNextFor(null), []);

  // Resultado das ações (ajuste de estado durante a renderização, sem efeito)
  const [seen, setSeen] = useState({ moveState, bulkState, ownerState, taskState });
  if (seen.moveState !== moveState || seen.bulkState !== bulkState || seen.ownerState !== ownerState || seen.taskState !== taskState) {
    const changed = [moveState, bulkState, ownerState, taskState].find((s, i) => s !== [seen.moveState, seen.bulkState, seen.ownerState, seen.taskState][i])!;
    setSeen({ moveState, bulkState, ownerState, taskState });
    if (changed.message) setNotice({ ok: !!changed.ok, text: changed.message });
    if (changed !== moveState) setUndo(null);
    if (changed.ok && changed !== moveState) {
      setLostFor(null);
      setTaskFor(null);
      setSelected(new Set());
      if (changed !== taskState) setSelecting(false);
    }
    if (changed === bulkState && !bulkState.ok && bulkState.errors) setNotice(null);
  }
  useEffect(() => {
    if (moveState.ok || bulkState.ok || ownerState.ok) router.refresh();
  }, [moveState, bulkState, ownerState, router]);

  const submit = (ids: string[], stage: JourneyStage, lostReason?: string) => {
    const form = new FormData();
    ids.forEach((id) => form.append("id", id));
    form.set("stage", stage);
    if (lostReason) form.set("lostReason", lostReason);
    startTransition(() => {
      applyMove({ ids, stage });
      bulkAction(form);
    });
  };

  /** Move um cartão (pede o motivo quando é "Perdido") e oferece desfazer */
  const move = (card: JourneyCard, stage: JourneyStage) => {
    if (!data.canEdit || card.stage === stage) return;
    if (stage === "perdido") {
      setLostFor({ ids: [card.id], label: card.name });
      return;
    }
    const form = new FormData();
    form.set("contactId", card.id);
    form.set("stage", stage);
    setUndo({ card, from: card.stage, to: stage });
    startTransition(() => {
      applyMove({ ids: [card.id], stage });
      moveAction(form);
    });
  };
  const undoMove = () => {
    if (!undo) return;
    const form = new FormData();
    form.set("contactId", undo.card.id);
    form.set("stage", undo.from);
    // Voltar para "Perdido" reaproveita o motivo que já existia
    if (undo.from === "perdido") form.set("lostReason", undo.card.lostReason ?? "Movimento desfeito");
    setUndo(null);
    startTransition(() => {
      applyMove({ ids: [undo.card.id], stage: undo.from });
      moveAction(form);
    });
  };

  /* --------------------------- Arrastar e seleção --------------------------- */
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectedIds = sorted.filter((c) => selected.has(c.id)).map((c) => c.id);
  const [more, setMore] = useState<Partial<Record<JourneyStage, number>>>({});
  const [mobileStage, setMobileStage] = useState<JourneyStage>("novo");
  const [settings, setSettings] = useState(false);

  // Atalhos: "/" busca, "v" troca quadro/lista
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        update({ view: prefs.view === "quadro" ? "lista" : "quadro" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const visibleStages = JOURNEY_STAGES.filter((s) => !prefs.hiddenStages.includes(s));
  const staleTotal = cards.filter(isStale).length;

  const cardProps = (c: JourneyCard) => ({
    card: c,
    prefs,
    canEdit: data.canEdit,
    canSchedule: data.canSchedule,
    dragging: dragId === c.id,
    selecting,
    selected: selected.has(c.id),
    onToggle: toggle,
    onDragStart: setDragId,
    onDragEnd: () => {
      setDragId(null);
      setOverStage(null);
    },
    onMove: move,
    onTask: setTaskFor,
    onNextStep: setNextFor,
  });

  const select = "min-h-9 max-w-44 rounded-lg bg-paper px-2 text-sm ring-1 ring-line";

  return (
    <>
      <PageHeader
        title="Jornada do paciente"
        description={
          <>
            A etapa muda sozinha quando alguém responde, agenda ou comparece. Arraste só para corrigir.
            {staleTotal ? (
              <span className="font-semibold text-erp-ink">
                {" "}
                {staleTotal} {staleTotal === 1 ? "contato parado" : "contatos parados"} pedem atenção.
              </span>
            ) : null}
          </>
        }
      />

      {prefs.showFunnel ? <Funnel steps={data.funnel} lostReasons={data.lostReasons} lossGroups={data.lossGroups} /> : null}

      {/* ------------------------------ Barra de filtros ------------------------------ */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
            <label htmlFor="jornada-q" className="sr-only">
              Buscar contato ou etiqueta
            </label>
            <input
              ref={searchRef}
              id="jornada-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar contato ou etiqueta (/)"
              className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
            />
          </div>
          <div role="group" aria-label="Visão" className="flex rounded-xl bg-paper p-1 ring-1 ring-line">
            {(["quadro", "lista"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={prefs.view === v}
                onClick={() => update({ view: v })}
                className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", prefs.view === v ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
                title={`${v === "quadro" ? "Quadro" : "Lista"} (V)`}
              >
                {v === "quadro" ? <Columns3 className="size-4" aria-hidden /> : <List className="size-4" aria-hidden />}
                <span className="hidden sm:inline">{v === "quadro" ? "Quadro" : "Lista"}</span>
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="jornada-ordem">
            Ordenar
          </label>
          <select id="jornada-ordem" value={prefs.sort} onChange={(e) => update({ sort: e.target.value as JourneySort })} className={cn(select, "min-h-11 rounded-xl")}>
            {(Object.keys(SORT_LABEL) as JourneySort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          {data.canEdit ? (
            <button
              type="button"
              onClick={() => {
                setSelecting((v) => !v);
                setSelected(new Set());
              }}
              aria-pressed={selecting}
              className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold ring-1", selecting ? "bg-ink text-white ring-ink" : "bg-paper ring-line hover:ring-crm")}
            >
              <CheckSquare className="size-4" aria-hidden />
              {selecting ? "Cancelar seleção" : "Selecionar"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSettings(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-paper px-3.5 text-sm font-semibold ring-1 ring-line hover:ring-crm"
          >
            <Settings2 className="size-4" aria-hidden />
            <span className="hidden sm:inline">Personalizar</span>
            <span className="sr-only sm:hidden">Personalizar</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label="Atalhos de filtro"
            className="thin-scroll -mx-3 flex w-[calc(100%+1.5rem)] gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0"
          >
            {(Object.keys(QUICK_LABEL) as Quick[]).map((k) => {
              const on = quick.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setQuick((v) => (on ? v.filter((x) => x !== k) : [...v, k]))}
                  className={cn(
                    "inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold ring-1",
                    on ? "bg-ink text-white ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink",
                  )}
                >
                  {QUICK_LABEL[k]}
                </button>
              );
            })}
          </div>
          {/* No celular os seletores ficam atrás de "Mais filtros" */}
          <button
            type="button"
            onClick={() => setMoreFilters((v) => !v)}
            aria-expanded={moreFilters}
            className="inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold text-crm ring-1 ring-line lg:hidden"
          >
            {moreFilters ? "Menos filtros" : `Mais filtros${[channel, source, owner, tag].filter(Boolean).length ? ` (${[channel, source, owner, tag].filter(Boolean).length})` : ""}`}
          </button>
          <span className={cn("flex-wrap gap-1.5 lg:flex", moreFilters ? "flex" : "hidden")}>
            {channels.length > 1 ? (
              <select aria-label="Canal" value={channel} onChange={(e) => setChannel(e.target.value)} className={select}>
                <option value="">Todos os canais</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c === "whatsapp" ? "WhatsApp" : c === "facebook" ? "Messenger" : c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            ) : null}
            {sources.length ? (
              <select aria-label="Origem" value={source} onChange={(e) => setSource(e.target.value)} className={select}>
                <option value="">Todas as origens</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
            <select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className={select}>
              <option value="">Todos os responsáveis</option>
              <option value="-">Sem responsável</option>
              {data.team.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {tags.length ? (
              <select aria-label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)} className={select}>
                <option value="">Todas as etiquetas</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : null}
          </span>
          <span className="ml-auto text-sm text-ink-soft" aria-live="polite">
            {filtered.length} de {cards.length} contatos
            {activeFilters ? (
              <button type="button" onClick={clearFilters} className="ml-2 min-h-9 font-semibold text-crm hover:underline">
                Limpar filtros
              </button>
            ) : null}
          </span>
        </div>
        {data.truncated ? <p className="text-xs text-ink-soft">Mostrando os 800 contatos que mudaram de etapa mais recentemente. Use a busca em Contatos para os demais.</p> : null}
      </div>

      {/* ------------------------------ Ações em lote ------------------------------ */}
      {selecting ? (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-white shadow-lg" role="region" aria-label="Ações em lote">
          <span className="font-semibold" aria-live="polite">
            {selectedIds.length} {selectedIds.length === 1 ? "selecionado" : "selecionados"}
          </span>
          <button type="button" onClick={() => setSelected(new Set(sorted.map((c) => c.id)))} className="min-h-9 rounded-lg px-2 text-sm font-semibold underline-offset-4 hover:underline">
            Todos os {sorted.length} filtrados
          </button>
          <span className="ml-auto flex flex-wrap gap-2">
            <select
              aria-label="Mover selecionados para"
              value=""
              disabled={!selectedIds.length}
              onChange={(e) => {
                const stage = e.target.value as JourneyStage;
                if (stage === "perdido") setLostFor({ ids: selectedIds, label: `${selectedIds.length} contatos` });
                else submit(selectedIds, stage);
              }}
              className="min-h-9 rounded-lg bg-paper px-2 text-sm font-semibold text-ink disabled:opacity-50"
            >
              <option value="" disabled>
                Mover para...
              </option>
              {JOURNEY_STAGES.map((s) => (
                <option key={s} value={s}>
                  {JOURNEY_STAGE_LABEL[s]}
                </option>
              ))}
            </select>
            <form action={ownerAction}>
              {selectedIds.map((id) => (
                <input key={id} type="hidden" name="id" value={id} />
              ))}
              <select
                aria-label="Definir responsável dos selecionados"
                name="ownerId"
                defaultValue="-"
                key={selectedIds.join()}
                disabled={!selectedIds.length}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="min-h-9 rounded-lg bg-paper px-2 text-sm font-semibold text-ink disabled:opacity-50"
              >
                <option value="-" disabled>
                  Responsável...
                </option>
                <option value="">Ninguém</option>
                {data.team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </form>
          </span>
        </div>
      ) : null}

      {/* ------------------------------ Quadro / Lista ------------------------------ */}
      {prefs.view === "lista" ? (
        <ListView cards={sorted} sort={prefs.sort} onSort={(s) => update({ sort: s })} canEdit={data.canEdit} selecting={selecting} selected={selected} onToggle={toggle} onMove={move} />
      ) : (
        <>
          {/* Desktop: colunas */}
          <div
            className="thin-scroll hidden gap-3 overflow-x-auto pb-3 lg:grid"
            style={{ gridTemplateColumns: visibleStages.map((s) => (prefs.collapsedStages.includes(s) ? "3.25rem" : "minmax(12.5rem,1fr)")).join(" ") }}
          >
            {visibleStages.map((s) => {
              const list = byStage(s);
              const collapsed = prefs.collapsedStages.includes(s);
              const stale = list.filter(isStale).length;
              const limit = more[s] ?? PAGE;
              const toggleCollapse = () => update({ collapsedStages: collapsed ? prefs.collapsedStages.filter((x) => x !== s) : [...prefs.collapsedStages, s] });
              return (
                <section
                  key={s}
                  aria-label={JOURNEY_STAGE_LABEL[s]}
                  onDragOver={(e) => {
                    if (!data.canEdit || !dragId) return;
                    e.preventDefault();
                    if (overStage !== s) setOverStage(s);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((o) => (o === s ? null : o));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const card = cards.find((c) => c.id === e.dataTransfer.getData("text/plain"));
                    if (card) move(card, s);
                    setOverStage(null);
                    setDragId(null);
                  }}
                  className={cn(
                    "flex max-h-[calc(100dvh-9rem)] min-h-[55dvh] flex-col rounded-2xl border-t-4 bg-ink/[0.04] p-2 transition-colors",
                    columnAccent[s],
                    overStage === s && "bg-crm-tint ring-2 ring-crm",
                  )}
                >
                  {collapsed ? (
                    <button
                      type="button"
                      onClick={toggleCollapse}
                      className="flex h-full flex-col items-center gap-2 pt-1"
                      aria-label={`Expandir ${JOURNEY_STAGE_LABEL[s]} (${list.length})`}
                      title="Expandir"
                    >
                      <span className="rounded-full bg-paper px-2 text-sm font-bold tabular ring-1 ring-line">{list.length}</span>
                      <span className="text-sm font-bold [writing-mode:vertical-rl]">{JOURNEY_STAGE_LABEL[s]}</span>
                    </button>
                  ) : (
                    <>
                      <header className="px-1.5 pt-1 pb-2">
                        <h2 className="flex items-center gap-2 font-sans text-sm font-bold">
                          <span className="min-w-0 flex-1 truncate">{JOURNEY_STAGE_LABEL[s]}</span>
                          <span className="rounded-full bg-paper px-2 tabular ring-1 ring-line">{list.length}</span>
                          <button
                            type="button"
                            onClick={toggleCollapse}
                            className="inline-flex size-7 items-center justify-center rounded-lg text-ink-soft hover:bg-paper hover:text-ink"
                            aria-label={`Recolher ${JOURNEY_STAGE_LABEL[s]}`}
                            title="Recolher"
                          >
                            <ChevronsLeftRight className="size-3.5" aria-hidden />
                          </button>
                        </h2>
                        <p className="text-xs text-ink-soft">{JOURNEY_STAGE_HINT[s]}</p>
                        {stale ? (
                          <p className="mt-1 text-xs font-bold text-erp-ink">
                            {stale} parado{stale === 1 ? "" : "s"} há tempo demais
                          </p>
                        ) : null}
                      </header>
                      <ul className="thin-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-0.5">
                        {list.slice(0, limit).map((c) => (
                          <Card key={c.id} {...cardProps(c)} />
                        ))}
                        {list.length === 0 ? <li className="rounded-xl border border-dashed border-ink/15 p-4 text-center text-xs text-ink-soft">{dragId ? "Solte aqui" : "Ninguém aqui"}</li> : null}
                        {list.length > limit ? (
                          <li>
                            <button type="button" onClick={() => setMore((m) => ({ ...m, [s]: limit + PAGE }))} className="min-h-10 w-full rounded-xl text-sm font-semibold text-crm hover:bg-paper">
                              Mostrar mais {Math.min(PAGE, list.length - limit)} de {list.length - limit}
                            </button>
                          </li>
                        ) : null}
                      </ul>
                    </>
                  )}
                </section>
              );
            })}
          </div>

          {/* Celular/tablet: etapa por etapa */}
          <div className="lg:hidden">
            <nav aria-label="Etapas" className="thin-scroll -mx-3 mb-3 overflow-x-auto px-3 sm:-mx-5 sm:px-5">
              <ul className="flex w-max gap-1.5">
                {JOURNEY_STAGES.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => setMobileStage(s)}
                      aria-pressed={mobileStage === s}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1",
                        mobileStage === s ? "bg-ink text-white ring-ink" : "bg-paper ring-line",
                      )}
                    >
                      {JOURNEY_STAGE_LABEL[s]}
                      <span className="tabular opacity-70">{byStage(s).length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <p className="mb-2 text-sm text-ink-soft">{JOURNEY_STAGE_HINT[mobileStage]}</p>
            <ul className="space-y-2">
              {byStage(mobileStage)
                .slice(0, more[mobileStage] ?? PAGE)
                .map((c) => (
                  <Card key={c.id} {...cardProps(c)} />
                ))}
              {byStage(mobileStage).length === 0 ? <li className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">Ninguém nesta etapa.</li> : null}
              {byStage(mobileStage).length > (more[mobileStage] ?? PAGE) ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setMore((m) => ({ ...m, [mobileStage]: (m[mobileStage] ?? PAGE) + PAGE }))}
                    className="min-h-11 w-full rounded-xl text-sm font-semibold text-crm hover:bg-paper"
                  >
                    Mostrar mais
                  </button>
                </li>
              ) : null}
            </ul>
          </div>
        </>
      )}

      {/* ------------------------- Aviso / desfazer (rodapé) ------------------------- */}
      {notice ? (
        <div
          role={notice.ok ? "status" : "alert"}
          className={cn(
            "fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-xl lg:bottom-6",
            notice.ok ? "bg-ink text-white" : "bg-alert text-white",
          )}
        >
          <span className="min-w-0 flex-1">{undo && notice.ok ? `${undo.card.name} foi para ${JOURNEY_STAGE_LABEL[undo.to]}.` : notice.text}</span>
          {undo && notice.ok ? (
            <button type="button" onClick={undoMove} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 hover:bg-white/25">
              <Undo2 className="size-4" aria-hidden />
              Desfazer
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setUndo(null);
            }}
            className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/15"
            aria-label="Fechar aviso"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* ------------------------------ Motivo da perda ------------------------------ */}
      <Dialog open={!!lostFor} onClose={() => setLostFor(null)} title="Marcar como perdido" description={lostFor ? `${lostFor.label}: o motivo ajuda a melhorar o atendimento.` : undefined}>
        {lostFor ? (
          <form
            action={(form) => {
              submit(lostFor.ids, "perdido", String(form.get("lostReason") ?? ""));
            }}
            className="space-y-4"
          >
            <TextareaField
              label="Motivo"
              name="lostReason"
              id="lost-reason"
              required
              placeholder="Ex.: achou o valor alto, escolheu outra clínica, não respondeu"
              error={bulkState.errors?.lostReason}
            />
            {data.lostReasons.length ? (
              <p className="text-xs text-ink-soft">
                Motivos mais comuns:{" "}
                {data.lostReasons
                  .filter((r) => r.reason !== "sem motivo")
                  .slice(0, 3)
                  .map((r) => r.reason)
                  .join("; ")}
              </p>
            ) : null}
            <SubmitButton variant="danger">Marcar como perdido</SubmitButton>
          </form>
        ) : null}
      </Dialog>

      {/* ------------------------------ Tarefa rápida ------------------------------ */}
      <NextStepDialog card={nextFor} onClose={closeNext} />
      <Dialog open={!!taskFor} onClose={() => setTaskFor(null)} title="Nova tarefa" description={taskFor ? `Para ${taskFor.name}. Aparece em Hoje e em Tarefas.` : undefined}>
        {taskFor ? (
          <form action={taskAction} className="space-y-4">
            <input type="hidden" name="contactId" value={taskFor.id} />
            <Field
              label="O que fazer"
              name="title"
              id="task-title"
              required
              defaultValue={taskFor.stage === "reativar" ? `Ligar para ${taskFor.name.split(" ")[0]} e oferecer retorno` : `Retomar contato com ${taskFor.name.split(" ")[0]}`}
              error={taskState.errors?.title}
            />
            <Field label="Para quando" name="dueDate" id="task-due" type="date" error={taskState.errors?.dueDate} />
            <SubmitButton>Criar tarefa</SubmitButton>
          </form>
        ) : null}
      </Dialog>

      {/* ------------------------------ Personalizar ------------------------------ */}
      <Dialog open={settings} onClose={() => setSettings(false)} title="Personalizar a jornada" description="Fica salvo neste navegador.">
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Cartões</legend>
            <div role="group" aria-label="Densidade" className="mb-3 flex rounded-xl bg-fog p-1">
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
            <div className="space-y-2">
              <Check checked={prefs.showFunnel} onChange={(v) => update({ showFunnel: v })} label="Mostrar o funil de 90 dias no topo" />
              <Check checked={prefs.showOwner} onChange={(v) => update({ showOwner: v })} label="Mostrar responsável" />
              <Check checked={prefs.showSource} onChange={(v) => update({ showSource: v })} label="Mostrar origem" />
              <Check checked={prefs.showTags} onChange={(v) => update({ showTags: v })} label="Mostrar etiquetas" />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Etapas no quadro</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {JOURNEY_STAGES.map((s) => (
                <Check
                  key={s}
                  checked={!prefs.hiddenStages.includes(s)}
                  onChange={(v) => update({ hiddenStages: v ? prefs.hiddenStages.filter((x) => x !== s) : [...prefs.hiddenStages, s] })}
                  label={JOURNEY_STAGE_LABEL[s]}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-soft">Dica: o botão ao lado do número de cada coluna recolhe a etapa sem escondê-la.</p>
          </fieldset>
          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
            <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
              <RotateCcw className="size-4" aria-hidden />
              Voltar ao padrão
            </button>
            <button type="button" onClick={() => setSettings(false)} className="inline-flex min-h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white">
              Pronto
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--color-crm)]" />
      {label}
    </label>
  );
}
