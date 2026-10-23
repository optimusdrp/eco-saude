"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Link2, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { Container } from "@/components/ui/Container";
import { moduleColor } from "@/components/ui/ModuleTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { connections, getModule, modules, statusLabel } from "@/content/modules";
import { cn } from "@/lib/cn";
import type { ModuleId } from "@/types";

/**
 * Seção "Ecossistema": um configurador.
 * O visitante liga e desliga módulos e vê, ao lado:
 *  1. o ambiente único, com os módulos não contratados bloqueados;
 *  2. as conexões automáticas que passam a existir entre os módulos.
 * Isso explica, fazendo, a regra principal do produto:
 * "módulos independentes, um só ambiente".
 */
export function Ecosystem() {
  const [selected, setSelected] = useState<ModuleId[]>(["crm"]);
  const reduce = useReducedMotion();

  const toggle = (id: ModuleId) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  // Conexões ativas = pares em que os DOIS módulos estão selecionados
  const active = useMemo(
    () => connections.filter((c) => c.between.every((id) => selected.includes(id))),
    [selected],
  );

  return (
    <section id="ecossistema" aria-labelledby="eco-title" className="bg-paper py-20 lg:py-28">
      <Container>
        <SectionHeading id="eco-title" title="Contrate um módulo. Some outros quando quiser.">
          Cada módulo funciona sozinho. Juntos, eles se conectam automaticamente,
          sem integração para configurar. Escolha abaixo e veja o que muda.
        </SectionHeading>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
          {/* Lista de módulos (cada um é um checkbox acessível) */}
          <fieldset>
            <legend className="sr-only">Módulos contratados</legend>
            <ul className="space-y-3">
              {modules.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <li key={m.id}>
                    <label
                      className={cn(
                        "group block cursor-pointer rounded-2xl p-5 ring-1 transition-[box-shadow,background-color]",
                        on ? cn("bg-fog ring-2", moduleColor[m.id].ring) : "ring-line hover:ring-ink/30",
                      )}
                    >
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(m.id)} />
                      <div className="flex items-start gap-4">
                        <span
                          className={cn(
                            "mt-1 grid size-6 shrink-0 place-items-center rounded-md ring-1 transition-colors",
                            on ? cn(moduleColor[m.id].bg, "text-white ring-transparent") : "bg-paper ring-line",
                          )}
                          aria-hidden
                        >
                          {on ? <Check className="size-4" strokeWidth={3} /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="font-display text-xl font-bold">{m.name}</span>
                            <span className="text-ink-soft">{m.fullName}</span>
                            <span className="ml-auto rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-ink-soft ring-1 ring-line">
                              {statusLabel[m.status]}
                            </span>
                          </div>
                          <p className="mt-2 text-[0.97rem] text-ink-soft">{m.summary}</p>

                          {/* Submódulos aparecem quando o módulo é escolhido */}
                          <AnimatePresence initial={false}>
                            {on ? (
                              <motion.ul
                                initial={reduce ? false : { height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={reduce ? undefined : { height: 0, opacity: 0 }}
                                className="flex flex-wrap gap-1.5 overflow-hidden pt-3"
                              >
                                {m.submodules.map((s) => (
                                  <li
                                    key={s}
                                    className="rounded-full bg-paper px-2.5 py-1 text-[0.8rem] ring-1 ring-line"
                                  >
                                    {s}
                                  </li>
                                ))}
                              </motion.ul>
                            ) : null}
                          </AnimatePresence>
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-sm text-ink-soft">
              Os submódulos disponíveis variam conforme o plano.
            </p>
          </fieldset>

          {/* Prévia do ambiente único */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl bg-ink p-2 shadow-[0_30px_60px_-30px_rgba(24,32,58,0.5)]">
              <div className="rounded-xl bg-fog p-4 sm:p-5">
                <p className="text-sm text-ink-soft">Seu ambiente</p>
                {/* Só o Laboratório marcado: o ambiente é de um laboratório, não de uma clínica */}
                <p className="font-display text-lg font-bold">{selected.length === 1 && selected[0] === "lab" ? "Laboratório Exemplo" : "Clínica Exemplo"}</p>

                {/* "Menu" do sistema: módulos não contratados aparecem bloqueados */}
                <ul className="mt-4 grid grid-cols-2 gap-2 xs:grid-cols-3">
                  {modules.map((m) => {
                    const on = selected.includes(m.id);
                    return (
                      <li
                        key={m.id}
                        className={cn(
                          "flex min-h-16 flex-col justify-between rounded-lg p-2.5 text-sm transition-colors",
                          on ? "border border-line bg-paper" : "border border-dashed border-ink/25 text-ink-soft",
                        )}
                      >
                        <span className={cn("h-1.5 w-6 rounded-full", on ? moduleColor[m.id].dot : "bg-line")} aria-hidden />
                        <span className="mt-2 flex items-center gap-1 font-semibold">
                          {on ? null : <Lock className="size-3.5" aria-label="não contratado" />}
                          {m.name}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-5 border-t border-line pt-4">
                  <p className="flex items-center gap-2 font-semibold" aria-live="polite">
                    <Link2 className="size-4 text-crm" aria-hidden />
                    {active.length === 0
                      ? "Nenhuma conexão ativa"
                      : active.length === 1
                        ? "1 conexão automática"
                        : `${active.length} conexões automáticas`}
                  </p>

                  {active.length === 0 ? (
                    <p className="mt-2 text-[0.95rem] text-ink-soft">
                      Com um módulo só, tudo já funciona. Marque um segundo módulo para ver as
                      conexões que aparecem sozinhas.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      <AnimatePresence initial={false}>
                        {active.map((c) => (
                          <motion.li
                            key={c.between.join("-")}
                            layout={!reduce}
                            initial={reduce ? false : { opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={reduce ? undefined : { opacity: 0 }}
                            className="rounded-lg bg-paper p-3 text-[0.93rem] ring-1 ring-line"
                          >
                            <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                              <span className={cn("size-2 rounded-full", moduleColor[c.between[0]].dot)} aria-hidden />
                              {getModule(c.between[0]).name}
                              <span aria-hidden>+</span>
                              <span className={cn("size-2 rounded-full", moduleColor[c.between[1]].dot)} aria-hidden />
                              {getModule(c.between[1]).name}
                            </span>
                            {c.description}
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
