"use client";

import { useStoredPrefs } from "@/lib/useStoredPrefs";
import { DEFAULT_PREFS, type AgendaPrefs } from "./types";

/**
 * PREFERÊNCIAS DA AGENDA (densidade, cores, filtros...)
 * Ficam no navegador de cada pessoa (ver lib/useStoredPrefs.ts).
 */
export function useAgendaPrefs(): [AgendaPrefs, (patch: Partial<AgendaPrefs>) => void, () => void] {
  return useStoredPrefs("eco:agenda:prefs:v1", DEFAULT_PREFS);
}
