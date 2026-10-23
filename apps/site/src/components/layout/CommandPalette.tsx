"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSiteEvent } from "@/hooks/useSiteEvent";
import { cn } from "@/lib/cn";
import { emit } from "@/lib/events";

/**
 * Barra de comandos (Ctrl+K / ⌘K).
 * É uma amostra real de um diferencial do produto: no sistema, a mesma
 * barra buscará pacientes e executará ações. Aqui, ela navega pelo site
 * e controla as demonstrações.
 *
 * Acessibilidade: usa o padrão "combobox + listbox" do WAI-ARIA,
 * navegável por setas, Enter e Esc.
 */
interface Command {
  id: string;
  label: string;
  group: "Ir para" | "Demonstrações";
  keywords: string;
  run: () => void;
}

/** Rola até uma seção pelo id. */
function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Normaliza texto para busca: minúsculas e sem acentos ("Médico" = "medico"). */
function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lista de comandos disponíveis.
  const commands = useMemo<Command[]>(
    () => [
      { id: "ecossistema", label: "Ver os módulos do ecossistema", group: "Ir para", keywords: "crm erp prontuario bi laboratorio modulos", run: () => goTo("ecossistema") },
      { id: "diferenciais", label: "Ver os diferenciais", group: "Ir para", keywords: "funcionalidades lista espera falta", run: () => goTo("diferenciais") },
      { id: "laboratorio", label: "Ver o Tropi Laboratório", group: "Ir para", keywords: "laboratorio exames laudo imagem protese analises", run: () => goTo("laboratorio") },
      { id: "offline", label: "Ver o modo offline (em breve)", group: "Ir para", keywords: "offline contingencia sincronizar internet", run: () => goTo("offline") },
      { id: "seguranca", label: "Ver segurança e LGPD", group: "Ir para", keywords: "seguranca lgpd dados isolamento", run: () => goTo("seguranca") },
      { id: "perguntas", label: "Ler as perguntas frequentes", group: "Ir para", keywords: "faq duvidas", run: () => goTo("perguntas") },
      { id: "demo", label: "Pedir uma demonstração", group: "Ir para", keywords: "contato demonstracao falar", run: () => goTo("demonstracao") },
      { id: "role-recepcao", label: "Mostrar a tela da recepção", group: "Demonstrações", keywords: "perfil recepcao secretaria", run: () => { emit("ecosaude:set-role", "recepcao"); goTo("inicio"); } },
      { id: "role-medico", label: "Mostrar a tela do médico", group: "Demonstrações", keywords: "perfil medico doutor consultorio", run: () => { emit("ecosaude:set-role", "medico"); goTo("inicio"); } },
      { id: "role-gestor", label: "Mostrar a tela da gestão", group: "Demonstrações", keywords: "perfil gestor gestao dono", run: () => { emit("ecosaude:set-role", "gestor"); goTo("inicio"); } },
      { id: "offline-on", label: "Simular queda de internet", group: "Demonstrações", keywords: "offline cair internet", run: () => { emit("ecosaude:set-offline", true); goTo("offline"); } },
    ],
    [],
  );

  // Filtra pela busca (em rótulo e palavras-chave, ignorando acentos).
  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return commands;
    return commands.filter((c) => normalize(`${c.label} ${c.keywords}`).includes(q));
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  // Atalho global Ctrl+K / ⌘K
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

  // Botões "Buscar" do cabeçalho disparam este evento
  useSiteEvent("ecosaude:open-commands", () => setOpen(true));

  // Foca o campo ao abrir e trava a rolagem do fundo
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    // pequeno atraso para o fechamento não "brigar" com a rolagem
    requestAnimationFrame(() => command.run());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh] sm:px-4">
      {/* Fundo escurecido: clicar fora fecha */}
      <button type="button" aria-label="Fechar busca" className="absolute inset-0 bg-night/50 backdrop-blur-sm" onClick={close} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Barra de comandos"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-paper shadow-2xl ring-1 ring-line"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 shrink-0 text-ink-soft" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="O que você quer ver?"
            className="h-14 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-soft"
            role="combobox"
            aria-expanded="true"
            aria-controls="comandos-lista"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="hidden rounded bg-fog px-1.5 py-0.5 text-xs text-ink-soft sm:block">Esc</kbd>
        </div>

        <ul id="comandos-lista" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-ink-soft">
              Nada encontrado. Tente “offline”, “médico” ou “módulos”.
            </li>
          ) : (
            results.map((command, index) => {
              const showGroup = index === 0 || results[index - 1]?.group !== command.group;
              return (
                <li key={command.id} role="presentation">
                  {showGroup ? (
                    <p className="px-3 pb-1 pt-3 text-xs font-semibold text-ink-soft">{command.group}</p>
                  ) : null}
                  <div
                    id={`cmd-${command.id}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseMove={() => setActive(index)}
                    onClick={() => run(command)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center justify-between rounded-xl px-3 text-[0.95rem]",
                      index === active ? "bg-crm-tint text-ink" : "text-ink-soft",
                    )}
                  >
                    {command.label}
                    {index === active ? <CornerDownLeft className="size-4 text-crm" aria-hidden /> : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
