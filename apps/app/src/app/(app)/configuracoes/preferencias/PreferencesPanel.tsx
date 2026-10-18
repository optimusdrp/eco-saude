"use client";

/**
 * PREFERÊNCIAS DO NAVEGADOR
 *  - Tamanho do texto (acessibilidade): normal, grande, maior
 *  - Telas personalizadas: cada tela guarda o seu jeito (visão, filtros, colunas...);
 *    aqui dá para ver quais foram personalizadas e voltar ao padrão
 *  - Rascunhos de mensagens não enviadas: quantos há e apagar todos
 * Tudo em try/catch: com o armazenamento bloqueado, a tela só mostra o padrão.
 */
import { RotateCcw, Trash2, Type } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Panel } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { TEXT_SIZE_PERCENT, UI_PREFS_KEY, useUiPrefs, type UiPrefs } from "@/lib/uiPrefs";

const SCREENS: { key: string; label: string; href: string; what: string }[] = [
  { key: "eco:hoje:prefs:v1", label: "Hoje", href: "/hoje", what: "modelo, quadros e ordem" },
  { key: "eco:agenda:prefs:v1", label: "Agenda", href: "/crm/agenda", what: "densidade, cores, profissionais e filtros" },
  { key: "eco:conversas:prefs:v1", label: "Conversas", href: "/crm/conversas", what: "lista, painel e Enter para enviar" },
  { key: "eco:jornada:prefs:v1", label: "Jornada", href: "/crm/jornada", what: "quadro ou lista, etapas e cartões" },
  { key: "eco:contatos:prefs:v1", label: "Contatos", href: "/crm/contatos", what: "tabela ou cartões e colunas" },
  { key: "eco:espera:prefs:v1", label: "Lista de espera", href: "/crm/espera", what: "visão e densidade" },
  { key: "eco:retornos:prefs:v1", label: "Retornos", href: "/crm/retornos", what: "aba e ordem" },
  { key: "eco:tarefas:prefs:v1", label: "Tarefas", href: "/crm/tarefas", what: "visão, escopo e densidade" },
];
const DRAFT_PREFIX = "eco:rascunho:";
const EVENT = "eco:prefs-change";

/** Retrato do armazenamento: quais telas têm personalização e quantos rascunhos */
function snapshot(): string {
  try {
    const custom = SCREENS.filter((s) => window.localStorage.getItem(s.key) !== null).map((s) => s.key);
    let drafts = 0;
    for (let i = 0; i < window.localStorage.length; i++) if (window.localStorage.key(i)?.startsWith(DRAFT_PREFIX)) drafts++;
    return JSON.stringify({ custom, drafts });
  } catch {
    return JSON.stringify({ custom: [], drafts: 0 });
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("eco:drafts", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("eco:drafts", cb);
    window.removeEventListener("storage", cb);
  };
}
function remove(keys: string[]) {
  try {
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    /* armazenamento bloqueado */
  }
  window.dispatchEvent(new Event(EVENT));
  window.dispatchEvent(new Event("eco:drafts"));
}

export function PreferencesPanel() {
  const [ui, update] = useUiPrefs();
  const raw = useSyncExternalStore(subscribe, snapshot, () => JSON.stringify({ custom: [], drafts: 0 }));
  const { custom, drafts } = JSON.parse(raw) as { custom: string[]; drafts: number };

  const clearDrafts = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(DRAFT_PREFIX)) keys.push(k);
      }
      remove(keys);
    } catch {
      /* ignora */
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-2">
      <Panel title="Tamanho do texto" description="Aumenta textos, botões e espaços em todas as telas.">
        <div role="radiogroup" aria-label="Tamanho do texto" className="grid grid-cols-3 gap-2">
          {(Object.keys(TEXT_SIZE_PERCENT) as UiPrefs["textSize"][]).map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={ui.textSize === size}
              onClick={() => update({ textSize: size })}
              className={cn("flex flex-col items-center gap-1 rounded-xl p-3 ring-1", ui.textSize === size ? "bg-crm-tint ring-2 ring-crm" : "bg-paper ring-line hover:ring-crm")}
            >
              <Type aria-hidden style={{ width: `${TEXT_SIZE_PERCENT[size] / 6}px`, height: `${TEXT_SIZE_PERCENT[size] / 6}px` }} />
              <span className="text-sm font-semibold">{size === "normal" ? "Normal" : size === "grande" ? "Grande" : "Maior"}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 rounded-xl bg-fog p-3 text-sm">
          Prévia: <strong>Consulta confirmada para amanhã às 09:00.</strong> O texto já está no tamanho escolhido.
        </p>
        {ui.textSize !== "normal" ? (
          <button type="button" onClick={() => remove([UI_PREFS_KEY])} className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <RotateCcw className="size-4" aria-hidden /> Voltar ao normal
          </button>
        ) : null}
      </Panel>

      <Panel
        title="Telas personalizadas"
        description="Cada tela lembra como você a deixou. Restaurar volta ao jeito original."
        actions={
          custom.length ? (
            <button type="button" onClick={() => remove(SCREENS.map((s) => s.key))} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-line hover:ring-crm">
              <RotateCcw className="size-4" aria-hidden /> Restaurar todas
            </button>
          ) : null
        }
      >
        <ul className="divide-y divide-line">
          {SCREENS.map((s) => {
            const on = custom.includes(s.key);
            return (
              <li key={s.key} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={s.href} className="font-semibold hover:text-crm hover:underline">
                    {s.label}
                  </Link>
                  <p className="text-xs text-ink-soft">{s.what}</p>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", on ? "bg-crm-tint text-crm" : "bg-fog text-ink-soft")}>{on ? "personalizada" : "padrão"}</span>
                {on ? (
                  <button type="button" onClick={() => remove([s.key])} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ink-soft hover:bg-fog hover:text-ink" aria-label={`Restaurar o padrão da tela ${s.label}`}>
                    <RotateCcw className="size-4" aria-hidden /> Restaurar
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Rascunhos de mensagens" description="Texto escrito numa conversa e ainda não enviado fica guardado aqui, por conversa.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <span className="font-display text-2xl font-bold tabular">{drafts}</span> {drafts === 1 ? "rascunho guardado" : "rascunhos guardados"} neste navegador
          </p>
          {drafts ? (
            <button type="button" onClick={clearDrafts} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-alert ring-1 ring-alert/40 hover:bg-alert-tint">
              <Trash2 className="size-4" aria-hidden /> Apagar rascunhos
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-ink-soft">Em computador compartilhado, apague os rascunhos ao terminar o expediente.</p>
      </Panel>
    </div>
  );
}
