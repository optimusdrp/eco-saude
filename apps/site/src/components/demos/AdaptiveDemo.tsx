"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  MessageCircle,
  Stethoscope,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { roles } from "@/content/features";
import { useSiteEvent } from "@/hooks/useSiteEvent";
import { cn } from "@/lib/cn";
import type { RoleId } from "@/types";

/**
 * Demonstração do herói: a mesma clínica vista por três perfis.
 * Ao trocar o perfil, o "aparelho" muda de formato (computador, tablet,
 * celular) e a tela se reorganiza. É a ideia central do produto:
 * um único ambiente que se adapta a quem usa e ao tamanho da tela.
 *
 * As telas internas usam container queries (@container): elas reagem à
 * largura do aparelho simulado, não à da janela. Por isso também
 * funcionam dentro de um celular de verdade.
 */

/** Largura do "aparelho" por perfil (o formato muda com animação). */
const frameWidth: Record<RoleId, string> = {
  recepcao: "100%",
  medico: "82%",
  gestor: "min(17rem, 78%)",
};

export function AdaptiveDemo() {
  const [role, setRole] = useState<RoleId>("recepcao");
  const reduce = useReducedMotion();

  // A barra de comandos (Ctrl+K) também pode trocar o perfil
  useSiteEvent("ecosaude:set-role", (next) => setRole(next));

  const current = roles.find((r) => r.id === role) ?? roles[0]!;

  return (
    <div className="w-full">
      {/* Seletor de perfil: "radiogroup" porque só um fica ativo */}
      <div
        role="radiogroup"
        aria-label="Ver o sistema como"
        className="mx-auto flex w-full max-w-md rounded-full bg-paper p-1 ring-1 ring-line"
      >
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={role === r.id}
            onClick={() => setRole(r.id)}
            className={cn(
              "relative min-h-11 flex-1 rounded-full px-3 text-[0.95rem] font-semibold transition-colors",
              role === r.id ? "text-white" : "text-ink-soft hover:text-ink",
            )}
          >
            {role === r.id ? (
              <motion.span
                layoutId="role-pill"
                className="absolute inset-0 rounded-full bg-ink"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative">{r.label}</span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-center text-sm text-ink-soft" aria-live="polite">
        {current.headline}
      </p>

      {/* Palco com altura fixa: o aparelho muda de largura dentro dele */}
      <div className="mt-5 flex h-[31rem] items-start justify-center sm:h-[28rem]">
        <motion.div
          animate={{ width: frameWidth[role] }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }}
          className={cn(
            "@container h-full overflow-hidden bg-ink p-2 shadow-[0_30px_60px_-30px_rgba(24,32,58,0.55)]",
            role === "gestor" ? "rounded-[2.2rem] p-2.5" : "rounded-2xl",
          )}
        >
          <div className="relative h-full overflow-hidden rounded-xl bg-fog">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={role}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
                className="h-full"
              >
                {role === "recepcao" ? <ReceptionScreen /> : null}
                {role === "medico" ? <DoctorScreen /> : null}
                {role === "gestor" ? <ManagerScreen /> : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Telas simuladas (dados fictícios)                                   */
/* ------------------------------------------------------------------ */

const queue = [
  { time: "08:30", name: "Helena Prates", status: "Na recepção", tone: "pep" },
  { time: "09:00", name: "Caio Moura", status: "Confirmado", tone: "crm" },
  { time: "09:30", name: "Ana Lúcia Reis", status: "Risco de falta", tone: "alert" },
  { time: "10:00", name: "Jorge Batista", status: "Confirmado", tone: "crm" },
] as const;

const toneClass = {
  pep: "bg-pep-tint text-pep-ink",
  crm: "bg-crm-tint text-crm",
  alert: "bg-alert-tint text-alert",
} as const;

/** Recepção (computador): menu lateral, fila do dia e conversa. */
function ReceptionScreen() {
  return (
    <div className="flex h-full text-[0.8rem]">
      {/* Menu lateral: some quando o aparelho é estreito */}
      <aside className="hidden w-12 shrink-0 flex-col items-center gap-3 bg-paper py-4 @lg:flex" aria-hidden>
        <span className="grid size-8 place-items-center rounded-lg bg-crm text-white">
          <MessageCircle className="size-4" />
        </span>
        <CalendarDays className="size-4 text-ink-soft" />
        <Wallet className="size-4 text-ink-soft" />
        <ClipboardList className="size-4 text-ink-soft" />
        <BarChart3 className="size-4 text-ink-soft" />
      </aside>

      <div className="grid min-w-0 flex-1 gap-3 p-3 @xl:grid-cols-[1.25fr_1fr]">
        <section className="min-w-0 rounded-lg bg-paper p-3">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-base font-bold">Fila de hoje</h3>
            <span className="text-ink-soft">12 consultas</span>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {queue.map((p) => (
              <li key={p.time} className="flex items-center gap-2 py-2">
                <span className="w-10 shrink-0 font-semibold tabular-nums">{p.time}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold", toneClass[p.tone])}>
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex min-w-0 flex-col rounded-lg bg-paper p-3">
          <h3 className="font-display text-base font-bold">Conversa</h3>
          <p className="text-ink-soft">Ana Lúcia Reis, WhatsApp</p>
          <div className="mt-2 mb-2 space-y-2">
            <p className="max-w-[90%] rounded-lg rounded-tl-none bg-fog px-2.5 py-1.5">
              Bom dia! Consigo passar minha consulta para quinta?
            </p>
            <div className="ml-auto max-w-[90%] rounded-lg rounded-tr-none bg-crm-tint px-2.5 py-1.5">
              <p className="text-[0.7rem] font-semibold text-crm">Resposta sugerida</p>
              Bom dia, Ana! Quinta às 14h está livre. Posso confirmar?
            </div>
          </div>
          <p className="mt-auto hidden rounded-md bg-erp-tint @md:block px-2 py-1.5 text-[0.72rem] text-erp-ink">
            Ao liberar 09:30, 2 pacientes da lista de espera serão avisados.
          </p>
        </section>
      </div>
    </div>
  );
}

/** Médico (tablet): próximo paciente e linha do tempo unificada. */
function DoctorScreen() {
  const timeline = [
    { label: "Mensagem: confirmou presença", when: "ontem", dot: "bg-crm" },
    { label: "Última consulta: ajuste de dose", when: "12/08", dot: "bg-pep" },
    { label: "Exame de sangue anexado", when: "05/08", dot: "bg-pep" },
    { label: "Pagamento do convênio aprovado", when: "02/08", dot: "bg-erp" },
  ];
  return (
    <div className="flex h-full flex-col gap-3 p-3 text-[0.82rem]">
      <section className="rounded-lg bg-paper p-3">
        <p className="text-ink-soft">Próximo paciente, 09:00</p>
        <h3 className="mt-0.5 font-display text-lg font-bold">Caio Moura, 47 anos</h3>
        <p className="mt-1">Retorno de hipertensão. Trouxe resultado de exame.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-alert-tint px-2 py-0.5 text-[0.7rem] font-semibold text-alert">Alergia: dipirona</span>
          <span className="rounded-full bg-fog px-2 py-0.5 text-[0.7rem] font-semibold">Convênio</span>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden rounded-lg bg-paper p-3">
        <h3 className="flex items-center gap-1.5 font-display text-base font-bold">
          <Stethoscope className="size-4" aria-hidden /> Linha do tempo
        </h3>
        <ol className="mt-2 space-y-2.5">
          {timeline.map((item) => (
            <li key={item.label} className="flex items-start gap-2">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.dot)} />
              <span className="min-w-0 flex-1">{item.label}</span>
              <span className="shrink-0 text-ink-soft">{item.when}</span>
            </li>
          ))}
        </ol>
      </section>

      <span className="rounded-full bg-pep py-2.5 text-center font-semibold text-white">Iniciar atendimento</span>
    </div>
  );
}

/** Gestão (celular): indicadores da semana. */
function ManagerScreen() {
  const week = [62, 78, 91, 84, 96, 70];
  const days = ["S", "T", "Q", "Q", "S", "S"];
  return (
    <div className="flex h-full flex-col gap-2.5 p-3 pt-5 text-[0.8rem]">
      <h3 className="font-display text-base font-bold">Esta semana</h3>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-paper p-2.5">
          <p className="text-ink-soft">Ocupação</p>
          <p className="font-display text-2xl font-bold text-bi">87%</p>
        </div>
        <div className="rounded-lg bg-paper p-2.5">
          <p className="text-ink-soft">Faltas</p>
          <p className="font-display text-2xl font-bold">6%</p>
          <p className="text-[0.7rem] text-ok-ink">3 pontos a menos</p>
        </div>
      </div>

      <div className="rounded-lg bg-paper p-2.5">
        <p className="text-ink-soft">Agenda ocupada por dia</p>
        <div className="mt-2 flex h-20 items-end gap-1.5" aria-hidden>
          {week.map((value, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="w-full rounded-t bg-bi" style={{ height: `${value * 0.7}%` }} />
              <span className="text-[0.65rem] text-ink-soft">{days[i]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-erp-tint p-2.5 text-erp-ink">
        <p className="font-semibold">8 retornos atrasados</p>
        <p className="text-[0.72rem]">Campanha de lembrete pronta para envio.</p>
      </div>
    </div>
  );
}
