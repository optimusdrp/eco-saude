"use client";

/**
 * PERSONALIZAR O PAINEL
 * Modelos prontos (Recepção, Gestão) ou do seu jeito: mostrar/ocultar cada
 * quadro, mudar a ordem, trocar de coluna e usar o modo compacto.
 * Tudo com botões (funciona no teclado e no toque, sem precisar arrastar).
 */
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw } from "lucide-react";
import { Dialog } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { PRESETS, WIDGETS, type PresetId, type TodayPrefs, type WidgetId } from "./types";

export function Customize({
  open,
  onClose,
  prefs,
  update,
  reset,
}: {
  open: boolean;
  onClose: () => void;
  prefs: TodayPrefs;
  update: (patch: Partial<TodayPrefs>) => void;
  reset: () => void;
}) {
  // Qualquer mudança manual vira "personalizado"
  const change = (patch: Partial<TodayPrefs>) => update({ ...patch, preset: "personalizado" });

  const move = (col: "main" | "side", id: WidgetId, dir: -1 | 1) => {
    const list = [...prefs[col]];
    const i = list.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    change({ [col]: list });
  };
  const swapColumn = (col: "main" | "side", id: WidgetId) => {
    const other = col === "main" ? "side" : "main";
    change({ [col]: prefs[col].filter((w) => w !== id), [other]: [...prefs[other], id] });
  };
  const toggle = (id: WidgetId, visible: boolean) => change({ hidden: visible ? prefs.hidden.filter((w) => w !== id) : [...prefs.hidden, id] });

  return (
    <Dialog open={open} onClose={onClose} title="Personalizar o painel" description="Fica salvo neste navegador. Cada pessoa da equipe monta o seu.">
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-bold">Modelo</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={prefs.preset === id}
                onClick={() => update({ ...PRESETS[id].prefs, preset: id })}
                className={cn("rounded-xl p-3 text-left ring-1", prefs.preset === id ? "bg-crm-tint ring-2 ring-crm" : "ring-line hover:ring-crm")}
              >
                <span className="block font-semibold">{PRESETS[id].label}</span>
                <span className="block text-sm text-ink-soft">{PRESETS[id].hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {(["main", "side"] as const).map((col) => (
          <fieldset key={col}>
            <legend className="mb-2 text-sm font-bold">{col === "main" ? "Coluna principal" : "Coluna lateral"}</legend>
            {prefs[col].length === 0 ? <p className="text-sm text-ink-soft">Nenhum quadro aqui.</p> : null}
            <ul className="space-y-1.5">
              {prefs[col].map((id, i) => {
                const visible = !prefs.hidden.includes(id);
                return (
                  <li key={id} className={cn("flex items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-line", !visible && "opacity-60")}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                      <input type="checkbox" checked={visible} onChange={(e) => toggle(id, e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--color-crm)]" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{WIDGETS[id].title}</span>
                        <span className="block text-xs text-ink-soft">{WIDGETS[id].hint}</span>
                      </span>
                    </label>
                    <IconButton label={`Subir ${WIDGETS[id].title}`} disabled={i === 0} onClick={() => move(col, id, -1)}>
                      <ArrowUp className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton label={`Descer ${WIDGETS[id].title}`} disabled={i === prefs[col].length - 1} onClick={() => move(col, id, 1)}>
                      <ArrowDown className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton label={`Levar ${WIDGETS[id].title} para a coluna ${col === "main" ? "lateral" : "principal"}`} onClick={() => swapColumn(col, id)}>
                      <ArrowLeftRight className="size-4" aria-hidden />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}

        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" role="switch" checked={prefs.compact} onChange={(e) => update({ compact: e.target.checked })} className="size-4 accent-[var(--color-crm)]" />
          <span>
            <span className="font-semibold">Modo compacto</span>
            <span className="block text-xs text-ink-soft">Listas mais curtas e régua mais baixa, para telas pequenas.</span>
          </span>
        </label>

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
            <RotateCcw className="size-4" aria-hidden />
            Voltar ao padrão
          </button>
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white">
            Pronto
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function IconButton({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-fog hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}
