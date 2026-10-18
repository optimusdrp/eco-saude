"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * PREFERÊNCIAS GUARDADAS NO NAVEGADOR (genérico)
 *
 * Cada pessoa monta a tela do seu jeito (densidade, quadros visíveis, ordem...)
 * sem mudar a de ninguém. Fica no localStorage do navegador:
 *  - se o navegador bloquear o armazenamento (modo privado), tudo funciona com o padrão;
 *  - useSyncExternalStore lê sem "piscar" e sem diferença entre servidor e navegador
 *    (no servidor vale o padrão; no navegador, o salvo);
 *  - várias abas ficam em sincronia (evento "storage").
 *
 * Uso:
 *   const [prefs, update, reset] = useStoredPrefs("eco:hoje:prefs:v1", DEFAULTS);
 *   update({ compact: true });
 */
const EVENT = "eco:prefs-change";

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function parse<T extends object>(raw: string, defaults: T): T {
  if (!raw) return defaults;
  try {
    return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return defaults;
  }
}

export function useStoredPrefs<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void, () => void] {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "");
  // Mesmo texto salvo = mesmo objeto (evita recalcular telas à toa)
  const prefs = useMemo(() => parse(raw, defaults), [raw, defaults]);

  const update = useCallback(
    (patch: Partial<T>) => {
      const next = { ...parse(read(key), defaults), ...patch };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* armazenamento bloqueado: a mudança não fica salva */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key, defaults],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignora */
    }
    window.dispatchEvent(new Event(EVENT));
  }, [key]);

  return [prefs, update, reset];
}
