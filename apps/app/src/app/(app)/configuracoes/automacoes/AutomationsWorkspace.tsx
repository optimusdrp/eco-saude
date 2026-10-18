"use client";

/**
 * AUTOMAÇÕES: três abas
 *  - Do sistema: liga/desliga (salva na hora) e parâmetros (botão Salvar)
 *  - Regras da clínica: construtor "Quando → Se → Então", receitas prontas
 *  - Histórico: cada execução de regra, com o resultado ou o motivo de não ter rodado
 */
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUSES,
  BUILTIN_GROUP_LABEL,
  BUILTIN_GROUPS,
  CHANNEL_LABEL,
  CHANNELS,
  describeDelay,
  JOURNEY_STAGE_LABEL,
  JOURNEY_STAGES,
  RULE_ACTIONS,
  RULE_CONDITIONS,
  RULE_TRIGGERS,
  templateDef,
  type BuiltinGroup,
  type ParamDef,
  type RuleAction,
  type RuleCondition,
  type RuleFilter,
  type RuleTrigger,
} from "@ecosaude/core/crm";
import { ArrowDown, ArrowUp, Bot, CheckCircle2, CircleSlash, Clock, Lock, MessageSquareText, Pencil, Plus, Sparkles, Trash2, X, XCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { PatientLink } from "@/components/crm/widgets";
import { Dialog, FormMessage, SubmitButton } from "@/components/ui";
import { Badge } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { testAiAction } from "@/modules/crm/actions/ai";
import { deleteRuleAction, ruleFromRecipeAction, ruleFromTextAction, saveBuiltinAction, saveRuleAction, toggleRuleAction } from "@/modules/crm/actions/automations";
import type { RuleTextResult } from "@/modules/crm/ai/rule-text";
import { CrmSettingsForm } from "../forms";

/* --------------------------------- Tipos ----------------------------------- */

export interface BuiltinView {
  key: string;
  group: BuiltinGroup;
  title: string;
  what: string;
  locked: boolean;
  inPlan: boolean;
  config: Record<string, unknown> & { enabled: boolean };
  params: ParamDef[];
  templates: string[];
  href: string;
  where: string;
  week: number;
  /** Situação extra (ex.: IA sem chave no servidor, números da semana) */
  note?: string;
}

export interface RuleView {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  filter: RuleFilter;
  conditions: RuleCondition[];
  actions: RuleAction[];
  delayMinutes: number;
  oncePerContact: boolean;
  runs: number;
  lastRun: string | null;
  pending: number;
}

export interface RunView {
  id: string;
  ruleId: string;
  ruleName: string;
  contactId: string | null;
  contactName: string | null;
  status: "pendente" | "feita" | "ignorada" | "falhou";
  result: string | null;
  when: string;
}

interface ConfirmView {
  inPlan: boolean;
  autoConfirm: boolean;
  confirmHour: number;
  confirmDaysBefore: number;
  lastAutoConfirmOn: string | null;
  week: number;
  lastHour: number;
}

type Tab = "sistema" | "regras" | "historico";

/* ------------------------------ Componente raiz ----------------------------- */

export function AutomationsWorkspace(props: {
  initialTab: Tab;
  builtins: BuiltinView[];
  confirm: ConfirmView;
  rules: RuleView[];
  runs: RunView[];
  recipes: { id: string; title: string; why: string; exists: boolean }[];
  team: { id: string; name: string }[];
  tags: string[];
  canMessages: boolean;
  /** "Criar regra escrevendo em português" ligada em Ajustes > IA */
  ruleTextOn: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const go = (t: Tab) => {
    setTab(t);
    router.replace(t === "sistema" ? path : `${path}?aba=${t}`, { scroll: false });
  };
  const on = props.builtins.filter((b) => b.config.enabled && b.inPlan).length + (props.confirm.autoConfirm && props.confirm.inPlan ? 1 : 0);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "sistema", label: "Do sistema", count: on },
    { id: "regras", label: "Regras da clínica", count: props.rules.filter((r) => r.enabled).length },
    { id: "historico", label: "Histórico" },
  ];

  return (
    <>
      <div role="tablist" aria-label="Automações" className="thin-scroll relative mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-paper p-1 ring-1 ring-line sm:w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`painel-${t.id}`}
            onClick={() => go(t.id)}
            className={cn("inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold", tab === t.id ? "bg-night text-white" : "text-ink-soft hover:text-ink")}
          >
            {t.label}
            {t.count !== undefined ? <span className={cn("rounded-full px-1.5 text-xs tabular", tab === t.id ? "bg-white/20" : "bg-fog")}>{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`painel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "sistema" ? <SystemTab builtins={props.builtins} confirm={props.confirm} canMessages={props.canMessages} /> : null}
        {tab === "regras" ? <RulesTab rules={props.rules} recipes={props.recipes} team={props.team} tags={props.tags} ruleTextOn={props.ruleTextOn} onHistory={() => go("historico")} /> : null}
        {tab === "historico" ? <HistoryTab runs={props.runs} rules={props.rules} /> : null}
      </div>
    </>
  );
}

/* ================================ Do sistema ================================ */

function SystemTab({ builtins, confirm, canMessages }: { builtins: BuiltinView[]; confirm: ConfirmView; canMessages: boolean }) {
  return (
    <div className="space-y-6">
      {/* A IA tem área própria: Ajustes > Inteligência artificial */}
      {BUILTIN_GROUPS.filter((g) => g !== "ia").map((g) => (
        <section key={g} aria-labelledby={`grp-${g}`}>
          <h2 id={`grp-${g}`} className="mb-2 text-lg font-bold">
            {BUILTIN_GROUP_LABEL[g]}
          </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {g === "consultas" ? (
              <li className={cn("rounded-2xl bg-paper p-4 ring-1 ring-line", !confirm.inPlan && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">Confirmação automática</h3>
                  {!confirm.inPlan ? <Badge>fora do plano</Badge> : confirm.autoConfirm ? <Badge tone="success">ligada</Badge> : <Badge>desligada</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  Todo dia, a partir do horário escolhido (até as {confirm.lastHour}h), pede a confirmação das consultas que ainda não receberam o pedido. Ninguém recebe duas vezes.
                </p>
                {confirm.inPlan ? (
                  <div className="mt-3">
                    <CrmSettingsForm initial={{ autoConfirm: confirm.autoConfirm, confirmHour: confirm.confirmHour, confirmDaysBefore: confirm.confirmDaysBefore }} />
                  </div>
                ) : null}
                <Footer
                  week={confirm.week}
                  href="/crm/agenda"
                  where="Agenda"
                  templates={["confirmacao"]}
                  canMessages={canMessages}
                  extra={confirm.lastAutoConfirmOn ? `último envio ${confirm.lastAutoConfirmOn.split("-").reverse().join("/")}` : undefined}
                />
              </li>
            ) : null}
            {builtins
              .filter((b) => b.group === g)
              .map((b) => (
                <BuiltinCard key={b.key} b={b} canMessages={canMessages} />
              ))}
          </ul>
        </section>
      ))}
      <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-crm-tint px-4 py-3 text-sm text-crm">
        <Sparkles className="size-4 shrink-0" aria-hidden />
        As funcionalidades com IA ficam em
        <Link href="/configuracoes/ia" className="font-semibold underline">
          Ajustes &gt; Inteligência artificial
        </Link>
      </p>
    </div>
  );
}

/** Cartão de uma automação do sistema (também usado em Ajustes > Inteligência artificial). */
export function BuiltinCard({ b, canMessages }: { b: BuiltinView; canMessages: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveBuiltinAction, {});
  const [config, setConfig] = useState(b.config);
  const [lastSaved, setLastSaved] = useState(b.config);
  // Os dados do servidor mudaram (salvou): passam a ser a referência
  if (b.config !== lastSaved) {
    setLastSaved(b.config);
    setConfig(b.config);
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const submit = (next: typeof config) => {
    const fd = new FormData();
    fd.set("key", b.key);
    fd.set("config", JSON.stringify(next));
    startTransition(() => action(fd));
  };
  const dirty = JSON.stringify({ ...config, enabled: undefined }) !== JSON.stringify({ ...b.config, enabled: undefined });
  const disabled = !b.inPlan;

  return (
    <li className={cn("flex flex-col rounded-2xl bg-paper p-4 ring-1 ring-line", (!config.enabled || disabled) && "bg-paper/70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{b.title}</h3>
          <p className="mt-1 text-sm text-ink-soft">{b.what}</p>
          {b.note ? <p className="mt-2 rounded-lg bg-fog px-2.5 py-1.5 text-xs text-ink">{b.note}</p> : null}
        </div>
        {b.locked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fog px-2 py-1 text-xs font-semibold text-ink-soft">
            <Lock className="size-3" aria-hidden /> sempre ligada
          </span>
        ) : disabled ? (
          <Badge>fora do plano</Badge>
        ) : (
          <label className="flex shrink-0 cursor-pointer items-center gap-2">
            <span className="text-xs font-semibold text-ink-soft">{config.enabled ? "Ligada" : "Desligada"}</span>
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={pending}
              onChange={(e) => {
                // Ligar/desligar salva na hora (os ajustes abaixo continuam como estão salvos)
                const next = { ...b.config, enabled: e.target.checked };
                setConfig({ ...config, enabled: e.target.checked });
                submit(next);
              }}
              className="peer sr-only"
              aria-label={`${b.title}: ${config.enabled ? "ligada" : "desligada"}`}
            />
            <span
              aria-hidden
              className="relative h-6 w-10 rounded-full bg-ink/20 transition-colors peer-checked:bg-crm peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-crm after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
            />
          </label>
        )}
      </div>

      {b.params.length && config.enabled && !disabled ? (
        <div className="mt-3 space-y-3 rounded-xl bg-fog p-3">
          {b.params.map((p) => (
            <ParamField key={p.key} p={p} value={config[p.key]} onChange={(v) => setConfig({ ...config, [p.key]: v })} id={`${b.key}-${p.key}`} />
          ))}
          {dirty ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => submit(config)} disabled={pending} className={buttonStyles("primary")}>
                {pending ? "Salvando..." : "Salvar ajustes"}
              </button>
              <button type="button" onClick={() => setConfig(b.config)} className={buttonStyles("ghost")}>
                Descartar
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {state.message ? (
        <div className="mt-2">
          <FormMessage state={state} />
        </div>
      ) : null}
      <Footer week={b.week} href={b.href} where={b.where} templates={b.templates} canMessages={canMessages} />
    </li>
  );
}

/** Pergunta fictícia para conferir a chave, o modelo e o tempo de resposta da IA. */
export function TestAi() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-3">
      <button type="button" onClick={() => start(async () => setResult(await testAiAction()))} disabled={pending} className={buttonStyles("secondary")}>
        <Sparkles className={cn("size-4", pending && "animate-pulse")} aria-hidden /> {pending ? "Testando..." : "Testar a IA agora"}
      </button>
      {result ? (
        <p role="status" className={cn("mt-2 rounded-lg px-2.5 py-1.5 text-sm", result.ok ? "bg-pep-tint text-pep-ink" : "bg-erp-tint text-erp-ink")}>
          {result.message}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-ink-soft">O teste usa uma conversa fictícia: nenhum dado de paciente sai do sistema.</p>
    </div>
  );
}

function ParamField({ p, value, onChange, id }: { p: ParamDef; value: unknown; onChange: (v: unknown) => void; id: string }) {
  if (p.type === "boolean") {
    return (
      <label className="flex min-h-10 cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-crm)]" />
        <span>
          <span className="font-semibold">{p.label}</span>
          {p.hint ? <span className="block text-xs text-ink-soft">{p.hint}</span> : null}
        </span>
      </label>
    );
  }
  if (p.type === "select") {
    return (
      <label htmlFor={id} className="block text-sm">
        <span className="font-semibold">{p.label}</span>
        <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="mt-1 block min-h-10 w-full max-w-sm rounded-xl bg-paper px-2 ring-1 ring-line">
          {p.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {p.hint ? <span className="mt-0.5 block text-xs text-ink-soft">{p.hint}</span> : null}
      </label>
    );
  }
  if (p.type === "weekdays") {
    const days = Array.isArray(value) ? (value as number[]) : [];
    return (
      <fieldset className="text-sm">
        <legend className="font-semibold">{p.label}</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => (
            <label key={d} className="cursor-pointer">
              <input type="checkbox" checked={days.includes(i)} onChange={() => onChange(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())} className="peer sr-only" />
              <span className="inline-flex min-h-9 min-w-11 items-center justify-center rounded-lg bg-paper px-2 font-semibold ring-1 ring-line peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-crm">
                {d}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <label htmlFor={id} className="block text-sm">
      <span className="font-semibold">{p.label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type={p.type === "number" ? "number" : p.type === "time" ? "time" : "url"}
          value={String(value ?? "")}
          min={p.type === "number" ? p.min : undefined}
          max={p.type === "number" ? p.max : undefined}
          maxLength={p.type === "text" ? p.maxLength : undefined}
          placeholder={p.type === "text" ? p.placeholder : undefined}
          onChange={(e) => onChange(p.type === "number" ? Number(e.target.value) : e.target.value)}
          className={cn("min-h-10 rounded-xl bg-paper px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-crm", p.type === "text" ? "w-full" : "w-28")}
        />
        {p.type === "number" && p.unit ? <span className="text-ink-soft">{p.unit}</span> : null}
      </span>
      {p.hint ? <span className="mt-0.5 block text-xs text-ink-soft">{p.hint}</span> : null}
    </label>
  );
}

function Footer({ week, href, where, templates, canMessages, extra }: { week: number; href: string; where: string; templates: string[]; canMessages: boolean; extra?: string }) {
  return (
    <div className="mt-auto pt-3">
      {templates.length && canMessages ? (
        <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <MessageSquareText className="size-3.5 text-ink-soft" aria-hidden />
          {templates.map((t) => (
            <Link key={t} href={`/configuracoes/mensagens?msg=${t}`} className="rounded-full bg-crm-tint px-2 py-0.5 font-semibold text-crm hover:bg-crm hover:text-white">
              {templateDef(t)?.label ?? t}
            </Link>
          ))}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs">
        <span className="text-ink-soft">
          {week} {week === 1 ? "vez" : "vezes"} nos últimos 7 dias{extra ? `, ${extra}` : ""}
        </span>
        <Link href={href} className="font-semibold text-crm hover:underline">
          Ver em {where}
        </Link>
      </p>
    </div>
  );
}

/* ============================= Regras da clínica ============================= */

const triggerLabel = (t: string) => RULE_TRIGGERS.find((x) => x.key === t)?.label ?? t;

/** "Quando um contato novo chegou (WhatsApp), se não tem consulta marcada, então criar tarefa, 2 dias depois." */
function describeRule(r: Pick<RuleView, "trigger" | "filter" | "conditions" | "actions" | "delayMinutes">): string {
  const f = r.filter;
  const bits: string[] = [];
  if (f.stage) bits.push(`para ${JOURNEY_STAGE_LABEL[f.stage]}`);
  if (f.status) bits.push(APPOINTMENT_STATUS_LABEL[f.status].toLowerCase());
  if (f.channel) bits.push(CHANNEL_LABEL[f.channel]);
  if (f.keywords) bits.push(`com “${f.keywords}”`);
  if (f.minScore !== undefined || f.maxScore !== undefined) bits.push(`nota ${f.minScore ?? 0} a ${f.maxScore ?? 10}`);
  const when = `Quando: ${triggerLabel(r.trigger).toLowerCase()}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  const cond = r.conditions.length
    ? `. Se: ${r.conditions.map((c) => `${(RULE_CONDITIONS.find((x) => x.key === c.type)?.label ?? c.type).toLowerCase()}${c.value ? ` ${c.type === "stage_in" ? (JOURNEY_STAGE_LABEL[c.value as keyof typeof JOURNEY_STAGE_LABEL] ?? c.value) : `“${c.value}”`}` : ""}`).join(" e ")}`
    : "";
  const then = `. Então: ${r.actions.map((a) => (RULE_ACTIONS.find((x) => x.key === a.type)?.label ?? a.type).toLowerCase()).join(", ")}`;
  return `${when}${cond}${then}, ${describeDelay(r.delayMinutes)}.`;
}

/** Rascunho vindo de uma frase em português (IA ou regras), para revisar no construtor */
type FromText = RuleTextResult & { draftId: string; text: string };

function RulesTab({
  rules,
  recipes,
  team,
  tags,
  ruleTextOn,
  onHistory,
}: {
  rules: RuleView[];
  recipes: { id: string; title: string; why: string; exists: boolean }[];
  team: { id: string; name: string }[];
  tags: string[];
  ruleTextOn: boolean;
  onHistory: () => void;
}) {
  const [editing, setEditing] = useState<RuleView | "new" | FromText | null>(null);
  const close = useCallback(() => setEditing(null), []);
  const fromText = editing && typeof editing === "object" && "draftId" in editing ? editing : null;
  return (
    <div className="space-y-6">
      {ruleTextOn ? <RuleFromText onDraft={setEditing} /> : null}
      <section aria-labelledby="minhas-t">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="minhas-t" className="text-lg font-bold">
            Suas regras
          </h2>
          <button type="button" onClick={() => setEditing("new")} className={buttonStyles("primary")}>
            <Plus className="size-4" aria-hidden /> Nova regra
          </button>
        </div>
        {rules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink/20 p-6 text-center">
            <Bot className="mx-auto size-8 text-crm" aria-hidden />
            <p className="mt-2 font-semibold">Nenhuma regra ainda</p>
            <p className="text-sm text-ink-soft">Comece por uma receita abaixo ou monte a sua: quando acontecer algo, o CRM faz o próximo passo sozinho.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <RuleCard key={r.id} r={r} onEdit={() => setEditing(r)} onHistory={onHistory} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="receitas-t">
        <h2 id="receitas-t" className="mb-1 flex items-center gap-2 text-lg font-bold">
          <Sparkles className="size-5 text-crm" aria-hidden /> Receitas prontas
        </h2>
        <p className="mb-3 text-sm text-ink-soft">Processos que costumam escapar da recepção. Use como estão ou ajuste depois.</p>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {recipes.map((r) => (
            <RecipeCard key={r.id} r={r} />
          ))}
        </ul>
      </section>

      <Dialog
        open={editing !== null}
        onClose={close}
        title={editing === "new" ? "Nova regra" : fromText ? "Revise a regra montada" : editing ? `Editar “${(editing as RuleView).name}”` : "Regra"}
        description={fromText ? "Confira cada passo. A regra só é criada quando você clicar em “Criar e ligar regra”." : "Quando acontecer algo, se a situação for esta, o CRM faz o que você mandar."}
        wide
      >
        {editing ? (
          <RuleBuilder
            key={editing === "new" ? "new" : fromText ? fromText.draftId : (editing as RuleView).id}
            initial={editing === "new" || fromText ? null : (editing as RuleView)}
            fromText={fromText}
            team={team}
            tags={tags}
            onSaved={close}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

/**
 * "Descreva a regra": a frase vira um rascunho no construtor (IA; se falhar, regras).
 * Nada é salvo aqui.
 */
const RULE_TEXT_EXAMPLES = [
  "Quando alguém pedir orçamento e não marcar em 2 dias, crie tarefa para a Paula",
  "Se o paciente faltar e não remarcar em 3 dias, crie tarefa para o responsável",
  "Quando a nota da pesquisa for menor que 7, avise a gestão",
];

function RuleFromText({ onDraft }: { onDraft: (d: FromText) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await ruleFromTextAction(text);
      if (r.ok) onDraft({ ...r, text });
      else setError(r.message);
    });
  };
  return (
    <section aria-labelledby="frase-t" className="rounded-2xl bg-paper p-4 ring-1 ring-line">
      <h2 id="frase-t" className="flex items-center gap-2 text-lg font-bold">
        <Sparkles className="size-5 text-crm" aria-hidden /> Descreva a regra
      </h2>
      <p className="mb-3 text-sm text-ink-soft">Escreva como falaria para a equipe. A regra aparece montada no construtor para você revisar antes de ligar.</p>
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="rule-text" className="sr-only">
          Regra em português
        </label>
        <textarea
          id="rule-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={600}
          placeholder={RULE_TEXT_EXAMPLES[0]}
          className="block w-full rounded-xl bg-fog p-3 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
        />
        {error ? (
          <p role="alert" className="text-sm font-semibold text-alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending || text.trim().length < 10} className={buttonStyles("primary")}>
            <Sparkles className={cn("size-4", pending && "animate-pulse")} aria-hidden /> {pending ? "Montando..." : "Montar regra"}
          </button>
          <span className="text-xs text-ink-soft">Exemplos:</span>
          {RULE_TEXT_EXAMPLES.slice(1).map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full bg-fog px-2.5 py-1 text-left text-xs text-ink-soft ring-1 ring-line hover:text-ink">
              {ex}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}

function RuleCard({ r, onEdit, onHistory }: { r: RuleView; onEdit: () => void; onHistory: () => void }) {
  const router = useRouter();
  const [toggle, toggleAction, toggling] = useActionState(toggleRuleAction, {});
  const [del, delAction] = useActionState(deleteRuleAction, {});
  useEffect(() => {
    if (toggle.ok || del.ok) router.refresh();
  }, [toggle, del, router]);
  return (
    <li className={cn("rounded-2xl bg-paper p-4 ring-1 ring-line", !r.enabled && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {r.name}
            {r.enabled ? <Badge tone="success">ligada</Badge> : <Badge>desligada</Badge>}
            {r.oncePerContact ? <Badge>uma vez por contato</Badge> : null}
          </p>
          <p className="mt-1 text-sm text-ink-soft">{describeRule(r)}</p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
            <span>
              {r.runs} {r.runs === 1 ? "execução" : "execuções"}
            </span>
            {r.lastRun ? <span>última {r.lastRun}</span> : null}
            {r.pending ? (
              <button type="button" onClick={onHistory} className="inline-flex items-center gap-1 font-semibold text-crm hover:underline">
                <Clock className="size-3" aria-hidden /> {r.pending} na espera
              </button>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <form action={toggleAction}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="enabled" value={String(!r.enabled)} />
            <button type="submit" disabled={toggling} className={buttonStyles(r.enabled ? "ghost" : "secondary")}>
              {r.enabled ? "Desligar" : "Ligar"}
            </button>
          </form>
          <button type="button" onClick={onEdit} className={buttonStyles("ghost")} aria-label={`Editar ${r.name}`}>
            <Pencil className="size-4" aria-hidden /> Editar
          </button>
          <form
            action={delAction}
            onSubmit={(e) => {
              if (!window.confirm(`Excluir a regra “${r.name}”? O histórico dela também sai.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={r.id} />
            <button type="submit" className={buttonStyles("ghost", "text-alert hover:bg-alert-tint hover:text-alert")} aria-label={`Excluir ${r.name}`}>
              <Trash2 className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </div>
      {toggle.message && !toggle.ok ? <FormMessage state={toggle} /> : null}
    </li>
  );
}

function RecipeCard({ r }: { r: { id: string; title: string; why: string; exists: boolean } }) {
  const router = useRouter();
  const [state, action] = useActionState(ruleFromRecipeAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <li className="flex flex-col rounded-2xl bg-paper p-4 ring-1 ring-line">
      <h3 className="font-semibold">{r.title}</h3>
      <p className="mt-1 flex-1 text-sm text-ink-soft">{r.why}</p>
      <form action={action} className="mt-3 flex items-center justify-between gap-2">
        <input type="hidden" name="recipe" value={r.id} />
        {r.exists ? <span className="text-xs font-semibold text-pep-ink">já está nas suas regras</span> : <span />}
        <SubmitButton variant={r.exists ? "ghost" : "secondary"} pendingText="Criando...">
          {r.exists ? "Usar de novo" : "Usar esta receita"}
        </SubmitButton>
      </form>
      {state.message && !state.ok ? <FormMessage state={state} /> : null}
    </li>
  );
}

/* ------------------------------ Construtor ---------------------------------- */

const UNITS = [
  { id: "min", label: "minutos", factor: 1 },
  { id: "h", label: "horas", factor: 60 },
  { id: "d", label: "dias", factor: 1440 },
] as const;

function splitDelay(m: number): { value: number; unit: (typeof UNITS)[number]["id"] } {
  if (m && m % 1440 === 0) return { value: m / 1440, unit: "d" };
  if (m && m % 60 === 0) return { value: m / 60, unit: "h" };
  return { value: m, unit: "min" };
}

const input = "min-h-10 w-full rounded-xl bg-paper px-3 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm";

function RuleBuilder({
  initial,
  fromText,
  team,
  tags,
  onSaved,
}: {
  initial: RuleView | null;
  /** Rascunho montado a partir de uma frase (preenche o construtor) */
  fromText?: FromText | null;
  team: { id: string; name: string }[];
  tags: string[];
  onSaved: () => void;
}) {
  const router = useRouter();
  const [state, action] = useActionState(saveRuleAction, {});
  const seed = initial ?? fromText?.draft.rule ?? null;
  const [name, setName] = useState(seed?.name ?? "");
  const [trigger, setTrigger] = useState<RuleTrigger>((seed?.trigger as RuleTrigger) ?? "contact_created");
  const [filter, setFilter] = useState<RuleFilter>(seed?.filter ?? {});
  const [conditions, setConditions] = useState<RuleCondition[]>(seed?.conditions ?? []);
  const [actions, setActions] = useState<RuleAction[]>(seed?.actions ?? [{ type: "create_task", text: "", dueInDays: 0, assignee: "owner" }]);
  const d = splitDelay(seed?.delayMinutes ?? 0);
  const [delayValue, setDelayValue] = useState(d.value);
  const [delayUnit, setDelayUnit] = useState<(typeof UNITS)[number]["id"]>(d.unit);
  const [once, setOnce] = useState(seed?.oncePerContact ?? false);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onSaved();
    }
  }, [state, router, onSaved]);

  const delayMinutes = Math.max(0, Math.round(delayValue || 0)) * UNITS.find((u) => u.id === delayUnit)!.factor;
  // Só o filtro que faz sentido para o gatilho escolhido vai junto
  const cleanFilter: RuleFilter = {
    ...(trigger === "stage_changed" && filter.stage ? { stage: filter.stage } : {}),
    ...(trigger === "appointment_status" && filter.status ? { status: filter.status } : {}),
    ...((trigger === "contact_created" || trigger === "message_in") && filter.channel ? { channel: filter.channel } : {}),
    ...(trigger === "message_in" && filter.keywords?.trim() ? { keywords: filter.keywords.trim() } : {}),
    ...(trigger === "nps" && filter.minScore !== undefined ? { minScore: filter.minScore } : {}),
    ...(trigger === "nps" && filter.maxScore !== undefined ? { maxScore: filter.maxScore } : {}),
  };
  const rule = { name, trigger, filter: cleanFilter, conditions, actions, delayMinutes, oncePerContact: once };
  const setAction = (i: number, patch: Partial<RuleAction>) => setActions((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const move = (i: number, dir: -1 | 1) =>
    setActions((list) => {
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(i + dir, 0, x!);
      return next;
    });

  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      {fromText ? <input type="hidden" name="draftId" value={fromText.draftId} /> : null}
      <input type="hidden" name="rule" value={JSON.stringify(rule)} />
      {fromText ? <FromTextSummary f={fromText} /> : null}
      <datalist id="rule-tags">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <label className="block text-sm">
        <span className="font-semibold">Nome da regra</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Retomar contato novo sem consulta" className={cn(input, "mt-1")} />
      </label>

      {/* QUANDO */}
      <Step n="Quando" hint="O que precisa acontecer para a regra começar.">
        <select value={trigger} onChange={(e) => setTrigger(e.target.value as RuleTrigger)} className={input} aria-label="Gatilho">
          {RULE_TRIGGERS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-soft">{RULE_TRIGGERS.find((t) => t.key === trigger)?.hint}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {trigger === "stage_changed" ? (
            <select value={filter.stage ?? ""} onChange={(e) => setFilter({ ...filter, stage: e.target.value as RuleFilter["stage"] })} className={input} aria-label="Para qual etapa">
              <option value="">Qualquer etapa</option>
              {JOURNEY_STAGES.map((s) => (
                <option key={s} value={s}>
                  Foi para {JOURNEY_STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          ) : null}
          {trigger === "appointment_status" ? (
            <select value={filter.status ?? ""} onChange={(e) => setFilter({ ...filter, status: e.target.value as RuleFilter["status"] })} className={input} aria-label="Status novo">
              <option value="">Qualquer status</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {APPOINTMENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : null}
          {trigger === "contact_created" || trigger === "message_in" ? (
            <select value={filter.channel ?? ""} onChange={(e) => setFilter({ ...filter, channel: e.target.value as RuleFilter["channel"] })} className={input} aria-label="Canal">
              <option value="">Qualquer canal</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          ) : null}
          {trigger === "message_in" ? (
            <input
              value={filter.keywords ?? ""}
              onChange={(e) => setFilter({ ...filter, keywords: e.target.value })}
              placeholder="Palavras, separadas por vírgula (vazio = qualquer)"
              className={input}
              aria-label="Palavras"
            />
          ) : null}
          {trigger === "nps" ? (
            <div className="flex items-center gap-2 text-sm">
              Nota de
              <input
                type="number"
                min={0}
                max={10}
                value={filter.minScore ?? 0}
                onChange={(e) => setFilter({ ...filter, minScore: Number(e.target.value) })}
                className={cn(input, "w-20")}
                aria-label="Nota mínima"
              />
              a
              <input
                type="number"
                min={0}
                max={10}
                value={filter.maxScore ?? 10}
                onChange={(e) => setFilter({ ...filter, maxScore: Number(e.target.value) })}
                className={cn(input, "w-20")}
                aria-label="Nota máxima"
              />
            </div>
          ) : null}
        </div>
      </Step>

      {/* ESPERA */}
      <Step n="Esperar" hint="Na hora, ou depois de um tempo. As condições são conferidas no fim da espera.">
        <div className="flex flex-wrap items-center gap-2">
          <input type="number" min={0} value={delayValue} onChange={(e) => setDelayValue(Number(e.target.value))} className={cn(input, "w-24")} aria-label="Tempo de espera" />
          <select value={delayUnit} onChange={(e) => setDelayUnit(e.target.value as typeof delayUnit)} className={cn(input, "w-32")} aria-label="Unidade">
            {UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-ink-soft">({describeDelay(delayMinutes)})</span>
        </div>
      </Step>

      {/* SE */}
      <Step n="Se" hint="Opcional. Todas precisam valer na hora de executar.">
        <ul className="space-y-2">
          {conditions.map((c, i) => {
            const def = RULE_CONDITIONS.find((x) => x.key === c.type)!;
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={c.type}
                  onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { type: e.target.value as RuleCondition["type"] } : x)))}
                  className={cn(input, "min-w-0 flex-1 basis-56")}
                  aria-label={`Condição ${i + 1}`}
                >
                  {RULE_CONDITIONS.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
                {def.needs === "stage" ? (
                  <select
                    value={c.value ?? ""}
                    onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    className={cn(input, "w-48")}
                    aria-label="Etapa"
                  >
                    <option value="">Escolha...</option>
                    {JOURNEY_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {JOURNEY_STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                ) : def.needs === "tag" ? (
                  <input
                    list="rule-tags"
                    value={c.value ?? ""}
                    onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    placeholder="etiqueta"
                    className={cn(input, "w-48")}
                    aria-label="Etiqueta"
                  />
                ) : null}
                <IconButton label={`Tirar a condição ${i + 1}`} onClick={() => setConditions(conditions.filter((_, j) => j !== i))}>
                  <X className="size-4" aria-hidden />
                </IconButton>
              </li>
            );
          })}
        </ul>
        {conditions.length < 6 ? (
          <button
            type="button"
            onClick={() => setConditions([...conditions, { type: "no_future_appointment" }])}
            className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-crm hover:underline"
          >
            <Plus className="size-4" aria-hidden /> Condição
          </button>
        ) : null}
        <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} className="size-4 accent-[var(--color-crm)]" />
          No máximo uma vez por contato
        </label>
      </Step>

      {/* ENTÃO */}
      <Step n="Então" hint="As ações rodam nesta ordem. Variáveis: {{primeiro_nome}}, {{nome}}, {{data}}, {{hora}}, {{profissional}}, {{clinica}}.">
        <ol className="space-y-3">
          {actions.map((a, i) => (
            <li key={i} className="rounded-xl bg-fog p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink-soft tabular">{i + 1}.</span>
                <select value={a.type} onChange={(e) => setAction(i, { type: e.target.value as RuleAction["type"] })} className={cn(input, "min-w-0 flex-1 basis-48")} aria-label={`Ação ${i + 1}`}>
                  {RULE_ACTIONS.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
                {i > 0 ? (
                  <IconButton label="Subir" onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" aria-hidden />
                  </IconButton>
                ) : null}
                {i < actions.length - 1 ? (
                  <IconButton label="Descer" onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" aria-hidden />
                  </IconButton>
                ) : null}
                {actions.length > 1 ? (
                  <IconButton label={`Tirar a ação ${i + 1}`} onClick={() => setActions(actions.filter((_, j) => j !== i))}>
                    <X className="size-4" aria-hidden />
                  </IconButton>
                ) : null}
              </div>
              <ActionFields a={a} onChange={(patch) => setAction(i, patch)} team={team} />
            </li>
          ))}
        </ol>
        {actions.length < 6 ? (
          <button
            type="button"
            onClick={() => setActions([...actions, { type: "add_tag", tag: "" }])}
            className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-crm hover:underline"
          >
            <Plus className="size-4" aria-hidden /> Ação
          </button>
        ) : null}
      </Step>

      <p className="rounded-xl bg-crm-tint p-3 text-sm" role="status">
        <strong>Resumo:</strong> {describeRule(rule)}
      </p>
      <p className="text-xs text-ink-soft">O que a regra fizer fica na linha do tempo do contato. As ações de uma regra não disparam outras regras (evita repetição sem fim).</p>
      <SubmitButton pendingText="Salvando...">{initial ? "Salvar regra" : "Criar e ligar regra"}</SubmitButton>
    </form>
  );
}

/** O que foi entendido da frase + avisos (antes dos campos do construtor). */
function FromTextSummary({ f }: { f: FromText }) {
  return (
    <div className="space-y-2 rounded-xl bg-crm-tint/60 p-3 text-sm" aria-live="polite">
      <p className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", f.source === "ia" ? "bg-crm text-white" : "bg-paper text-ink-soft ring-1 ring-line")}>
          {f.source === "ia" ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          {f.source === "ia" ? "Montada pela IA" : "Montada pelas regras do CRM"}
        </span>
        {f.source === "regras" && f.reason ? <span className="text-xs text-ink-soft">sem IA: {f.reason}</span> : null}
      </p>
      <p className="text-xs text-ink-soft">
        Você escreveu: <q>{f.text}</q>
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {f.draft.understood.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
      {f.draft.warnings.length ? (
        <ul className="space-y-1 rounded-lg bg-erp-tint px-3 py-2 text-erp-ink" role="note" aria-label="Pontos de atenção">
          {f.draft.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionFields({ a, onChange, team }: { a: RuleAction; onChange: (p: Partial<RuleAction>) => void; team: { id: string; name: string }[] }) {
  const assignee = (
    <select value={a.assignee ?? ""} onChange={(e) => onChange({ assignee: e.target.value })} className={input} aria-label="Responsável">
      <option value="">Ninguém</option>
      <option value="owner">Responsável pelo contato</option>
      {team.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
  switch (a.type) {
    case "send_message":
      return (
        <div className="mt-2 space-y-2">
          <textarea
            value={a.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={3}
            maxLength={1000}
            placeholder="Oi, {{primeiro_nome}}! ..."
            className={cn(input, "py-2")}
            aria-label="Mensagem"
          />
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={a.approved === true} onChange={(e) => onChange({ approved: e.target.checked })} className="mt-0.5 size-4 accent-[var(--color-crm)]" />
            <span>
              <strong>Modelo aprovado pela Meta.</strong> Marque se este texto foi aprovado no WhatsApp oficial: aí ele sai mesmo 24h depois da última mensagem do paciente. Sem isso, só sai dentro da
              janela. Quem pediu SAIR nunca recebe.
            </span>
          </label>
        </div>
      );
    case "internal_note":
      return (
        <textarea
          value={a.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          maxLength={500}
          placeholder="Só a equipe vê"
          className={cn(input, "mt-2 py-2")}
          aria-label="Nota"
        />
      );
    case "create_task":
      return (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_12rem]">
          <input value={a.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} maxLength={200} placeholder="Ligar para {{primeiro_nome}}" className={input} aria-label="Título da tarefa" />
          <select value={String(a.dueInDays ?? 0)} onChange={(e) => onChange({ dueInDays: Number(e.target.value) })} className={input} aria-label="Prazo">
            {[0, 1, 2, 3, 7, 14, 30].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Para hoje" : n === 1 ? "Para amanhã" : `Em ${n} dias`}
              </option>
            ))}
          </select>
          {assignee}
        </div>
      );
    case "move_stage":
      return (
        <select value={a.stage ?? ""} onChange={(e) => onChange({ stage: e.target.value })} className={cn(input, "mt-2")} aria-label="Etapa">
          <option value="">Escolha a etapa...</option>
          {JOURNEY_STAGES.map((s) => (
            <option key={s} value={s}>
              {JOURNEY_STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      );
    case "add_tag":
    case "remove_tag":
      return (
        <input list="rule-tags" value={a.tag ?? ""} onChange={(e) => onChange({ tag: e.target.value })} maxLength={40} placeholder="etiqueta" className={cn(input, "mt-2")} aria-label="Etiqueta" />
      );
    case "set_owner":
      return <div className="mt-2">{assignee}</div>;
    default:
      return null;
  }
}

function Step({ n, hint, children }: { n: string; hint: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl p-3 ring-1 ring-line sm:p-4">
      <legend className="px-1 text-sm font-bold text-crm">{n}</legend>
      <p className="mb-2 text-xs text-ink-soft">{hint}</p>
      {children}
    </fieldset>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-soft hover:bg-paper hover:text-ink"
    >
      {children}
    </button>
  );
}

/* ================================= Histórico ================================= */

const STATUS: Record<RunView["status"], { label: string; icon: typeof CheckCircle2; tone: string }> = {
  feita: { label: "Feita", icon: CheckCircle2, tone: "text-pep-ink" },
  pendente: { label: "Na espera", icon: Clock, tone: "text-crm" },
  ignorada: { label: "Não rodou", icon: CircleSlash, tone: "text-ink-soft" },
  falhou: { label: "Falhou", icon: XCircle, tone: "text-alert" },
};

function HistoryTab({ runs, rules }: { runs: RunView[]; rules: RuleView[] }) {
  const [status, setStatus] = useState<RunView["status"] | "">("");
  const [rule, setRule] = useState("");
  const shown = runs.filter((r) => (!status || r.status === status) && (!rule || r.ruleId === rule));
  return (
    <section aria-label="Histórico" className="rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Situação" className="flex flex-wrap gap-1.5">
          <Chip on={status === ""} onClick={() => setStatus("")}>
            Tudo
          </Chip>
          {(Object.keys(STATUS) as RunView["status"][]).map((s) => (
            <Chip key={s} on={status === s} onClick={() => setStatus(status === s ? "" : s)}>
              {STATUS[s].label} <span className="tabular opacity-70">{runs.filter((r) => r.status === s).length}</span>
            </Chip>
          ))}
        </div>
        <select value={rule} onChange={(e) => setRule(e.target.value)} aria-label="Regra" className="ml-auto min-h-10 max-w-60 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
          <option value="">Todas as regras</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">Nenhuma execução ainda. Quando uma regra rodar, aparece aqui com o resultado.</p>
      ) : (
        <ol className="divide-y divide-line">
          {shown.map((r) => {
            const s = STATUS[r.status];
            const Icon = s.icon;
            return (
              <li key={r.id} className="flex items-start gap-3 py-2.5 text-sm">
                <Icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-label={s.label} />
                <div className="min-w-0 flex-1">
                  <p>
                    <strong>{r.ruleName}</strong>
                    {r.contactId && r.contactName ? (
                      <>
                        {" "}
                        com <PatientLink id={r.contactId} name={r.contactName} />
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink-soft">
                    <span className="first-letter:uppercase">{r.status === "pendente" ? `roda ${r.when}` : r.when}</span>
                    {r.result ? `: ${r.result}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold ring-1", on ? "bg-ink text-white ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink")}
    >
      {children}
    </button>
  );
}
