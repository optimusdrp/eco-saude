"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  ClipboardPen,
  HardDrive,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  UserPen,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSiteEvent } from "@/hooks/useSiteEvent";
import { cn } from "@/lib/cn";

/**
 * Simulador do modo offline (painel de contingência).
 *
 * Regras que ele demonstra (as mesmas planejadas para o sistema):
 *  - Sem internet, tudo é salvo no aparelho e espera para sincronizar.
 *  - Mensagens (WhatsApp etc.) não saem sem internet: ficam na fila de envio.
 *  - Ao voltar, os itens sincronizam um a um.
 *  - Conflito de agenda (dois aparelhos marcaram o mesmo horário offline)
 *    NUNCA é resolvido sozinho: aparece para uma pessoa decidir.
 *
 * Tudo aqui é estado local do navegador: nenhuma informação é enviada.
 */

type Kind = "agenda" | "cadastro" | "atendimento" | "mensagem";
type ItemState = "local" | "queued" | "syncing" | "synced" | "sent" | "conflict" | "resolved";

interface Item {
  kind: Kind;
  label: string;
  state: ItemState;
  createdOffline: boolean;
}

const actions: { kind: Kind; button: string; label: string; Icon: typeof CalendarPlus }[] = [
  { kind: "agenda", button: "Marcar consulta", label: "Consulta de Paulo Lima, quinta às 09:30", Icon: CalendarPlus },
  { kind: "cadastro", button: "Atualizar cadastro", label: "Novo telefone de Helena Prates", Icon: UserPen },
  { kind: "atendimento", button: "Registrar atendimento", label: "Atendimento de Caio Moura", Icon: ClipboardPen },
  { kind: "mensagem", button: "Enviar lembrete", label: "Lembrete por WhatsApp para Jorge Batista", Icon: MessageCircle },
];

const stateInfo: Record<ItemState, { text: string; className: string; Icon: typeof HardDrive }> = {
  local: { text: "Salvo neste aparelho", className: "text-erp", Icon: HardDrive },
  queued: { text: "Na fila de envio", className: "text-erp", Icon: Send },
  syncing: { text: "Sincronizando", className: "text-white/80", Icon: Loader2 },
  synced: { text: "Sincronizado", className: "text-ok", Icon: CheckCircle2 },
  sent: { text: "Enviado", className: "text-ok", Icon: CheckCircle2 },
  conflict: { text: "Precisa de decisão", className: "text-[#ff8fa0]", Icon: AlertTriangle },
  resolved: { text: "Conflito resolvido", className: "text-ok", Icon: CheckCircle2 },
};

