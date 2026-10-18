"use client";

import { useEffect, useState } from "react";

/**
 * Retorna true quando a página rolou mais que `offset` pixels.
 * Usado pelo cabeçalho para ganhar fundo e sombra ao rolar.
 */
export function useScrolled(offset = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > offset);
    onScroll(); // estado correto já no primeiro carregamento
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [offset]);

  return scrolled;
}
