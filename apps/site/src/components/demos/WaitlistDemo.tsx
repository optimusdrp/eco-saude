"use client";

import { motion, useReducedMotion } from "motion/react";
import { Mail, MessageCircle, RotateCcw, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * Demonstração da lista de espera inteligente.
 * Fluxo simulado (sem servidor, só estado local):
 *   idle      -> agenda cheia
 *   cancelled -> paciente desmarca, horário fica livre
 *   offering  -> sistema avisa a lista de espera pelo canal preferido
 *   filled    -> o primeiro que confirma fica com o horário
 */
type Step = "idle" | "cancelled" | "offering" | "filled";

const waitlist = [
  { name: "Marcos Teles", channel: "WhatsApp", Icon: MessageCircle },
  { name: "Lívia Andrade", channel: "SMS", Icon: Smartphone },
  { name: "Rui Fagundes", channel: "E-mail", Icon: Mail },
];

export function WaitlistDemo() {
  const [step, setStep] = useState<Step>("idle");
  const timers = useRef<number[]>([]);
  const reduce = useReducedMotion();

  // Limpa os temporizadores se o componente sair da tela
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const run = () => {
    setStep("cancelled");
    timers.current.push(window.setTimeout(() => setStep("offering"), 900));
    timers.current.push(window.setTimeout(() => setStep("filled"), 2600));
  };

  const reset = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setStep("idle");
  };

  // Texto do horário das 09:30 em cada etapa
  const slot = {
    idle: { who: "Ana Lúcia Reis", note: "Confirmada", tone: "bg-paper" },
    cancelled: { who: "Horário livre", note: "Ana Lúcia desmarcou", tone: "bg-alert-tint" },
    offering: { who: "Oferecendo à lista de espera", note: "3 pacientes avisados", tone: "bg-erp-tint" },
    filled: { who: "Marcos Teles", note: "Confirmou pelo WhatsApp", tone: "bg-pep-tint" },
  }[step];

  const message = {
    idle: "Agenda de quinta-feira completa.",
    cancelled: "Ana Lúcia desmarcou o horário das 09:30.",
    offering: "O horário foi oferecido a 3 pacientes da lista de espera.",
    filled: "Marcos Teles confirmou primeiro e ficou com o horário.",
  }[step];

  return (
    <div className="rounded-3xl bg-paper p-4 ring-1 ring-line sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl font-bold">Quinta-feira, Dra. Beatriz</h3>
        {step === "idle" ? (
          <Button onClick={run}>Simular cancelamento</Button>
        ) : (
          <Button variant="secondary" onClick={reset} disabled={step !== "filled"}>
            <RotateCcw className="size-4" aria-hidden />
            Recomeçar
          </Button>
        )}
      </div>

      {/* Anúncio para leitores de tela a cada etapa */}
      <p className="sr-only" aria-live="polite">
        {message}
      </p>

      <ol className="mt-5 space-y-2">
        <li className="flex items-center gap-3 rounded-xl bg-fog px-3 py-3">
          <span className="w-12 font-semibold tabular-nums">09:00</span>
          <span>Caio Moura</span>
        </li>
        <motion.li
          layout={!reduce}
          className={cn("flex items-center gap-3 rounded-xl px-3 py-3 ring-1 ring-line transition-colors duration-300", slot.tone)}
        >
          <span className="w-12 font-semibold tabular-nums">09:30</span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{slot.who}</span>
            <span className="block text-sm text-ink-soft">{slot.note}</span>
          </span>
        </motion.li>
        <li className="flex items-center gap-3 rounded-xl bg-fog px-3 py-3">
          <span className="w-12 font-semibold tabular-nums">10:00</span>
          <span>Jorge Batista</span>
        </li>
      </ol>

      <div className="mt-5">
        <p className="text-sm font-semibold text-ink-soft">Lista de espera</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {waitlist.map(({ name, channel, Icon }, i) => {
            const notified = step === "offering" || step === "filled";
            const winner = step === "filled" && i === 0;
            return (
              <li
                key={name}
                className={cn(
                  "rounded-xl px-3 py-2.5 text-sm ring-1 transition-colors duration-300",
                  winner ? "bg-pep-tint ring-pep" : notified ? "bg-erp-tint ring-erp/50" : "bg-fog ring-transparent",
                )}
              >
                <span className="block font-semibold">{name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-ink-soft">
                  <Icon className="size-3.5" aria-hidden />
                  {winner ? "Confirmou" : notified ? `Avisado por ${channel}` : `Prefere ${channel}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
