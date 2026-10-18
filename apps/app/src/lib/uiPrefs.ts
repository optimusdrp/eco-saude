"use client";

import { useEffect } from "react";
import { useStoredPrefs } from "./useStoredPrefs";

/**
 * PREFERÊNCIAS GERAIS DA INTERFACE (neste navegador)
 * Hoje: tamanho do texto. O app inteiro usa "rem", então mudar o tamanho da
 * fonte da página aumenta textos, botões e espaçamentos juntos (acessibilidade).
 */
export interface UiPrefs {
  textSize: "normal" | "grande" | "maior";
}
export const DEFAULT_UI_PREFS: UiPrefs = { textSize: "normal" };
export const UI_PREFS_KEY = "eco:ui:prefs:v1";
export const TEXT_SIZE_PERCENT: Record<UiPrefs["textSize"], number> = { normal: 100, grande: 112.5, maior: 125 };

export function useUiPrefs() {
  return useStoredPrefs(UI_PREFS_KEY, DEFAULT_UI_PREFS);
}

/** Aplica as preferências na página (colocado uma vez no AppShell). */
export function UiPrefsSync() {
  const [prefs] = useUiPrefs();
  useEffect(() => {
    document.documentElement.style.fontSize = prefs.textSize === "normal" ? "" : `${TEXT_SIZE_PERCENT[prefs.textSize]}%`;
  }, [prefs.textSize]);
  return null;
}