export function OfflineSimulator() {
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const timers = useRef<number[]>([]);
  // Cópia sempre atualizada dos itens, para ler fora do setState
  // (agendar temporizadores dentro de um setState rodaria duas vezes no modo estrito).
  const itemsRef = useRef<Item[]>(items);
  const reduce = useReducedMotion();

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // A barra de comandos pode "derrubar a internet"
  useSiteEvent("ecosaude:set-offline", (value) => changeConnection(!value));

  const used = new Set(items.map((i) => i.kind));
  const pending = items.filter((i) => i.state === "local" || i.state === "queued").length;
  const busy = items.some((i) => i.state === "syncing");

  function addAction(kind: Kind) {
    const action = actions.find((a) => a.kind === kind);
    if (!action) return;
    const state: ItemState = online ? (kind === "mensagem" ? "sent" : "synced") : kind === "mensagem" ? "queued" : "local";
    setItems((prev) => [...prev, { kind, label: action.label, state, createdOffline: !online }]);
  }

  /** Liga/desliga a internet. Ao religar, sincroniza item por item. */
  function changeConnection(next: boolean) {
    setOnline(next);
    if (!next) return;

    const toSync = itemsRef.current
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.state === "local" || item.state === "queued");

    toSync.forEach(({ item, index }, order) => {
      const delay = reduce ? 0 : 450;
      // 1) marca como "sincronizando"
      timers.current.push(
        window.setTimeout(() => {
          setItems((cur) => cur.map((it, i) => (i === index ? { ...it, state: "syncing" } : it)));
        }, order * delay * 2),
      );
      // 2) resultado final: agenda feita offline gera conflito
      const final: ItemState =
        item.kind === "agenda" && item.createdOffline ? "conflict" : item.kind === "mensagem" ? "sent" : "synced";
      timers.current.push(
        window.setTimeout(() => {
          setItems((cur) => cur.map((it, i) => (i === index ? { ...it, state: final } : it)));
        }, order * delay * 2 + delay + 300),
      );
    });
  }

  function resolveConflict(keep: "paulo" | "sonia") {
    setItems((cur) =>
      cur.map((it) =>
        it.state === "conflict"
          ? {
              ...it,
              state: "resolved",
              label:
                keep === "paulo"
                  ? "Paulo Lima mantido às 09:30. Sônia Dias recebeu nova opção de horário."
                  : "Sônia Dias mantida às 09:30. Paulo Lima recebeu nova opção de horário.",
            }
          : it,
      ),
    );
  }

  function reset() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setItems([]);
    setOnline(true);
  }

  return (
    <div className="rounded-3xl bg-night-soft p-4 text-white ring-1 ring-white/10 sm:p-6">
      {/* Interruptor de conexão */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-10 place-items-center rounded-full transition-colors",
              online ? "bg-ok/20 text-ok-ink" : "bg-erp/20 text-erp",
            )}
            aria-hidden
          >
            {online ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
          </span>
          <div>
            <p className="font-semibold" aria-live="polite">
              {online ? "Internet conectada" : "Sem internet"}
            </p>
            <p className="text-sm text-white/65">
              {online
                ? busy
                  ? "Sincronizando o que ficou no aparelho"
                  : "Tudo sincronizado com a nuvem"
                : `${pending} ${pending === 1 ? "item espera" : "itens esperam"} a conexão voltar`}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label="Internet"
          onClick={() => changeConnection(!online)}
          disabled={busy}
          className={cn(
            "relative h-9 w-16 shrink-0 rounded-full transition-colors disabled:opacity-60",
            online ? "bg-ok" : "bg-white/20",
          )}
        >
          <motion.span
            className="absolute top-1 left-1 block size-7 rounded-full bg-white shadow"
            animate={{ x: online ? 28 : 0 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 32 }}
          />
        </button>
      </div>

      {/* Ações da rotina */}
      <div className="mt-5 grid grid-cols-1 gap-2 xs:grid-cols-2">
        {actions.map(({ kind, button, Icon }) => (
          <button
            key={kind}
            type="button"
            disabled={used.has(kind) || busy}
            onClick={() => addAction(kind)}
            className="flex min-h-12 items-center gap-2 rounded-xl bg-white/8 px-3 text-left text-[0.95rem] font-medium ring-1 ring-white/10 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon className="size-4 shrink-0 text-white/70" aria-hidden />
            {button}
          </button>
        ))}
      </div>

      {/* Painel de contingência: o que aconteceu com cada ação */}
      <div className="mt-5 min-h-40 rounded-2xl bg-night p-3 sm:p-4">
        {items.length === 0 ? (
          <p className="px-1 py-6 text-center text-[0.95rem] text-white/65">
            Desligue a internet no botão acima e use as ações da rotina.
            Depois religue para ver a sincronização.
          </p>
        ) : (
          <ul className="space-y-2" aria-live="polite">
            <AnimatePresence initial={false}>
              {items.map((item) => {
                const info = stateInfo[item.state];
                return (
                  <motion.li
                    key={item.kind}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl bg-white/6 p-3"
                  >
                    <p className="text-[0.95rem]">{item.label}</p>
                    <p className={cn("mt-1 flex items-center gap-1.5 text-sm font-semibold", info.className)}>
                      <info.Icon className={cn("size-4", item.state === "syncing" && "animate-spin")} aria-hidden />
                      {info.text}
                    </p>

                    {item.state === "conflict" ? (
                      <div className="mt-3 rounded-lg bg-white/6 p-3 text-sm">
                        <p>
                          Outro computador da recepção também marcou quinta às 09:30 para{" "}
                          <strong>Sônia Dias</strong> enquanto estava sem internet. Quem fica com o horário?
                        </p>
                        <div className="mt-3 flex flex-col gap-2 xs:flex-row">
                          <button
                            type="button"
                            onClick={() => resolveConflict("paulo")}
                            className="min-h-11 rounded-full bg-white px-4 font-semibold text-night hover:bg-crm-tint"
                          >
                            Manter Paulo Lima
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveConflict("sonia")}
                            className="min-h-11 rounded-full px-4 font-semibold ring-1 ring-white/30 hover:bg-white/10"
                          >
                            Manter Sônia Dias
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {items.length > 0 ? (
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <RotateCcw className="size-4" aria-hidden />
          Recomeçar simulação
        </button>
      ) : null}
    </div>
  );
}
