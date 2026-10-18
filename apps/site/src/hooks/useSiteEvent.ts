"use client";

import { useEffect, useRef } from "react";
import { listen, type SiteEvents } from "@/lib/events";

/**
 * Hook para escutar um evento do site dentro de um componente React.
 * Guardamos o handler em uma ref para não reinscrever o listener
 * a cada renderização (evita vazamento e chamadas duplicadas).
 */
export function useSiteEvent<K extends keyof SiteEvents>(
  name: K,
  handler: (detail: SiteEvents[K]) => void,
) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => listen(name, (detail) => handlerRef.current(detail)), [name]);
}
