"use client";

/**
 * EDITOR DE MENSAGENS AUTOMÁTICAS
 *  - à esquerda: todas as mensagens por grupo, com busca e situação
 *    (padrão, personalizada, desligada)
 *  - à direita: o texto, as variáveis (clique para inserir onde está o cursor),
 *    a PRÉVIA como o paciente vai ver, e os avisos (variável que não existe nesta
 *    mensagem, modelo da Meta para mensagens fora da janela de 24h)
 */
import { fillTemplate, SAMPLE_VARIABLES, TEMPLATE_GROUP_LABEL, TEMPLATE_GROUPS, unknownVariables, VARIABLE_LABEL, type TemplateGroup } from "@ecosaude/core/crm";
import { AlertTriangle, Info, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui";
import { Badge } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { resetTemplateAction, saveTemplateAction } from "@/modules/crm/actions/automations";

export interface TemplateView {
  key: string;
  group: TemplateGroup;
  label: string;
  when: string;
  optional: boolean;
  outsideWindow: boolean;
  variables: string[];
  defaultBody: string;
  body: string;
  enabled: boolean;
  /** padrao = texto do sistema; clinica = editado aqui; resposta = resposta rápida antiga com o atalho */
  source: "padrao" | "clinica" | "resposta";
  legacyShortcut?: string;
  automation: { title: string; on: boolean } | null;
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MessagesWorkspace({ templates, clinicName, initialKey, canAutomations }: { templates: TemplateView[]; clinicName: string; initialKey: string | null; canAutomations: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [key, setKey] = useState(initialKey && templates.some((t) => t.key === initialKey) ? initialKey : templates[0]!.key);
  const [q, setQ] = useState("");
  const current = templates.find((t) => t.key === key)!;
  const term = plain(q.trim());
  const pick = (k: string) => {
    setKey(k);
    router.replace(`${path}?msg=${k}`, { scroll: false });
    if (window.matchMedia("(max-width: 79.99rem)").matches) document.getElementById("editor-msg")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const custom = templates.filter((t) => t.source !== "padrao").length;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <nav aria-label="Mensagens" className="space-y-3 xl:sticky xl:top-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar mensagem" aria-label="Buscar mensagem" className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm" />
        </div>
        <p className="text-xs text-ink-soft">
          {templates.length} mensagens, {custom} {custom === 1 ? "personalizada" : "personalizadas"}.
        </p>
        <div className="max-h-none space-y-3 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto xl:pr-1">
          {TEMPLATE_GROUPS.map((g) => {
            const items = templates.filter((t) => t.group === g && (!term || plain(`${t.label} ${t.when} ${t.body}`).includes(term)));
            if (!items.length) return null;
            return (
              <section key={g}>
                <h2 className="mb-1 px-1 text-xs font-semibold text-crm">{TEMPLATE_GROUP_LABEL[g]}</h2>
                <ul className="space-y-1">
                  {items.map((t) => (
                    <li key={t.key}>
                      <button
                        type="button"
                        onClick={() => pick(t.key)}
                        aria-current={t.key === key ? "true" : undefined}
                        className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm", t.key === key ? "bg-night text-white" : "hover:bg-paper hover:ring-1 hover:ring-line")}
                      >
                        <span className="min-w-0 flex-1 truncate font-semibold">{t.label}</span>
                        <StatusDot t={t} active={t.key === key} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </nav>

      <div id="editor-msg" className="min-w-0 scroll-mt-4">
        <Editor key={`${current.key}:${current.body}:${current.enabled}`} t={current} clinicName={clinicName} canAutomations={canAutomations} />
      </div>
    </div>
  );
}

function StatusDot({ t, active }: { t: TemplateView; active: boolean }) {
  if (!t.enabled) return <span className={cn("shrink-0 text-[0.68rem] font-semibold", active ? "text-white/80" : "text-ink-soft")}>desligada</span>;
  if (t.source === "padrao") return null;
  return <span className={cn("size-2 shrink-0 rounded-full", active ? "bg-white" : "bg-crm")} aria-label="personalizada" title="Personalizada" />;
}

function Editor({ t, clinicName, canAutomations }: { t: TemplateView; clinicName: string; canAutomations: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState(saveTemplateAction, {});
  const [resetState, resetAction] = useActionState(resetTemplateAction, {});
  const [body, setBody] = useState(t.body);
  const [enabled, setEnabled] = useState(t.enabled);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state.ok || resetState.ok) router.refresh();
  }, [state, resetState, router]);

  const dirty = body !== t.body || enabled !== t.enabled;
  const unknown = unknownVariables(body, t.variables);
  const preview = fillTemplate(body, { ...SAMPLE_VARIABLES, clinica: clinicName });

  // Insere a variável onde está o cursor (ou no fim)
  const insert = (v: string) => {
    const el = area.current;
    const token = `{{${v}}}`;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-line">
      <div className="space-y-1 border-b border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">{t.label}</h2>
          {t.source === "clinica" ? <Badge tone="crm">personalizada</Badge> : t.source === "resposta" ? <Badge tone="warning">vinda da resposta rápida /{t.legacyShortcut}</Badge> : <Badge>texto padrão</Badge>}
          {!t.enabled ? <Badge tone="alert">desligada</Badge> : null}
        </div>
        <p className="text-sm text-ink-soft">Quando sai: {t.when}</p>
        {t.automation && !t.automation.on ? (
          <p className="mt-2 flex items-start gap-2 rounded-xl bg-erp-tint p-2.5 text-sm text-erp-ink">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              A automação “{t.automation.title}” está desligada: esta mensagem só sai quando ela estiver ligada.{" "}
              {canAutomations ? (
                <Link href="/configuracoes/automacoes" className="font-semibold underline">
                  Abrir Automações
                </Link>
              ) : null}
            </span>
          </p>
        ) : null}
      </div>

      <form action={action} className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <input type="hidden" name="key" value={t.key} />
        <input type="hidden" name="enabled" value={String(enabled)} />
        <div className="min-w-0 space-y-3">
          <FormMessage state={state.message ? state : resetState} />
          <label htmlFor={`tpl-${t.key}`} className="block text-sm font-semibold">
            Texto
          </label>
          <textarea
            ref={area}
            id={`tpl-${t.key}`}
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={1000}
            className="block w-full resize-y rounded-xl bg-paper p-3 text-[0.95rem] ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
            aria-describedby={`tpl-${t.key}-count`}
          />
          <p id={`tpl-${t.key}-count`} className="text-right text-xs text-ink-soft tabular">
            {body.length} de 1.000 caracteres
          </p>

          <div>
            <p className="mb-1 text-sm font-semibold">Variáveis desta mensagem</p>
            <div className="flex flex-wrap gap-1.5">
              {t.variables.map((v) => (
                <button key={v} type="button" onClick={() => insert(v)} className="min-h-9 rounded-full bg-crm-tint px-3 text-sm font-semibold text-crm hover:bg-crm hover:text-white" title={`Insere {{${v}}}`}>
                  {VARIABLE_LABEL[v as keyof typeof VARIABLE_LABEL] ?? v}
                </button>
              ))}
            </div>
          </div>

          {unknown.length ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-alert-tint p-2.5 text-sm font-semibold text-alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Esta mensagem não preenche {unknown.map((u) => `{{${u}}}`).join(", ")}: o trecho ficaria em branco para o paciente.
            </p>
          ) : null}

          {t.optional ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="peer sr-only" />
              <span
                aria-hidden
                className="relative h-6 w-10 shrink-0 rounded-full bg-ink/20 transition-colors peer-checked:bg-crm peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-crm after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
              />
              <span className="text-sm">
                <span className="block font-semibold">Enviar esta mensagem</span>
                <span className="block text-xs text-ink-soft">Desligada, o Tropi continua fazendo a ação, só não manda o texto.</span>
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton disabled={!dirty || !body.trim()} pendingText="Salvando...">
              Salvar mensagem
            </SubmitButton>
            {dirty ? (
              <button
                type="button"
                onClick={() => {
                  setBody(t.body);
                  setEnabled(t.enabled);
                }}
                className={buttonStyles("ghost")}
              >
                Descartar
              </button>
            ) : null}
            {!dirty && body !== t.defaultBody ? (
              <button type="button" onClick={() => setBody(t.defaultBody)} className={buttonStyles("ghost")}>
                <RotateCcw className="size-4" aria-hidden /> Usar o texto padrão
              </button>
            ) : null}
          </div>
        </div>

        {/* Prévia: como chega no celular do paciente */}
        <aside aria-label="Prévia" className="min-w-0">
          <p className="mb-1 text-sm font-semibold">Prévia</p>
          <div className="rounded-2xl bg-[#e9e3d8] p-3">
            <p className="mb-2 text-center text-[0.68rem] text-ink-soft">exemplo com dados fictícios</p>
            <div className={cn("ml-auto w-fit max-w-[95%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm break-words whitespace-pre-line shadow-sm", !enabled && "opacity-50")}>
              {preview || <span className="text-ink-soft">(vazia)</span>}
            </div>
          </div>
          {t.outsideWindow ? (
            <p className="mt-2 text-xs text-ink-soft">
              Esta mensagem costuma sair mais de 24h depois da última fala do paciente. No WhatsApp oficial, cadastre o mesmo texto como modelo aprovado pela Meta.
            </p>
          ) : null}
        </aside>
      </form>

      {t.source === "clinica" ? (
        <form action={resetAction} className="border-t border-line px-4 py-3 sm:px-5">
          <input type="hidden" name="key" value={t.key} />
          <SubmitButton variant="ghost" pendingText="Restaurando...">
            <RotateCcw className="size-4" aria-hidden /> Restaurar o texto padrão do sistema
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
