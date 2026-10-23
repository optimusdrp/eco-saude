"use client";

import { Bell, CheckCheck, ShieldAlert, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/styles";
import { useAppEvent } from "@/lib/hooks";

/**
 * SINO DE AVISOS (barra superior, em todas as telas)
 *
 * - Consulta /api/avisos ao abrir a tela, a cada 20 s com a aba visível e quando a aba volta
 *   a ficar visível. Outras telas pedem atualização imediata com emit("eco:notices-refresh").
 * - Número vermelho = não lidos; pulsa se houver aviso urgente não lido.
 * - Clicar num aviso marca como lido e abre a tela que resolve (ex.: Prontuário > Ajustes).
 * - No celular o painel ocupa a largura da tela; no computador abre ancorado ao sino.
 */
interface Notice {
  id: string;
  kind: "pep_emergencia" | "triagem_urgente";
  title: string;
  body: string;
  href: string;
  urgent: boolean;
  createdAt: string;
  read: boolean;
}

const POLL_SECONDS = 20;

/** "agora", "há 5 min", "há 2 h", "21/10 14:30" */
function ago(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime()) / 60_000;
  if (diff < 1) return "agora";
  if (diff < 60) return `há ${Math.floor(diff)} min`;
  if (diff < 24 * 60) return `há ${Math.floor(diff / 60)} h`;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function NoticeBell() {
  const router = useRouter();
  const [data, setData] = useState<{ unread: number; items: Notice[] } | null>(null);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/avisos", { cache: "no-store" });
      if (!res.ok) return;
      setData((await res.json()) as { unread: number; items: Notice[] });
      setNow(Date.now());
    } catch {
      // Sem internet: tenta de novo na próxima volta
    }
  }, []);

  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void load();
    // Primeira consulta logo depois de montar (fora do corpo do efeito)
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, POLL_SECONDS * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  useAppEvent("eco:notices-refresh", () => void load());

  // Fecha com Esc ou clique fora
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function markRead(ids?: string[]) {
    // Otimista: some o número na hora; o servidor confirma
    setData((d) => (d ? { unread: ids ? Math.max(0, d.unread - d.items.filter((n) => ids.includes(n.id) && !n.read).length) : 0, items: d.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) } : d));
    await fetch("/api/avisos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { ids } : {}) }).catch(() => undefined);
  }

  const unread = data?.unread ?? 0;
  const urgentUnread = data?.items.some((n) => n.urgent && !n.read) ?? false;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Avisos: ${unread} não ${unread === 1 ? "lido" : "lidos"}` : "Avisos"}
        className="relative inline-flex size-10 items-center justify-center rounded-full bg-paper text-ink-soft ring-1 ring-line hover:text-ink hover:ring-ink/30"
      >
        <Bell className="size-5" aria-hidden />
        {unread ? (
          <span
            data-testid="notice-count"
            className={cn("absolute -top-1 -right-1 min-w-5 rounded-full bg-alert px-1 text-center text-[0.68rem] leading-5 font-bold text-white tabular", urgentUnread && "motion-safe:animate-pulse")}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Avisos"
          className="fixed inset-x-3 top-16 z-50 max-h-[70dvh] overflow-hidden rounded-2xl bg-paper shadow-xl ring-1 ring-line sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="font-display text-base font-bold">Avisos</p>
            {unread ? (
              <button type="button" onClick={() => void markRead()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-pep-ink hover:bg-fog">
                <CheckCheck className="size-4" aria-hidden />
                Marcar todos como lidos
              </button>
            ) : null}
          </div>
          {data?.items.length ? (
            <ul className="max-h-[calc(70dvh-3.5rem)] divide-y divide-line overflow-y-auto">
              {data.items.map((n) => {
                const Icon = n.kind === "pep_emergencia" ? ShieldAlert : Stethoscope;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        setOpen(false);
                        if (!n.read) await markRead([n.id]);
                        router.push(n.href);
                      }}
                      className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-fog", !n.read && "bg-alert-tint/40")}
                    >
                      <Icon className={cn("mt-0.5 size-5 shrink-0", n.urgent ? "text-alert" : "text-ink-soft")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("text-sm", n.read ? "font-medium" : "font-bold")}>{n.title}</span>
                          <span className="shrink-0 text-xs text-ink-soft">{ago(n.createdAt, now)}</span>
                        </span>
                        <span className="mt-0.5 block text-sm break-words text-ink-soft">{n.body}</span>
                      </span>
                      {!n.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-alert" aria-label="não lido" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-ink-soft">Nenhum aviso. Acessos de emergência ao prontuário e triagens urgentes aparecem aqui.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
