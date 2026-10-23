"use client";

/**
 * MENU DOS AJUSTES
 * Desktop: coluna lateral fixa, agrupada (Você, Clínica, Atendimento, Gestão),
 *          com busca que encontra o ajuste pelo nome ou por palavras ("senha", "whatsapp"...).
 * Celular: uma faixa de atalhos com rolagem lateral.
 */
import {
  BadgeCheck,
  Building2,
  DoorOpen,
  KeyRound,
  LayoutGrid,
  MessageSquareText,
  MessagesSquare,
  Plug,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  UserCog,
  UserRound,
  Users,
  Workflow,
  ClipboardList,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui/styles";
import type { SettingsGroup, SettingsIcon } from "./catalog";

export const SETTINGS_ICONS: Record<SettingsIcon, typeof UserRound> = {
  conta: KeyRound,
  preferencias: SlidersHorizontal,
  clinica: Building2,
  automacoes: Workflow,
  mensagens: MessagesSquare,
  canais: Plug,
  respostas: MessageSquareText,
  retornos: RotateCcw,
  equipe: Users,
  perfis: UserCog,
  seguranca: ShieldCheck,
  plano: BadgeCheck,
  ia: Sparkles,
  duracoes: Timer,
  unidades: DoorOpen,
  prontuario: Stethoscope,
  formularios: ClipboardList,
};

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function SettingsTabs({ groups }: { groups: SettingsGroup[] }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const term = plain(q.trim());
  const match = (i: SettingsGroup["items"][number]) => !term || [i.label, i.hint, ...i.keywords].some((t) => plain(t).includes(term));
  const all = groups.flatMap((g) => g.items);
  // Item ativo: o de endereço mais longo que combina (Prontuário x Prontuário > Formulários)
  const activeHref = all.map((i) => i.href).filter((h) => path === h || path.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];

  return (
    <>
      {/* Celular/tablet: atalhos em faixa */}
      <nav aria-label="Ajustes" className="thin-scroll -mx-3 mb-4 overflow-x-auto px-3 sm:-mx-5 sm:px-5 lg:hidden">
        <ul className="flex w-max gap-1.5">
          <li>
            <Link href="/configuracoes" aria-current={path === "/configuracoes" ? "page" : undefined} className={chip(path === "/configuracoes")}>
              <LayoutGrid className="size-4" aria-hidden /> Visão geral
            </Link>
          </li>
          {all.map((i) => {
            const Icon = SETTINGS_ICONS[i.icon];
            const active = i.href === activeHref;
            return (
              <li key={i.href}>
                <Link href={i.href} aria-current={active ? "page" : undefined} className={chip(active)}>
                  <Icon className="size-4" aria-hidden /> {i.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop: coluna lateral */}
      <aside aria-label="Ajustes" className="hidden lg:block">
        <div className="thin-scroll sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pr-1">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
            <label htmlFor="ajustes-q" className="sr-only">
              Buscar ajuste
            </label>
            <input
              id="ajustes-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar ajuste"
              className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
            />
          </div>
          <Link
            href="/configuracoes"
            aria-current={path === "/configuracoes" ? "page" : undefined}
            className={cn(
              "mb-3 flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold",
              path === "/configuracoes" ? "bg-ink text-white" : "text-ink-soft hover:bg-paper hover:text-ink",
            )}
          >
            <LayoutGrid className="size-4" aria-hidden /> Visão geral
          </Link>
          {groups.map((g) => {
            const items = g.items.filter(match);
            if (!items.length) return null;
            return (
              <div key={g.label} className="mb-3">
                <p className="mb-1 px-3 text-xs font-bold text-ink-soft">{g.label}</p>
                <ul className="space-y-0.5">
                  {items.map((i) => {
                    const Icon = SETTINGS_ICONS[i.icon];
                    const active = i.href === activeHref;
                    return (
                      <li key={i.href}>
                        <Link
                          href={i.href}
                          aria-current={active ? "page" : undefined}
                          title={i.hint}
                          className={cn("flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold", active ? "bg-ink text-white" : "text-ink-soft hover:bg-paper hover:text-ink")}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          <span className="truncate">{i.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {term && !all.some(match) ? <p className="px-3 text-sm text-ink-soft">Nenhum ajuste com “{q}”.</p> : null}
        </div>
      </aside>
    </>
  );
}

function chip(active: boolean) {
  return cn(
    "inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap ring-1",
    active ? "bg-ink text-white ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink",
  );
}
