"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/styles";

/** Abas do Prontuário (só as que o perfil pode usar). Rolam na horizontal no celular. */
export function PepTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Seções do prontuário" className="-mx-3 mb-5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-full bg-paper p-1 ring-1 ring-line">
        {tabs.map((t) => {
          const active = t.href === "/prontuario" ? path === t.href : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn("inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap", active ? "bg-pep text-white" : "text-ink-soft hover:text-ink")}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
