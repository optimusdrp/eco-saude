"use client";

/**
 * TAREFAS (parte interativa)
 *
 *  - Tarefa rápida: datas e @responsável escritos no texto
 *  - Números: atrasadas, para hoje, próximos 7 dias, concluídas na semana (clique filtra)
 *  - Carga da equipe: abertas e atrasadas por pessoa (clique filtra)
 *  - Três visões: LISTA (atrasadas, hoje, amanhã, próximos dias, depois),
 *    SEMANA (um dia por coluna; arraste para mudar a data) e
 *    EQUIPE (uma pessoa por coluna; arraste para trocar o responsável)
 *  - Concluir em um toque, com "Desfazer"; adiar rápido (amanhã, segunda, +7 dias, data)
 *  - Seleção em lote: concluir, adiar, trocar responsável, excluir
 *
 * Mudanças aparecem na hora (otimista) e o servidor confirma em seguida.
 * Atalhos: N nova tarefa, / buscar.
 */
import { addDaysIso } from "@ecosaude/core/crm";
import { CalendarClock, CheckSquare, Columns3, List, Search, Undo2, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useEffectEvent, useOptimistic, useRef, useState, type ReactNode } from "react";
import { TaskButton } from "@/components/crm/TaskTools";
import { PageHeader } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { bulkTaskAction } from "@/modules/crm/actions/tasks";
import { dayLabel, daysFrom, nextMonday } from "./dates";
import { QuickAdd } from "./QuickAdd";
import { TaskCard } from "./TaskCard";
import { DEFAULT_TASKS_PREFS, KIND_LABEL, type TaskItem, type TasksData, type TasksView } from "./types";

