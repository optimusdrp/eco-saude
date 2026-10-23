"use client";

import type { Diagnosis } from "@ecosaude/core/pep";
import { Loader2, Search, Star, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/components/ui/styles";

interface CidItem {
  code: string;
  name: string;
  sex: "F" | "M" | null;
}

/**
 * Busca de CID-10 (código ou nome, sem acento). Setas + Enter para escolher, Esc fecha.
 * O primeiro diagnóstico é o principal; a estrela muda o principal.
 * Avisa quando o CID é exclusivo do outro sexo (ex.: gestação em paciente masculino).
 */
export function CidPicker({ value, onChange, sex, disabled }: { value: Diagnosis[]; onChange: (v: Diagnosis[]) => void; sex: "F" | "M" | null; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CidItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/prontuario/cid?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const j = (await r.json()) as { items?: CidItem[] };
        setItems(j.items ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        /* busca cancelada ou sem conexão: mantém a lista anterior */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Texto curto demais: não mostra a lista antiga
  const shown = q.trim().length >= 2 ? items : [];

  const add = (c: CidItem) => {
    if (!value.some((d) => d.code === c.code)) onChange([...value, { code: c.code, name: c.name, principal: value.length === 0 }]);
    setQ("");
    setItems([]);
    setOpen(false);
    inputRef.current?.focus();
  };
  const wrongSex = (s: "F" | "M" | null | undefined) => !!s && !!sex && s !== sex;

  return (
    <div>
      {value.length ? (
        <ul className="mb-3 space-y-2">
          {value.map((d) => (
            <li key={d.code} className="flex items-start gap-2 rounded-xl bg-fog px-3 py-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.map((x) => ({ ...x, principal: x.code === d.code })))}
                aria-pressed={!!d.principal}
                aria-label={d.principal ? `${d.code} é o diagnóstico principal` : `Tornar ${d.code} o diagnóstico principal`}
                className={cn("-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg", d.principal ? "text-sun-strong" : "text-ink-soft hover:text-ink")}
              >
                <Star className={cn("size-4", d.principal && "fill-current")} aria-hidden />
              </button>
              <span className="min-w-0 flex-1 pt-1">
                <span className="font-semibold tabular">{d.code}</span> {d.name}
              </span>
              {!disabled ? (
                <button type="button" onClick={() => onChange(fixPrincipal(value.filter((x) => x.code !== d.code)))} aria-label={`Remover ${d.code}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-alert-tint hover:text-alert">
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!disabled ? (
        <div className="relative">
          <label htmlFor={`${listId}-q`} className="sr-only">
            Buscar CID-10 por código ou nome
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <input
            ref={inputRef}
            id={`${listId}-q`}
            role="combobox"
            aria-expanded={open && shown.length > 0}
            aria-controls={listId}
            aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].code}` : undefined}
            autoComplete="off"
            placeholder="Buscar CID: código (J06) ou nome (resfriado)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => shown.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && open && shown[active]) {
                e.preventDefault();
                add(shown[active]);
              } else if (e.key === "Escape") setOpen(false);
            }}
            className="min-h-11 w-full rounded-xl bg-paper pr-9 pl-9 ring-1 ring-line outline-none focus:ring-2 focus:ring-pep sm:min-h-10"
          />
          {loading ? <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-ink-soft" aria-hidden /> : null}
          {open && shown.length ? (
            <ul id={listId} role="listbox" className="thin-scroll absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl bg-paper p-1 shadow-xl ring-1 ring-line">
              {shown.map((c, i) => (
                <li
                  key={c.code}
                  id={`${listId}-${c.code}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(c);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer gap-3 rounded-lg px-3 py-2 text-sm", i === active ? "bg-pep-tint" : "")}
                >
                  <span className={cn("w-12 shrink-0 font-semibold tabular", c.code.length === 3 ? "text-ink" : "text-ink-soft")}>{c.code}</span>
                  <span className="min-w-0 flex-1">
                    {c.name}
                    {wrongSex(c.sex) ? <span className="block text-xs font-semibold text-alert">Exclusivo do sexo {c.sex === "F" ? "feminino" : "masculino"}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fixPrincipal(v: Diagnosis[]): Diagnosis[] {
  if (!v.length || v.some((d) => d.principal)) return v;
  return v.map((d, i) => ({ ...d, principal: i === 0 }));
}
