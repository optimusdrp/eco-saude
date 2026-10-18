"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { listen, type AppEvents } from "./events";

/** Escuta um evento do app (ver lib/events.ts). */
export function useAppEvent<K extends keyof AppEvents>(name: K, handler: (detail: AppEvents[K]) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => listen(name, (d) => ref.current(d)), [name]);
}

/**
 * Atualiza os dados da página a cada `seconds`, só com a aba visível.
 * Simples e suficiente para a fase de testes. Em produção dá para trocar por
 * eventos em tempo real (SSE/WebSocket) sem mudar as telas.
 */
export function useAutoRefresh(seconds: number) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
}

/**
 * Está com internet? Base do futuro modo offline: hoje só avisa a pessoa;
 * na próxima etapa, as ações passam a ir para uma fila local.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Relógio que atualiza a cada `ms` (para contadores de espera ao vivo). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Relógio "ao vivo" que começa no horário do SERVIDOR.
 * Por quê: se o primeiro desenho usasse Date.now() do navegador, o texto
 * ("em 25 min") poderia sair diferente do que o servidor desenhou e o React
 * reclamaria (hydration mismatch). Começa igual e, logo depois, passa a
 * seguir o relógio do navegador a cada `ms`.
 */
export function useLiveNow(serverNowMs: number, ms = 30_000): number {
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 500);
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [ms]);
  return now;
}