type Change = { ids: string[]; op: "concluir" | "reabrir" | "adiar" | "atribuir" | "excluir"; dueDate?: string; assigneeId?: string | null };
type Focus = "atrasadas" | "hoje" | "semana" | "concluidas" | null;
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function TasksBoard({ data }: { data: TasksData }) {
  const router = useRouter();
  const [prefs, update] = useStoredPrefs("eco:tarefas:prefs:v1", DEFAULT_TASKS_PREFS);
  const today = data.today;
  const quickRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ------------------------- Mudanças otimistas ------------------------- */
  const [tasks, apply] = useOptimistic(data.tasks, (state, c: Change) =>
    c.op === "excluir"
      ? state.filter((t) => !c.ids.includes(t.id))
      : state.map((t) =>
          !c.ids.includes(t.id)
            ? t
            : c.op === "concluir"
              ? { ...t, done: true, doneLabel: "agora" }
              : c.op === "reabrir"
                ? { ...t, done: false, doneLabel: null }
                : c.op === "adiar"
                  ? { ...t, dueDate: c.dueDate! }
                  : { ...t, assigneeId: c.assigneeId ?? null, assigneeName: data.team.find((u) => u.id === c.assigneeId)?.name ?? null },
        ),
  );
  const [state, action] = useActionState(bulkTaskAction, {});
  const [toast, setToast] = useState<{ text: string; ok: boolean; undo?: Change } | null>(null);
  const [lastChange, setLastChange] = useState<Change | null>(null);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.message) {
      // "Desfazer" para concluir (reabre) e para adiar/trocar responsável de UMA tarefa
      const c = lastChange;
      let undo: Change | undefined;
      if (state.ok && c?.op === "concluir") undo = { ids: c.ids, op: "reabrir" };
      setToast({ text: state.message, ok: !!state.ok, undo });
    }
  }
  const refresh = useEffectEvent(() => router.refresh());
  useEffect(() => {
    if (state.ok || state.message) refresh();
  }, [state]);

  const run = (c: Change) => {
    if (c.op === "excluir" && !window.confirm(c.ids.length === 1 ? "Excluir esta tarefa?" : `Excluir ${c.ids.length} tarefas?`)) return;
    const form = new FormData();
    c.ids.forEach((id) => form.append("id", id));
    form.set("op", c.op);
    if (c.dueDate) form.set("dueDate", c.dueDate);
    if (c.op === "atribuir") form.set("assigneeId", c.assigneeId ?? "");
    setLastChange(c);
    startTransition(() => {
      apply(c);
      action(form);
    });
  };

  /* -------------------------------- Filtros -------------------------------- */
  const [scope, setScope] = useState(prefs.scope);
  const [lastScopePref, setLastScopePref] = useState(prefs.scope);
  if (prefs.scope !== lastScopePref) {
    // Preferência carregou do navegador depois do primeiro desenho
    setLastScopePref(prefs.scope);
    setScope(prefs.scope);
  }
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<Focus>(null);
  const term = plain(q.trim());

  const inScope = (t: TaskItem) =>
    (scope === "todas" || (scope === "minhas" ? t.assigneeId === data.userId : !t.assigneeId)) &&
    (!person || t.assigneeId === person) &&
    (!kind || t.kind === kind) &&
    (!term || plain(t.title).includes(term) || plain(t.contactName ?? "").includes(term));
  const open = tasks.filter((t) => !t.done);
  const scoped = open.filter(inScope);
  const doneWeek = tasks.filter((t) => t.done && inScope(t));
  const overdue = scoped.filter((t) => t.dueDate < today);
  const forToday = scoped.filter((t) => t.dueDate === today);
  const next7 = scoped.filter((t) => t.dueDate > today && daysFrom(today, t.dueDate) <= 7);
  const shown =
    focus === "concluidas"
      ? doneWeek
      : focus === "atrasadas"
        ? overdue
        : focus === "hoje"
          ? forToday
          : focus === "semana"
            ? next7
            : scoped;

  /* -------------------------------- Seleção -------------------------------- */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = shown.filter((t) => selected.has(t.id)).map((t) => t.id);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const bulk = (c: Omit<Change, "ids">) => {
    run({ ...c, ids });
    setSelected(new Set());
  };

  // Atalhos: N nova tarefa, / buscar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        quickRef.current?.focus();
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* -------------------------------- Arrastar -------------------------------- */
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dropProps = (key: string, onDrop: (t: TaskItem) => void, enabled = true) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!enabled || !dragId || !data.canEdit) return;
      e.preventDefault();
      if (over !== key) setOver(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const t = tasks.find((x) => x.id === e.dataTransfer.getData("text/plain"));
      setOver(null);
      setDragId(null);
      if (t && enabled) onDrop(t);
    },
  });

  const card = (t: TaskItem, narrow = false) => (
    <TaskCard
      key={t.id}
      t={t}
      today={today}
      team={data.team}
      canEdit={data.canEdit}
      compact={prefs.density === "compacta" || narrow}
      narrow={narrow}
      selecting={selecting}
      selected={selected.has(t.id)}
      onToggle={toggle}
      onRun={run}
      draggable={data.canEdit && !t.done && prefs.view !== "lista"}
      onDragStart={setDragId}
      onDragEnd={() => {
        setDragId(null);
        setOver(null);
      }}
    />
  );

  // Carga da equipe (abertas e atrasadas por pessoa, sem filtro de escopo)
  const load = [...data.team.map((u) => ({ id: u.id as string | null, name: u.name })), { id: null, name: "Sem responsável" }]
    .map((u) => ({ ...u, open: open.filter((t) => t.assigneeId === u.id).length, late: open.filter((t) => t.assigneeId === u.id && t.dueDate < today).length }))
    .filter((u) => u.open > 0);
  const maxLoad = Math.max(1, ...load.map((u) => u.open));

  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysIso(today, i));
  const later = addDaysIso(today, 7);

  return (
    <>
      <PageHeader title="Tarefas" description="Lembretes da equipe, com prazo e responsável. As de falta e satisfação baixa são criadas sozinhas." actions={data.canEdit ? <TaskButton team={data.team} today={today} /> : null} />

      {data.canEdit ? <QuickAdd today={today} team={data.team} userId={data.userId} inputRef={quickRef} /> : null}

      {/* -------------------------------- Números -------------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Filtrar por prazo">
        <Kpi on={focus === "atrasadas"} onClick={() => setFocus(focus === "atrasadas" ? null : "atrasadas")} label="Atrasadas" value={overdue.length} tone={overdue.length ? "alert" : undefined} />
        <Kpi on={focus === "hoje"} onClick={() => setFocus(focus === "hoje" ? null : "hoje")} label="Para hoje" value={forToday.length} />
        <Kpi on={focus === "semana"} onClick={() => setFocus(focus === "semana" ? null : "semana")} label="Próximos 7 dias" value={next7.length} />
        <Kpi on={focus === "concluidas"} onClick={() => setFocus(focus === "concluidas" ? null : "concluidas")} label="Concluídas (30 dias)" value={doneWeek.length} tone="success" />
      </div>

      {/* ---------------------------- Carga da equipe ---------------------------- */}
      {load.length > 1 ? (
        <section aria-labelledby="carga-t" className="mb-4 rounded-2xl bg-paper p-4 ring-1 ring-line">
          <h2 id="carga-t" className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Users className="size-4 text-crm" aria-hidden /> Carga da equipe
          </h2>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
            {load.map((u) => (
              <li key={u.id ?? "none"}>
                <button
                  type="button"
                  onClick={() => {
                    if (u.id === null) {
                      setScope("sem_dono");
                      setPerson("");
                    } else {
                      setScope("todas");
                      setPerson(person === u.id ? "" : u.id);
                    }
                  }}
                  aria-pressed={u.id === null ? scope === "sem_dono" : person === u.id}
                  className="block w-full rounded-lg p-1 text-left hover:bg-fog"
                >
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{u.id === data.userId ? `${u.name.split(" ")[0]} (você)` : u.name}</span>
                    <span className="shrink-0 text-xs text-ink-soft tabular">
                      {u.open} aberta{u.open === 1 ? "" : "s"}
                      {u.late ? <span className="font-bold text-alert">, {u.late} atrasada{u.late === 1 ? "" : "s"}</span> : null}
                    </span>
                  </span>
                  <span className="mt-1 flex h-2 overflow-hidden rounded-full bg-fog" aria-hidden>
                    <span className="bg-alert" style={{ width: `${(u.late / maxLoad) * 100}%` }} />
                    <span className="bg-crm" style={{ width: `${((u.open - u.late) / maxLoad) * 100}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------ Barra de filtros ------------------------------ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="De quem" className="flex rounded-xl bg-paper p-1 ring-1 ring-line">
          {(
            [
              ["minhas", "Minhas"],
              ["todas", "Todas"],
              ["sem_dono", "Sem responsável"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={scope === k}
              onClick={() => {
                setScope(k);
                setPerson("");
                update({ scope: k });
              }}
              className={cn("inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold", scope === k ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <label htmlFor="tarefas-q" className="sr-only">
            Buscar tarefa
          </label>
          <input ref={searchRef} id="tarefas-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefa ou paciente (/)" className="block min-h-11 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm" />
        </div>
        {scope === "todas" ? (
          <select aria-label="Responsável" value={person} onChange={(e) => setPerson(e.target.value)} className="min-h-11 max-w-48 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
            <option value="">Todos os responsáveis</option>
            {data.team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : null}
        <select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)} className="min-h-11 max-w-44 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
          <option value="">Todos os tipos</option>
          {[...new Set(data.tasks.map((t) => t.kind))].map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k] ?? k}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Visão" className="flex rounded-xl bg-paper p-1 ring-1 ring-line">
          {(
            [
              ["lista", "Lista", <List key="i" className="size-4" aria-hidden />],
              ["semana", "Semana", <CalendarClock key="i" className="size-4" aria-hidden />],
              ["equipe", "Equipe", <Columns3 key="i" className="size-4" aria-hidden />],
            ] as [TasksView, string, ReactNode][]
          ).map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              aria-pressed={prefs.view === v}
              onClick={() => update({ view: v })}
              className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", prefs.view === v ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setSelecting((v) => !v);
            setSelected(new Set());
          }}
          aria-pressed={selecting}
          className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1", selecting ? "bg-ink text-white ring-ink" : "bg-paper ring-line hover:ring-crm")}
        >
          <CheckSquare className="size-4" aria-hidden />
          <span className="hidden sm:inline">{selecting ? "Cancelar" : "Selecionar"}</span>
        </button>
        <button
          type="button"
          onClick={() => update({ density: prefs.density === "compacta" ? "confortavel" : "compacta" })}
          aria-pressed={prefs.density === "compacta"}
          className="inline-flex min-h-11 items-center rounded-xl bg-paper px-3 text-sm font-semibold ring-1 ring-line hover:ring-crm"
        >
          {prefs.density === "compacta" ? "Confortável" : "Compacta"}
        </button>
      </div>
      {focus ? (
        <p className="mb-3 text-sm">
          Mostrando: <strong>{focus === "atrasadas" ? "atrasadas" : focus === "hoje" ? "para hoje" : focus === "semana" ? "próximos 7 dias" : "concluídas nos últimos 30 dias"}</strong>.{" "}
          <button type="button" onClick={() => setFocus(null)} className="font-semibold text-crm hover:underline">
            Ver todas
          </button>
        </p>
      ) : null}

      {/* ------------------------------ Ações em lote ------------------------------ */}
      {selecting ? (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-white shadow-lg" role="region" aria-label="Ações em lote">
          <span className="font-semibold">
            {ids.length} selecionada{ids.length === 1 ? "" : "s"}
          </span>
          <button type="button" onClick={() => setSelected(new Set(shown.map((t) => t.id)))} className="min-h-9 rounded-lg px-2 text-sm underline-offset-4 hover:underline">
            Todas as {shown.length}
          </button>
          <span className="ml-auto flex flex-wrap gap-2">
            {focus === "concluidas" ? (
              <BulkBtn disabled={!ids.length} onClick={() => bulk({ op: "reabrir" })}>
                Reabrir
              </BulkBtn>
            ) : (
              <BulkBtn disabled={!ids.length} onClick={() => bulk({ op: "concluir" })}>
                Concluir
              </BulkBtn>
            )}
            {data.canEdit ? (
              <>
                <select
                  aria-label="Adiar selecionadas"
                  value=""
                  disabled={!ids.length}
                  onChange={(e) => bulk({ op: "adiar", dueDate: e.target.value })}
                  className="min-h-9 rounded-lg bg-paper px-2 text-sm font-semibold text-ink disabled:opacity-50"
                >
                  <option value="" disabled>
                    Adiar para...
                  </option>
                  <option value={today}>Hoje</option>
                  <option value={addDaysIso(today, 1)}>Amanhã</option>
                  <option value={nextMonday(today)}>Próxima segunda</option>
                  <option value={addDaysIso(today, 7)}>Daqui a 7 dias</option>
                </select>
                <select
                  aria-label="Responsável das selecionadas"
                  value="-"
                  disabled={!ids.length}
                  onChange={(e) => bulk({ op: "atribuir", assigneeId: e.target.value || null })}
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
                <BulkBtn disabled={!ids.length} onClick={() => bulk({ op: "excluir" })}>
                  Excluir
                </BulkBtn>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* -------------------------------- Conteúdo -------------------------------- */}
      {shown.length === 0 && prefs.view === "lista" ? (
        <div className="rounded-2xl border border-dashed border-ink/20 px-4 py-10 text-center">
          <p className="font-display text-lg font-bold">{focus === "concluidas" ? "Nada concluído aqui" : "Nenhuma tarefa aqui"}</p>
          <p className="mx-auto mt-1 max-w-md text-ink-soft">{scope === "minhas" && !focus ? "Você está em dia." : "Nada neste filtro."}</p>
        </div>
      ) : prefs.view === "lista" || focus === "concluidas" ? (
        <div className="space-y-5">
          {(focus === "concluidas"
            ? [{ key: "feitas", title: "Concluídas nos últimos 30 dias", items: shown }]
            : [
                { key: "atrasadas", title: "Atrasadas", items: shown.filter((t) => t.dueDate < today) },
                { key: "hoje", title: "Hoje", items: shown.filter((t) => t.dueDate === today) },
                { key: "amanha", title: "Amanhã", items: shown.filter((t) => t.dueDate === addDaysIso(today, 1)) },
                { key: "semana", title: "Próximos dias", items: shown.filter((t) => t.dueDate > addDaysIso(today, 1) && t.dueDate <= later) },
                { key: "depois", title: "Depois", items: shown.filter((t) => t.dueDate > later) },
              ]
          )
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.key} aria-label={g.title}>
                <h2 className={cn("mb-2 text-sm font-bold", g.key === "atrasadas" && "text-alert")}>
                  {g.title} <span className="font-normal text-ink-soft">({g.items.length})</span>
                </h2>
                <ul className="space-y-2">{g.items.map((t) => card(t))}</ul>
              </section>
            ))}
        </div>
      ) : prefs.view === "semana" ? (
        <div className="thin-scroll grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
          {[
            { key: "atrasadas", title: "Atrasadas", date: null as string | null, items: shown.filter((t) => t.dueDate < today) },
            ...weekDays.map((d) => ({ key: d, title: dayLabel(d, today), date: d, items: shown.filter((t) => t.dueDate === d) })),
            { key: "depois", title: "Depois", date: addDaysIso(today, 14), items: shown.filter((t) => t.dueDate >= later) },
          ].map((col) => (
            <section
              key={col.key}
              aria-label={col.title}
              {...dropProps(col.key, (t) => col.date && t.dueDate !== col.date && run({ ids: [t.id], op: "adiar", dueDate: col.date }), col.date !== null)}
              className={cn("flex min-h-[50dvh] flex-col rounded-2xl bg-ink/[0.04] p-2", col.key === "atrasadas" && "bg-alert-tint/50", over === col.key && "bg-crm-tint ring-2 ring-crm")}
            >
              <h2 className={cn("flex items-center justify-between px-1.5 pt-1 pb-2 text-sm font-bold first-letter:uppercase", col.key === "atrasadas" && "text-alert")}>
                {col.title}
                <span className="rounded-full bg-paper px-2 text-ink tabular ring-1 ring-line">{col.items.length}</span>
              </h2>
              {col.key === "depois" ? <p className="px-1.5 pb-2 text-xs text-ink-soft">Soltar aqui = daqui a 14 dias</p> : null}
              <ul className="space-y-2">{col.items.map((t) => card(t, true))}</ul>
              {col.items.length === 0 && col.date ? <p className="rounded-xl border border-dashed border-ink/15 p-3 text-center text-xs text-ink-soft">{dragId ? "Solte aqui" : "Livre"}</p> : null}
            </section>
          ))}
        </div>
      ) : (
        <div className="thin-scroll grid auto-cols-[minmax(14rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
          {[{ id: null as string | null, name: "Sem responsável" }, ...data.team].map((u) => {
            const items = open.filter((t) => t.assigneeId === u.id && (!kind || t.kind === kind) && (!term || plain(t.title).includes(term) || plain(t.contactName ?? "").includes(term)));
            const key = u.id ?? "none";
            return (
              <section
                key={key}
                aria-label={u.name}
                {...dropProps(key, (t) => t.assigneeId !== u.id && run({ ids: [t.id], op: "atribuir", assigneeId: u.id }))}
                className={cn("flex min-h-[50dvh] flex-col rounded-2xl bg-ink/[0.04] p-2", over === key && "bg-crm-tint ring-2 ring-crm")}
              >
                <h2 className="flex items-center justify-between px-1.5 pt-1 pb-2 text-sm font-bold">
                  <span className="truncate">{u.id === data.userId ? `${u.name.split(" ")[0]} (você)` : u.name}</span>
                  <span className="rounded-full bg-paper px-2 tabular ring-1 ring-line">{items.length}</span>
                </h2>
                <ul className="space-y-2">{items.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((t) => card(t, true))}</ul>
              </section>
            );
          })}
        </div>
      )}

      {/* --------------------------------- Aviso --------------------------------- */}
      {toast ? (
        <div
          role={toast.ok ? "status" : "alert"}
          className={cn(
            "fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-xl lg:bottom-6",
            toast.ok ? "bg-ink" : "bg-alert",
          )}
        >
          <span className="min-w-0 flex-1">{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                const u = toast.undo!;
                setToast(null);
                run(u);
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 hover:bg-white/25"
            >
              <Undo2 className="size-4" aria-hidden /> Desfazer
            </button>
          ) : null}
          <button type="button" onClick={() => setToast(null)} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/15" aria-label="Fechar aviso">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}

function Kpi({ on, onClick, label, value, tone }: { on: boolean; onClick: () => void; label: string; value: number; tone?: "alert" | "success" }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-2xl px-4 py-3 text-left ring-1", on ? "bg-ink text-white ring-ink" : "bg-paper ring-line hover:ring-crm")}>
      <span className={cn("block text-sm", on ? "text-white/80" : "text-ink-soft")}>{label}</span>
      <span className={cn("block font-display text-3xl font-bold tabular", !on && tone === "alert" && value > 0 && "text-alert", !on && tone === "success" && "text-pep-ink")}>{value}</span>
    </button>
  );
}

function BulkBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="min-h-9 rounded-lg bg-white/15 px-3 text-sm font-semibold hover:bg-white/25 disabled:opacity-40">
      {children}
    </button>
  );
}
