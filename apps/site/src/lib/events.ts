import type { RoleId } from "@/types";

/**
 * Eventos do navegador usados para componentes conversarem entre si
 * sem precisar de um estado global (ex.: a barra de comandos troca o
 * perfil da demonstração do herói ou simula a queda de internet).
 *
 * Cada evento tem um nome único e um "payload" tipado.
 */
export interface SiteEvents {
  "ecosaude:open-commands": undefined;
  "ecosaude:set-role": RoleId;
  "ecosaude:set-offline": boolean;
}

/** Dispara um evento tipado. */
export function emit<K extends keyof SiteEvents>(name: K, detail?: SiteEvents[K]) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Escuta um evento tipado. Retorna a função para parar de escutar. */
export function listen<K extends keyof SiteEvents>(
  name: K,
  handler: (detail: SiteEvents[K]) => void,
): () => void {
  const wrapped = (event: Event) => handler((event as CustomEvent<SiteEvents[K]>).detail);
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}
