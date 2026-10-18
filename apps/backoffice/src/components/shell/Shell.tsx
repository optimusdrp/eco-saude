"use client";

import {
  Boxes,
  Building2,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  UserCog,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { logoutAction } from "@/lib/auth/actions";
import { LogoMark } from "./LogoMark";

/**
 * "Casco" do backoffice: menu lateral (desktop) e gaveta (celular/tablet).
 * Recebe do servidor só os itens que o perfil do usuário pode ver,
 * então quem não tem permissão nem vê o link.
 */
export interface NavLink {
  href: string;
  label: string;
  icon: "dashboard" | "leads" | "clinics" | "catalog" | "staff" | "audit";
  badge?: number;
}

const icons = {
  dashboard: LayoutDashboard,
  leads: Inbox,
  clinics: Building2,
  catalog: Boxes,
  staff: Users,
  audit: ScrollText,
};

export function Shell({
  links,
  user,
  children,
}: {
  links: NavLink[];
  user: { name: string; roleLabel: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Fecha a gaveta com a tecla Esc (ao clicar num link ela também fecha, ver onClick)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav aria-label="Menu do backoffice" className="flex flex-1 flex-col">
      <ul className="space-y-1">
        {links.map((link) => {
          const Icon = icons[link.icon];
          const active = isActive(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium transition-colors",
                  active ? "bg-white text-night" : "text-white/75 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="size-[1.15rem] shrink-0" aria-hidden />
                <span className="flex-1">{link.label}</span>
                {link.badge ? (
                  <span
                    className={cn(
                      "rounded-full px-2 text-xs font-bold tabular",
                      "bg-crm text-white",
                    )}
                    aria-label={`${link.badge} novos`}
                  >
                    {link.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto space-y-1 border-t border-white/10 pt-4">
        <Link
          href="/conta"
          onClick={() => setOpen(false)}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-xl px-3 transition-colors",
            isActive("/conta") ? "bg-white text-night" : "text-white/75 hover:bg-white/10 hover:text-white",
          )}
        >
          <UserCog className="size-[1.15rem] shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[0.95rem] font-semibold">{user.name}</span>
            <span className="block text-xs opacity-75">{user.roleLabel}</span>
          </span>
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[0.95rem] text-white/75 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-[1.15rem]" aria-hidden />
            Sair
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Menu fixo no desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto bg-night p-4 lg:flex">
        <Brand />
        {nav}
      </aside>

      {/* Barra superior no celular/tablet */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-night px-3 text-white lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={open}
          aria-controls="menu-gaveta"
          className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-white/10"
        >
          <Menu aria-hidden />
        </button>
      </header>

      {/* Gaveta lateral no celular/tablet */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div id="menu-gaveta" className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col gap-6 overflow-y-auto bg-night p-4">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="inline-flex size-11 items-center justify-center rounded-xl text-white hover:bg-white/10"
              >
                <X aria-hidden />
              </button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}

      <main id="conteudo" className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {children}
      </main>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg px-1 text-white">
      <LogoMark className="size-7" />
      <span className="font-display text-lg font-bold">Backoffice</span>
    </Link>
  );
}
