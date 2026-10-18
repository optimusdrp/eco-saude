"use client";

import { JOURNEY_STAGE_LABEL, type JourneyStage } from "@ecosaude/core/crm";
import { CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { useAppEvent } from "@/lib/hooks";
import type { NavItem } from "./AppShell";

/**
 * BARRA DE COMANDOS (Ctrl+K / ⌘K)
 * Busca paciente por nome ou telefone e executa ações sem navegar por menus.
 * Escolher um paciente abre o trilho dele ao lado da tela atual.
 */
interface Item {
  id: string;
  label: string;
  hint?: string;
  group: "Contatos" | "Ações" | "Ir para";
  run: () => void;
}

function normalize(t: string) {
  return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function CommandPalette({ nav }: { nav: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [patients, setPatients] = useState<{ id: string; name: string; stage: JourneyStage; phone: string | null }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useAppEvent("eco:open-commands", () => setOpen(true));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Busca de pacientes com pequena espera entre teclas
  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const t = window.setTimeout(() => {
      fetch(`/api/busca?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setPatients(d.results ?? []))
        .catch(() => setPatients([]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setActive(0);
    setPatients([]);
  };

  const items = useMemo<Item[]>(() => {
    const term = normalize(q.trim());
    const actions: Item[] = [
      { id: "agendar", label: "Agendar consulta", group: "Ações" as const, run: () => emit("eco:open-schedule", {}) },
      { id: "simulador", label: "Simular mensagem de paciente", group: "Ações" as const, run: () => emit("eco:open-simulator") },
      ...nav.map((n) => ({ id: `nav-${n.href}`, label: n.label, group: "Ir para" as const, run: () => router.push(n.href) })),
    ].filter((i) => !term || normalize(i.label).includes(term));
    const people: Item[] =
      q.trim().length >= 2
        ? patients.map((p) => ({ id: p.id, label: p.name, hint: JOURNEY_STAGE_LABEL[p.stage], group: "Contatos" as const, run: () => emit("eco:open-patient", p.id) }))
        : [];
    return [...people, ...actions];
  }, [q, patients, nav, router]);

  if (!open) return null;

  const run = (item?: Item) => {
    if (!item) return;
    close();
    requestAnimationFrame(() => item.run());
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[10vh]">
      <button type="button" aria-label="Fechar busca" className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca e comandos"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-paper shadow-2xl ring-1 ring-line"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(items[active]);
          } else if (e.key === "Escape") close();
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 text-ink-soft" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Paciente, telefone ou ação"
            className="h-14 w-full bg-transparent text-base outline-none placeholder:text-ink-soft"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={items[active] ? `cmd-${items[active].id}` : undefined}
          />
        </div>
        <ul id="cmd-list" role="listbox" className="thin-scroll max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 ? <li className="px-3 py-6 text-center text-ink-soft">Nada encontrado.</li> : null}
          {items.map((item, i) => (
            <li key={item.id} role="presentation">
              {i === 0 || items[i - 1]?.group !== item.group ? <p className="px-3 pt-3 pb-1 text-xs font-semibold text-ink-soft">{item.group}</p> : null}
              <div
                id={`cmd-${item.id}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => run(item)}
                className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-3", i === active ? "bg-crm-tint" : "")}
              >
                <span className="font-semibold">{item.label}</span>
                <span className="flex items-center gap-2 text-xs text-ink-soft">
                  {item.hint}
                  {i === active ? <CornerDownLeft className="size-4 text-crm" aria-hidden /> : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
