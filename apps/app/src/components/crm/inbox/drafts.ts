"use client";

import { useSyncExternalStore } from "react";

/**
 * RASCUNHOS por conversa (neste navegador).
 * Começou a escrever, trocou de conversa e voltou: o texto continua lá.
 * A lista mostra "Rascunho" nas conversas com texto não enviado.
 * Tudo em try/catch: com o armazenamento bloqueado, só não salva.
 */
const PREFIX = "eco:rascunho:";
const EVENT = "eco:drafts";

export function readDraft(id: string): string {
  try {
    return window.localStorage.getItem(PREFIX + id) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(id: string, body: string) {
  try {
    if (body.trim()) window.localStorage.setItem(PREFIX + id, body);
    else window.localStorage.removeItem(PREFIX + id);
  } catch {
    /* armazenamento bloqueado */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** IDs das conversas com rascunho (texto separado por vírgula, para comparar barato) */
function draftIds(): string {
  try {
    const ids: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) ids.push(k.slice(PREFIX.length));
    }
    return ids.sort().join(",");
  } catch {
    return "";
  }
}

export function useDraftIds(): Set<string> {
  const raw = useSyncExternalStore(subscribe, draftIds, () => "");
  return new Set(raw ? raw.split(",") : []);
}

/** true depois que a página "acordou" no navegador (para ler o armazenamento sem divergir do servidor) */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
