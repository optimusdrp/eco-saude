"use client";

import { Menu, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonStyles } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Logo } from "@/components/ui/Logo";
import { navigation } from "@/content/site";
import { useScrolled } from "@/hooks/useScrolled";
import { cn } from "@/lib/cn";
import { emit } from "@/lib/events";

/**
 * Cabeçalho fixo.
 * - Desktop (lg+): menu completo, botão da barra de comandos e CTA.
 * - Celular/tablet: botão de menu que abre um painel em tela cheia.
 */
export function Header() {
  const scrolled = useScrolled();
  const [open, setOpen] = useState(false);

  // Com o menu aberto: trava a rolagem do fundo e fecha com Esc.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow] duration-200",
        scrolled || open ? "bg-fog/90 shadow-[0_1px_0_var(--color-line)] backdrop-blur-md" : "bg-transparent",
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <a href="#inicio" className="rounded-md" aria-label="Tropi, voltar ao início" onClick={() => setOpen(false)}>
          <Logo />
        </a>

        {/* Menu desktop */}
        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {navigation.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-full px-3.5 py-2 text-[0.95rem] font-medium text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          {/* Abre a barra de comandos (o mesmo que Ctrl+K) */}
          <button
            type="button"
            onClick={() => emit("ecosaude:open-commands")}
            className="hidden min-h-11 items-center gap-2 rounded-full bg-paper px-4 text-sm text-ink-soft ring-1 ring-line transition hover:ring-ink/30 md:inline-flex"
          >
            <Search className="size-4" aria-hidden />
            Buscar
            <kbd className="rounded bg-fog px-1.5 py-0.5 font-sans text-xs text-ink-soft">Ctrl K</kbd>
          </button>

          <a href="#demonstracao" className={buttonStyles({ className: "hidden sm:inline-flex" })}>
            Pedir demonstração
          </a>

          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-ink/5 lg:hidden"
            aria-expanded={open}
            aria-controls="menu-movel"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
      </Container>

      {/* Painel do menu no celular/tablet */}
      <div
        id="menu-movel"
        hidden={!open}
        className="h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-fog lg:hidden"
      >
        <Container className="flex flex-col gap-2 py-6">
          <nav aria-label="Principal no celular">
            <ul className="flex flex-col">
              {navigation.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block border-b border-line py-4 font-display text-2xl font-semibold text-ink"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              emit("ecosaude:open-commands");
            }}
            className={buttonStyles({ variant: "secondary", size: "lg", className: "mt-4" })}
          >
            <Search className="size-4" aria-hidden />
            Buscar no site
          </button>
          <a
            href="#demonstracao"
            onClick={() => setOpen(false)}
            className={buttonStyles({ size: "lg" })}
          >
            Pedir demonstração
          </a>
        </Container>
      </div>
    </header>
  );
}
