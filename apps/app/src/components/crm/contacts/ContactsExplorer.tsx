"use client";

/**
 * CONTATOS (leads e pacientes) — parte interativa
 *
 *  - Base em números: barra Leads x Pacientes, novos em 30 dias, consentimento
 *    e aniversariantes (clique filtra)
 *  - Busca enquanto digita (nome, celular ou e-mail, sem acento)
 *  - Filtros: tipo, etapa, segmentos prontos, canal, origem, etiqueta, responsável;
 *    cada filtro ativo vira uma "pílula" que se remove com um toque
 *  - Tabela (colunas à escolha) ou cartões; densidade; itens por página
 *  - Seleção em lote: etiqueta, responsável, etapa e exportar selecionados
 *  - Ações rápidas na linha: conversar, agendar, copiar celular, abrir ficha
 *
 * Os filtros ficam na URL (dá para salvar o link de uma lista) e a
 * personalização (visão, colunas, densidade) fica no navegador.
 */
import { CHANNEL_LABEL, JOURNEY_STAGE_LABEL, JOURNEY_STAGES, type JourneyStage } from "@ecosaude/core/crm";
import { AlertTriangle, Cake, CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, Download, FileHeart, LayoutGrid, MessagesSquare, Rows3, Search, Settings2, ShieldCheck, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { NewContactButton } from "@/components/crm/patients/ContactForm";
import { PatientLink } from "@/components/crm/widgets";
import { Dialog, SubmitButton, TextareaField } from "@/components/ui";
import { Avatar, Badge, ChannelBadge, PageHeader, StageBadge } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { bulkTagAction } from "@/modules/crm/actions/contacts-bulk";
import { assignOwnerAction, bulkMoveStageAction } from "@/modules/crm/actions/journey";
import { formatPhone } from "@/modules/crm/format";
import { COLUMNS, DEFAULT_CONTACTS_PREFS, type ColumnId, type ContactRow, type ContactsData } from "./types";

export function ContactsExplorer({ data, actions }: { data: ContactsData; /** Botões extras no topo (ex.: cadastro pelo Prontuário) */ actions?: ReactNode }) {
  const router = useRouter();
  const [prefs, update, reset] = useStoredPrefs("eco:contatos:prefs:v1", DEFAULT_CONTACTS_PREFS);
  const p = data.params;
  // Lista com escopo (Pacientes ou Leads) ou a lista antiga, que mistura os dois
  const base = data.scope?.path ?? "/crm/contatos";
  const crm = data.crm !== false;
  const searchRef = useRef<HTMLInputElement>(null);

  /** URL com os filtros atuais + mudanças (mudar filtro volta para a página 1) */
  const href = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next: Record<string, string | undefined> = { ...p, ...patch };
    if (!keepPage && !("pagina" in patch)) delete next.pagina;
    const sp = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => !!e[1]));
    const s = sp.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const go = (patch: Record<string, string | undefined>) => router.push(href(patch), { scroll: false });

  /* ------------------------------ Busca ao digitar ------------------------------ */
  const [q, setQ] = useState(p.q ?? "");
  const [lastQ, setLastQ] = useState(p.q ?? "");
  if ((p.q ?? "") !== lastQ) {
    // A URL mudou por fora (ex.: "Limpar filtros"): a caixa acompanha
    setLastQ(p.q ?? "");
    setQ(p.q ?? "");
  }
  const pushSearch = useEffectEvent((value: string) => {
    if (value.trim() === (p.q ?? "")) return;
    router.replace(href({ q: value.trim() || undefined }), { scroll: false });
  });
  useEffect(() => {
    const t = window.setTimeout(() => pushSearch(q), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  // Atalho "/" para buscar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || t.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* --------------------------------- Seleção --------------------------------- */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = data.rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allOnPage = data.rows.length > 0 && ids.length === data.rows.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const canBulk = data.canEdit || data.canStage || data.canExport;

  /* --------------------------------- Lote --------------------------------- */
  const [tagState, tagAction] = useActionState(bulkTagAction, {});
  const [ownerState, ownerAction] = useActionState(assignOwnerAction, {});
  const [stageState, stageAction] = useActionState(bulkMoveStageAction, {});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [lost, setLost] = useState(false);
  const [settings, setSettings] = useState(false);
  const [seen, setSeen] = useState({ tagState, ownerState, stageState });
  if (seen.tagState !== tagState || seen.ownerState !== ownerState || seen.stageState !== stageState) {
    const changed = tagState !== seen.tagState ? tagState : ownerState !== seen.ownerState ? ownerState : stageState;
    setSeen({ tagState, ownerState, stageState });
    if (changed.message) setNotice({ ok: !!changed.ok, text: changed.message });
    if (changed.ok) {
      setSelected(new Set());
      setLost(false);
    }
  }
  const refresh = useEffectEvent(() => router.refresh());
  useEffect(() => {
    if (tagState.ok || ownerState.ok || stageState.ok) refresh();
  }, [tagState, ownerState, stageState]);

  const moveSelected = (stage: JourneyStage) => {
    if (stage === "perdido") {
      setLost(true);
      return;
    }
    const form = new FormData();
    ids.forEach((id) => form.append("id", id));
    form.set("stage", stage);
    startTransition(() => stageAction(form));
  };

  /* ------------------------------ Filtros ativos ------------------------------ */
  const pills: { key: string; label: string }[] = [];
  if (p.tipo && !data.scope) pills.push({ key: "tipo", label: p.tipo === "lead" ? "Interessados" : "Pacientes" });
  if (p.etapa) pills.push({ key: "etapa", label: JOURNEY_STAGE_LABEL[p.etapa as JourneyStage] ?? p.etapa });
  if (p.segmento) pills.push({ key: "segmento", label: data.segments[p.segmento]?.label ?? p.segmento });
  if (p.canal) pills.push({ key: "canal", label: CHANNEL_LABEL[p.canal as keyof typeof CHANNEL_LABEL] ?? p.canal });
  if (p.origem) pills.push({ key: "origem", label: `Origem: ${p.origem}` });
  if (p.etiqueta) pills.push({ key: "etiqueta", label: `Etiqueta: ${p.etiqueta}` });
  if (p.dono) pills.push({ key: "dono", label: p.dono === "-" ? "Sem responsável" : `Responsável: ${data.team.find((u) => u.id === p.dono)?.name ?? "?"}` });
  if (p.q) pills.push({ key: "q", label: `“${p.q}”` });

  const st = data.stats;
  // Exportação: os mesmos filtros (e o tipo da lista, quando há escopo)
  const exportHref = `/api/contatos/exportar${href(data.scope ? { tipo: data.scope.kind } : {}).replace(base, "")}`;
  const select = "min-h-9 max-w-48 rounded-lg bg-paper px-2 text-sm ring-1 ring-line";

  return (
    <>
      <PageHeader
        title={data.scope?.title ?? "Contatos"}
        description={data.scope?.description ?? "Interessados e pacientes num lugar só. Clique no nome para ver o resumo sem sair da lista."}
        actions={
          <>
            {data.canEdit ? (
              <Link href="/crm/contatos/duplicados" className={buttonStyles("secondary")}>
                <Users className="size-4" aria-hidden /> Possíveis duplicados
              </Link>
            ) : null}
            {data.privacy ? (
              <Link href="/crm/contatos/privacidade" className={buttonStyles(data.privacy.late ? "danger" : "secondary")} title="Pedidos de exclusão e de cópia dos dados (LGPD)">
                <ShieldCheck className="size-4" aria-hidden /> Pedidos LGPD
                {data.privacy.open ? <span className="rounded-full bg-ink px-1.5 text-xs text-white tabular">{data.privacy.open}</span> : null}
              </Link>
            ) : null}
            {data.canExport ? (
              <a href={exportHref} className={buttonStyles("secondary")} title="Planilha com os contatos deste filtro (até 5.000)">
                <Download className="size-4" aria-hidden /> Exportar
              </a>
            ) : null}
            {actions}
            {data.canEdit ? <NewContactButton label={data.newLabel} asPatient={data.scope?.kind === "paciente"} /> : null}
          </>
        }
      />

      {/* ------------------------------ A base em números ------------------------------ */}
      <section aria-label="A base de contatos" className="mb-4 grid gap-3 rounded-2xl bg-paper p-4 ring-1 ring-line lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-3xl font-bold tabular">{st.total}</span>
            <span className="text-ink-soft">{data.scope ? (data.scope.kind === "paciente" ? (st.total === 1 ? "paciente" : "pacientes") : st.total === 1 ? "lead" : "leads") : st.total === 1 ? "contato" : "contatos"} na base</span>
          </p>
          {/* Lista com escopo: atalho para a outra lista; sem escopo, a barra leads x pacientes é o filtro */}
          {data.scope ? (
            <p className="mt-2 text-sm text-ink-soft">
              {data.scope.kind === "paciente" ? "Pacientes da clínica: cadastrados como paciente, com consulta marcada ou já atendidos." : "Leads: quem conversou com a clínica e ainda não marcou consulta."}
              {data.scope.other ? (
                <>
                  {" "}
                  <Link href={data.scope.other.href} className="font-semibold text-crm hover:underline">
                    {data.scope.other.label} ({data.scope.other.count})
                  </Link>
                </>
              ) : null}
            </p>
          ) : (
          <>
          <div className="mt-3 flex h-9 overflow-hidden rounded-xl ring-1 ring-line" role="group" aria-label="Filtrar por tipo">
            <Link
              href={href({ tipo: p.tipo === "lead" ? undefined : "lead" })}
              aria-current={p.tipo === "lead" ? "true" : undefined}
              className={cn(
                "flex min-w-[6.5rem] items-center justify-between gap-2 px-3 text-sm font-semibold transition",
                p.tipo === "lead" ? "bg-crm text-white" : "bg-crm-tint text-crm hover:brightness-95",
              )}
              style={{ flexGrow: Math.max(st.leads, 1) }}
            >
              Interessados <span className="tabular">{st.leads}</span>
            </Link>
            <Link
              href={href({ tipo: p.tipo === "paciente" ? undefined : "paciente" })}
              aria-current={p.tipo === "paciente" ? "true" : undefined}
              className={cn(
                "flex min-w-[7.5rem] items-center justify-between gap-2 px-3 text-sm font-semibold transition",
                p.tipo === "paciente" ? "bg-ok text-white" : "bg-ok-tint text-ok-ink hover:brightness-95",
              )}
              style={{ flexGrow: Math.max(st.pacientes, 1) }}
            >
              Pacientes <span className="tabular">{st.pacientes}</span>
            </Link>
          </div>
          <p className="mt-1.5 text-xs text-ink-soft">Paciente é quem está cadastrado como paciente, tem consulta marcada ou já foi atendido; interessado é quem ainda não marcou.</p>
          </>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-2">
          <Stat href={href({ segmento: p.segmento === "novos" ? undefined : "novos" })} active={p.segmento === "novos"} label="Novos em 30 dias" value={String(st.novos30)} />
          <Stat
            href={href({ segmento: p.segmento === "sem_consentimento" ? undefined : "sem_consentimento" })}
            active={p.segmento === "sem_consentimento"}
            label="Sem consentimento LGPD"
            value={String(st.semConsent)}
          />
          <Stat
            href={href({ segmento: p.segmento === "aniversariantes" ? undefined : "aniversariantes" })}
            active={p.segmento === "aniversariantes"}
            label="Aniversariantes do mês"
            value={String(st.aniversariantes)}
          />
        </dl>
      </section>

      {/* ---------------------------------- Busca e visão ---------------------------------- */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <label htmlFor="busca-contatos" className="sr-only">
            Buscar contato
          </label>
          <input
            ref={searchRef}
            id="busca-contatos"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, celular ou e-mail (/)"
            className="min-h-11 w-full rounded-xl bg-paper pr-3 pl-9 ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
          />
        </div>
        <label htmlFor="contatos-ordem" className="sr-only">
          Ordenar por
        </label>
        <select
          id="contatos-ordem"
          value={p.ordem ?? "interacao"}
          onChange={(e) => go({ ordem: e.target.value === "interacao" ? undefined : e.target.value })}
          className={cn(select, "min-h-11 rounded-xl")}
        >
          {Object.entries(data.sorts).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Visão" className="flex rounded-xl bg-paper p-1 ring-1 ring-line">
          {(["tabela", "cartoes"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={prefs.view === v}
              onClick={() => update({ view: v })}
              className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", prefs.view === v ? "bg-ink text-white" : "text-ink-soft hover:text-ink")}
            >
              {v === "tabela" ? <Rows3 className="size-4" aria-hidden /> : <LayoutGrid className="size-4" aria-hidden />}
              <span className="hidden sm:inline">{v === "tabela" ? "Tabela" : "Cartões"}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSettings(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-paper px-3.5 text-sm font-semibold ring-1 ring-line hover:ring-crm"
          aria-label="Personalizar a lista"
        >
          <Settings2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">Personalizar</span>
        </button>
      </div>

      {/* ---------------------------------- Filtros ---------------------------------- */}
      <nav aria-label="Filtrar por etapa" className="thin-scroll -mx-3 mb-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1.5">
          <li>
            <Link href={href({ etapa: undefined })} aria-current={!p.etapa ? "page" : undefined} className={chip(!p.etapa)}>
              Todas as etapas
            </Link>
          </li>
          {JOURNEY_STAGES.map((s) => (
            <li key={s}>
              <Link href={href({ etapa: p.etapa === s ? undefined : s })} aria-current={p.etapa === s ? "page" : undefined} className={chip(p.etapa === s)}>
                {JOURNEY_STAGE_LABEL[s]} <span className="tabular opacity-70">{data.stageCounts[s] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Segmentos prontos" className="thin-scroll -mx-3 mb-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1.5">
          {Object.entries(data.segments).map(([k, s]) => (
            <li key={k}>
              <Link
                href={href({ segmento: p.segmento === k ? undefined : k })}
                aria-current={p.segmento === k ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ring-1",
                  p.segmento === k ? "bg-crm text-white ring-crm" : "bg-paper text-ink-soft ring-line hover:text-ink",
                )}
              >
                {k === "aniversariantes" ? <Cake className="size-3.5" aria-hidden /> : null}
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {data.facets.channels.length > 1 ? (
          <select aria-label="Canal preferido" value={p.canal ?? ""} onChange={(e) => go({ canal: e.target.value || undefined })} className={select}>
            <option value="">Todos os canais</option>
            {data.facets.channels.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        ) : null}
        {data.facets.sources.length ? (
          <select aria-label="Origem" value={p.origem ?? ""} onChange={(e) => go({ origem: e.target.value || undefined })} className={select}>
            <option value="">Todas as origens</option>
            {data.facets.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : null}
        {data.facets.tags.length ? (
          <select aria-label="Etiqueta" value={p.etiqueta ?? ""} onChange={(e) => go({ etiqueta: e.target.value || undefined })} className={select}>
            <option value="">Todas as etiquetas</option>
            {data.facets.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : null}
        <select aria-label="Responsável" value={p.dono ?? ""} onChange={(e) => go({ dono: e.target.value || undefined })} className={select}>
          <option value="">Todos os responsáveis</option>
          <option value="-">Sem responsável</option>
          {data.team.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* Pílulas dos filtros ativos + total */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-live="polite">
        <span className="mr-1 text-sm font-semibold">
          {data.total} {data.total === 1 ? "contato" : "contatos"}
          {pills.length ? " neste filtro" : ""}
        </span>
        {pills.map((f) => (
          <Link
            key={f.key}
            href={href({ [f.key]: undefined })}
            className="inline-flex min-h-8 items-center gap-1 rounded-full bg-ink px-2.5 text-xs font-semibold text-white"
            aria-label={`Remover filtro ${f.label}`}
          >
            {f.label}
            <X className="size-3.5" aria-hidden />
          </Link>
        ))}
        {pills.length > 1 ? (
          <Link href={base} className="text-xs font-semibold text-crm hover:underline">
            Limpar tudo
          </Link>
        ) : null}
      </div>
      {p.segmento && data.segments[p.segmento] ? <p className="mb-3 rounded-xl bg-crm-tint px-3 py-2 text-sm text-crm">{data.segments[p.segmento]!.hint}</p> : null}

      {/* ---------------------------------- Ações em lote ---------------------------------- */}
      {ids.length ? (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-white shadow-lg" role="region" aria-label="Ações em lote">
          <span className="font-semibold">
            {ids.length} {ids.length === 1 ? "selecionado" : "selecionados"}
          </span>
          <button type="button" onClick={() => setSelected(new Set())} className="min-h-9 rounded-lg px-2 text-sm underline-offset-4 hover:underline">
            Limpar seleção
          </button>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {data.canEdit ? (
              <form action={tagAction} className="flex items-center gap-1">
                {ids.map((id) => (
                  <input key={id} type="hidden" name="id" value={id} />
                ))}
                <label htmlFor="bulk-tag" className="sr-only">
                  Etiqueta
                </label>
                <input id="bulk-tag" name="tag" list="tags-existentes" placeholder="Etiqueta" required maxLength={40} className="min-h-9 w-32 rounded-lg bg-paper px-2 text-sm text-ink" />
                <datalist id="tags-existentes">
                  {data.facets.tags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <button type="submit" name="mode" value="adicionar" className="min-h-9 rounded-lg bg-white/15 px-2.5 text-sm font-semibold hover:bg-white/25">
                  Adicionar
                </button>
                <button type="submit" name="mode" value="remover" className="min-h-9 rounded-lg bg-white/15 px-2.5 text-sm font-semibold hover:bg-white/25">
                  Remover
                </button>
              </form>
            ) : null}
            {data.canStage ? (
              <>
                <form action={ownerAction}>
                  {ids.map((id) => (
                    <input key={id} type="hidden" name="id" value={id} />
                  ))}
                  <select
                    aria-label="Definir responsável"
                    name="ownerId"
                    defaultValue="-"
                    key={ids.join()}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="min-h-9 rounded-lg bg-paper px-2 text-sm font-semibold text-ink"
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
                <select
                  aria-label="Mover para a etapa"
                  value=""
                  onChange={(e) => moveSelected(e.target.value as JourneyStage)}
                  className="min-h-9 rounded-lg bg-paper px-2 text-sm font-semibold text-ink"
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
              </>
            ) : null}
            {data.canExport ? (
              <a href={`/api/contatos/exportar?ids=${ids.join(",")}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white/15 px-2.5 text-sm font-semibold hover:bg-white/25">
                <Download className="size-4" aria-hidden /> Exportar
              </a>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* ---------------------------------- Resultado ---------------------------------- */}
      {data.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/20 px-4 py-10 text-center">
          <p className="font-display text-lg font-bold">Ninguém encontrado</p>
          <p className="mx-auto mt-1 max-w-md text-ink-soft">{p.q ? "Confira a grafia ou busque pelo celular." : "Nenhum contato neste filtro."}</p>
          {pills.length ? (
            <Link href={base} className="mt-2 inline-flex min-h-10 items-center font-semibold text-crm hover:underline">
              Limpar filtros
            </Link>
          ) : null}
        </div>
      ) : prefs.view === "tabela" ? (
        <>
          <div className="thin-scroll relative hidden overflow-x-auto rounded-2xl bg-paper ring-1 ring-line md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-fog text-xs text-ink-soft">
                <tr>
                  {canBulk ? (
                    <th scope="col" className="w-10 px-3">
                      <input
                        type="checkbox"
                        checked={allOnPage}
                        onChange={() => setSelected(allOnPage ? new Set() : new Set(data.rows.map((r) => r.id)))}
                        className="size-4 accent-[var(--color-crm)]"
                        aria-label="Selecionar todos desta página"
                      />
                    </th>
                  ) : null}
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Contato
                  </th>
                  {prefs.columns.map((col) => (
                    <th key={col} scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap">
                      {COLUMNS[col]}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.id} className={cn("group hover:bg-fog/60", selected.has(r.id) && "bg-crm-tint/50")}>
                    {canBulk ? (
                      <td className="px-3">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[var(--color-crm)]" aria-label={`Selecionar ${r.name}`} />
                      </td>
                    ) : null}
                    <td className={cn("px-3", prefs.density === "compacta" ? "py-1.5" : "py-2.5")}>
                      <div className="flex items-center gap-3">
                        {prefs.density === "compacta" ? null : <Avatar name={r.name} size="sm" />}
                        <div className="min-w-0">
                          <NameLink r={r} crm={crm} />
                          <p className="flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                            <KindBadge kind={r.kind} />
                            {r.age !== null ? <span>{r.age} anos</span> : null}
                            <Flags r={r} />
                          </p>
                        </div>
                      </div>
                    </td>
                    {prefs.columns.map((col) => (
                      <td key={col} className="px-3 py-2 align-middle">
                        <Cell col={col} r={r} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <RowActions r={r} canSchedule={data.canSchedule} crm={crm} pep={!!data.pep?.canOpen} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Celular: cartões compactos */}
          <ul className="space-y-2 md:hidden">
            {data.rows.map((r) => (
              <MobileCard key={r.id} r={r} selected={selected.has(r.id)} onToggle={canBulk ? toggle : null} canSchedule={data.canSchedule} crm={crm} pep={!!data.pep?.canOpen} />
            ))}
          </ul>
        </>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.rows.map((r) => (
            <li key={r.id} className={cn("flex flex-col rounded-2xl bg-paper p-4 ring-1 ring-line", selected.has(r.id) && "ring-2 ring-crm")}>
              <div className="flex items-start gap-3">
                <Avatar name={r.name} />
                <div className="min-w-0 flex-1">
                  <NameLink r={r} crm={crm} className="block truncate" />
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                    <KindBadge kind={r.kind} />
                    <StageBadge stage={r.stage} />
                  </p>
                </div>
                {canBulk ? (
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="mt-1 size-4 accent-[var(--color-crm)]" aria-label={`Selecionar ${r.name}`} />
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <Mini label="Celular">{formatPhone(r.phone)}</Mini>
                <Mini label="Próxima consulta">{r.next ?? "nenhuma"}</Mini>
                <Mini label="Última interação">{r.lastInteraction ?? "nunca"}</Mini>
                <Mini label="Consultas">
                  {r.visits}
                  {r.noShows ? (
                    <span className="text-alert">
                      , {r.noShows} falta{r.noShows > 1 ? "s" : ""}
                    </span>
                  ) : null}
                </Mini>
              </dl>
              <p className="mt-2 flex flex-wrap gap-1">
                <Flags r={r} />
                {r.tags.slice(0, 3).map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </p>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2">
                <span className="text-xs text-ink-soft">{r.ownerName ? `com ${r.ownerName}` : "sem responsável"}</span>
                <RowActions r={r} canSchedule={data.canSchedule} crm={crm} pep={!!data.pep?.canOpen} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------- Páginas ---------------------------------- */}
      {data.total > 0 ? (
        <nav aria-label="Páginas" className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {data.page > 1 ? (
            <Link href={href({ pagina: String(data.page - 1) }, true)} className={buttonStyles("secondary")} aria-label="Página anterior">
              <ChevronLeft className="size-4" aria-hidden /> Anterior
            </Link>
          ) : null}
          <span className="px-2 text-sm text-ink-soft tabular">
            Página {data.page} de {data.pages}
          </span>
          {data.page < data.pages ? (
            <Link href={href({ pagina: String(data.page + 1) }, true)} className={buttonStyles("secondary")} aria-label="Próxima página">
              Próxima <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}
          <label className="ml-2 flex items-center gap-1.5 text-sm text-ink-soft">
            Por página
            <select value={String(data.size)} onChange={(e) => go({ por: e.target.value === "30" ? undefined : e.target.value })} className={select}>
              {[30, 60, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </nav>
      ) : null}

      {/* ---------------------------------- Avisos ---------------------------------- */}
      {notice ? (
        <div
          role={notice.ok ? "status" : "alert"}
          className={cn(
            "fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-xl lg:bottom-6",
            notice.ok ? "bg-ink" : "bg-alert",
          )}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/15" aria-label="Fechar aviso">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <Dialog
        open={lost}
        onClose={() => setLost(false)}
        title="Marcar como perdido"
        description={`${ids.length} ${ids.length === 1 ? "contato" : "contatos"}: o motivo ajuda a melhorar o atendimento.`}
      >
        <form action={stageAction} className="space-y-4">
          {ids.map((id) => (
            <input key={id} type="hidden" name="id" value={id} />
          ))}
          <input type="hidden" name="stage" value="perdido" />
          <TextareaField
            label="Motivo"
            name="lostReason"
            id="lost-reason"
            required
            placeholder="Ex.: achou o valor alto, escolheu outra clínica, não respondeu"
            error={stageState.errors?.lostReason}
          />
          <SubmitButton variant="danger">Marcar como perdido</SubmitButton>
        </form>
      </Dialog>

      <Dialog open={settings} onClose={() => setSettings(false)} title="Personalizar a lista" description="Fica salvo neste navegador.">
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Densidade</legend>
            <div role="group" className="flex rounded-xl bg-fog p-1">
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
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Colunas da tabela</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(COLUMNS) as ColumnId[]).map((col) => (
                <label key={col} className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={prefs.columns.includes(col)}
                    onChange={(e) =>
                      // Mantém a ordem original das colunas
                      update({ columns: (Object.keys(COLUMNS) as ColumnId[]).filter((c) => (c === col ? e.target.checked : prefs.columns.includes(c))) })
                    }
                    className="size-4 accent-[var(--color-crm)]"
                  />
                  {COLUMNS[col]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
            <button type="button" onClick={reset} className="min-h-10 text-sm font-semibold text-ink-soft hover:text-ink">
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

/* ---------------------------------- Peças ---------------------------------- */

function chip(active: boolean) {
  return cn(
    "inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 whitespace-nowrap",
    active ? "bg-ink text-white ring-ink" : "bg-paper ring-line hover:ring-ink/30",
  );
}

function Stat({ href, active, label, value }: { href: string; active: boolean; label: string; value: string }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined} className={cn("rounded-xl px-3 py-2 ring-1", active ? "bg-crm-tint ring-crm" : "bg-fog ring-transparent hover:ring-line")}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-display text-2xl font-bold tabular">{value}</dd>
    </Link>
  );
}

function KindBadge({ kind }: { kind: ContactRow["kind"] }) {
  return kind === "paciente" ? <Badge tone="success">Paciente</Badge> : <Badge tone="crm">Interessado</Badge>;
}

function Flags({ r }: { r: ContactRow }) {
  return (
    <>
      {r.birthdayToday ? (
        <Badge tone="warning">
          <Cake className="size-3" aria-hidden /> aniversário hoje
        </Badge>
      ) : null}
      {r.noShows >= 2 ? <Badge tone="alert">{r.noShows} faltas</Badge> : null}
      {r.optedOut ? <Badge>pediu SAIR</Badge> : null}
    </>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="truncate font-semibold">{children}</dd>
    </div>
  );
}

/** Conteúdo de cada coluna opcional */
function Cell({ col, r }: { col: ColumnId; r: ContactRow }) {
  const none = (t: string) => <span className="text-ink-soft">{t}</span>;
  switch (col) {
    case "contato":
      return (
        <span className="block leading-tight">
          <span className="block whitespace-nowrap">{formatPhone(r.phone)}</span>
          {r.email ? <span className="block max-w-56 truncate text-xs text-ink-soft">{r.email}</span> : null}
        </span>
      );
    case "etapa":
      return <StageBadge stage={r.stage} />;
    case "canal":
      return r.channel ? <ChannelBadge channel={r.channel} /> : none("não definido");
    case "origem":
      return r.source ?? none("não informada");
    case "responsavel":
      return r.ownerName ?? none("ninguém");
    case "consulta":
      return <span className="whitespace-nowrap">{r.next ?? none("nenhuma")}</span>;
    case "interacao":
      return <span className="whitespace-nowrap text-ink-soft">{r.lastInteraction ?? "nunca"}</span>;
    case "visitas":
      return (
        <span className="whitespace-nowrap tabular">
          {r.visits} {r.visits === 1 ? "consulta" : "consultas"}
          {r.noShows ? (
            <span className="text-alert">
              , {r.noShows} falta{r.noShows > 1 ? "s" : ""}
            </span>
          ) : null}
        </span>
      );
    case "cadastro":
      return <span className="whitespace-nowrap">{r.createdAt}</span>;
    case "etiquetas":
      return r.tags.length ? (
        <span className="flex flex-wrap gap-1">
          {r.tags.slice(0, 3).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </span>
      ) : (
        none("nenhuma")
      );
  }
}

/** Nome: abre o painel do contato (Atendimento) ou, sem ele, o prontuário */
function NameLink({ r, crm, className }: { r: ContactRow; crm: boolean; className?: string }) {
  const name = (
    <>
      {r.name}
      {r.allergy ? (
        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-alert-tint px-1.5 align-middle text-[0.7rem] font-bold text-alert" title="Tem alergia registrada no prontuário">
          <AlertTriangle className="size-3" aria-hidden />
          Alergia
        </span>
      ) : null}
    </>
  );
  return crm ? (
    <PatientLink id={r.id} name={r.name} className={className}>
      {name}
    </PatientLink>
  ) : (
    <Link href={`/prontuario/pacientes/${r.id}`} className={cn("min-w-0 font-semibold hover:underline", className)}>
      {name}
    </Link>
  );
}

/** Ações rápidas: conversar, agendar, copiar celular, prontuário, abrir ficha */
function RowActions({ r, canSchedule, compact = false, crm = true, pep = false }: { r: ContactRow; canSchedule: boolean; compact?: boolean; crm?: boolean; pep?: boolean }) {
  const [copied, setCopied] = useState(false);
  const btn = "inline-flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-fog hover:text-crm";
  return (
    <span className="inline-flex items-center gap-0.5">
      {crm && r.conversationId ? (
        <Link href={`/crm/conversas/${r.conversationId}`} className={btn} aria-label={`Abrir conversa com ${r.name}`} title="Abrir conversa">
          <MessagesSquare className="size-4" aria-hidden />
        </Link>
      ) : compact ? null : (
        <span className="size-9" aria-hidden />
      )}
      {crm && canSchedule ? (
        <button type="button" onClick={() => emit("eco:open-schedule", { contactId: r.id, contactName: r.name })} className={btn} aria-label={`Agendar para ${r.name}`} title="Agendar">
          <CalendarPlus className="size-4" aria-hidden />
        </button>
      ) : null}
      {r.phone ? (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(formatPhone(r.phone));
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className={btn}
          aria-label={`Copiar celular de ${r.name}`}
          title={copied ? "Copiado" : "Copiar celular"}
        >
          {copied ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      ) : compact ? null : (
        <span className="size-9" aria-hidden />
      )}
      {pep && r.kind === "paciente" ? (
        <Link href={`/prontuario/pacientes/${r.id}`} className={btn} aria-label={`Prontuário de ${r.name}`} title="Prontuário">
          <FileHeart className="size-4 text-pep" aria-hidden />
        </Link>
      ) : null}
      {compact || !crm ? null : (
        <Link href={`/crm/contatos/${r.id}`} className="ml-1 inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-semibold text-crm hover:bg-crm-tint">
          Abrir ficha
        </Link>
      )}
    </span>
  );
}

function MobileCard({ r, selected, onToggle, canSchedule, crm = true, pep = false }: { r: ContactRow; selected: boolean; onToggle: ((id: string) => void) | null; canSchedule: boolean; crm?: boolean; pep?: boolean }) {
  return (
    <li className={cn("rounded-2xl bg-paper p-3 ring-1 ring-line", selected && "ring-2 ring-crm")}>
      <div className="flex items-center gap-3">
        {onToggle ? <input type="checkbox" checked={selected} onChange={() => onToggle(r.id)} className="size-4 shrink-0 accent-[var(--color-crm)]" aria-label={`Selecionar ${r.name}`} /> : null}
        <Avatar name={r.name} />
        <Link href={crm ? `/crm/contatos/${r.id}` : `/prontuario/pacientes/${r.id}`} className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{r.name}</span>
            <KindBadge kind={r.kind} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-soft">
            {r.next ? `Consulta ${r.next}` : r.lastInteraction ? `Falou ${r.lastInteraction}` : formatPhone(r.phone)}
            {r.channel ? `, ${CHANNEL_LABEL[r.channel]}` : ""}
          </span>
        </Link>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex flex-wrap gap-1">
          <StageBadge stage={r.stage} />
          <Flags r={r} />
        </span>
        <RowActions r={r} canSchedule={canSchedule} crm={crm} pep={pep} compact />
      </div>
    </li>
  );
}
