"use client";

import { Award, CalendarClock, ClipboardPlus, Stethoscope, CalendarDays, Hourglass, ListChecks, Lock, LogOut, Menu, MessagesSquare, Radio, Route, Search, Settings, Sun, Users, Wifi, WifiOff, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/styles";
import { logoutAction } from "@/lib/auth/actions";
import { emit } from "@/lib/events";
import { useAppEvent, useOnline } from "@/lib/hooks";
import { CommandPalette } from "./CommandPalette";
import { NoticeBell } from "./NoticeBell";
import { LogoMark } from "./LogoMark";
import { PatientRail } from "./PatientRail";
import { ScheduleDialog, type ProfessionalOption } from "./ScheduleDialog";
import { Simulator } from "./Simulator";
import { UiPrefsSync } from "@/lib/uiPrefs";

/**
 * Casca do ambiente da clínica.
 *
 * Desktop: trilho de navegação à esquerda, barra superior com módulos e busca,
 *          e o TRILHO DO PACIENTE à direita (abre ao clicar num paciente em
 *          qualquer tela e pode ser fixado para acompanhar a navegação).
 * Celular: barra inferior com 4 atalhos + "Mais"; o trilho vira uma folha.
 */

export type NavIcon = "hoje" | "conversas" | "agenda" | "jornada" | "pacientes" | "retornos" | "espera" | "tarefas" | "qualidade" | "prontuario" | "consultorio" | "config";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
  /** Aparece na barra inferior do celular */
  primary?: boolean;
}

export interface ModuleItem {
  id: "crm" | "erp" | "pep" | "bi";
  label: string;
  enabled: boolean;
}

const icons = {
  hoje: Sun,
  conversas: MessagesSquare,
  agenda: CalendarDays,
  jornada: Route,
  pacientes: Users,
  retornos: CalendarClock,
  espera: Hourglass,
  tarefas: ListChecks,
  qualidade: Award,
  prontuario: ClipboardPlus,
  consultorio: Stethoscope,
  config: Settings,
};

const moduleDot = { crm: "bg-crm", erp: "bg-erp", pep: "bg-pep", bi: "bg-bi" };

/** Tela inicial de cada módulo contratado (os demais mostram a apresentação em /modulos/<id>) */
const moduleHome: Partial<Record<ModuleItem["id"], string>> = { crm: "/hoje", pep: "/consultorio" };

/** Qual módulo a tela atual pertence (destaca o chip na barra superior) */
function activeModule(pathname: string): ModuleItem["id"] | null {
  if (pathname.startsWith("/prontuario") || pathname.startsWith("/consultorio")) return "pep";
  const m = pathname.match(/^\/modulos\/(crm|erp|pep|bi)/);
  if (m) return m[1] as ModuleItem["id"];
  if (pathname.startsWith("/configuracoes")) return null;
  return "crm";
}

/* ------------------------- Contexto do trilho do paciente ------------------------- */

interface RailState {
  contactId: string | null;
  pinned: boolean;
  open: (id: string) => void;
  close: () => void;
  togglePin: () => void;
}
const RailContext = createContext<RailState | null>(null);

export function useRail(): RailState {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error("useRail fora do AppShell");
  return ctx;
}

/* ----------------------------------- Casca ----------------------------------- */

export function AppShell({
  user,
  clinicName,
  nav,
  modules,
  professionals,
  simulator,
  channelAlert = null,
  children,
}: {
  user: { name: string; roleLabel: string };
  clinicName: string;
  nav: NavItem[];
  modules: ModuleItem[];
  professionals: ProfessionalOption[];
  simulator: boolean;
  /** Canais conectados que caíram (a fila espera; alguém precisa reconectar) */
  channelAlert?: { channels: string[]; canFix: boolean } | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const online = useOnline();
  const [moreOpen, setMoreOpen] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);

  // Qualquer componente pode abrir o trilho com emit("eco:open-patient", id)
  useAppEvent("eco:open-patient", (id) => setContactId(id));

  // Ao navegar, o trilho fecha, a não ser que esteja fixado
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (!pinned) setContactId(null);
    setMoreOpen(false);
  }

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const rail: RailState = {
    contactId,
    pinned,
    open: setContactId,
    close: () => {
      setContactId(null);
      setPinned(false);
    },
    togglePin: () => setPinned((p) => !p),
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href.startsWith("/prontuario") && pathname.startsWith("/prontuario"));
  const main = nav.filter((n) => n.icon !== "config");
  const current = activeModule(pathname);
  const homeHref = nav[0]?.href ?? "/configuracoes";
  // Prontuário: a primeira tela dele que a pessoa pode abrir (Consultório ou Prontuário)
  const pepHome = nav.find((n) => n.icon === "consultorio" || n.icon === "prontuario")?.href;
  const moduleHref = (m: ModuleItem) => (!m.enabled ? `/modulos/${m.id}` : m.id === "pep" ? (pepHome ?? `/modulos/${m.id}`) : (moduleHome[m.id] ?? `/modulos/${m.id}`));
  const config = nav.find((n) => n.icon === "config");

  return (
    <RailContext.Provider value={rail}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[5.75rem_minmax(0,1fr)] print:block">
        {/* ------------------------- Trilho de navegação (desktop) ------------------------- */}
        <aside className="sticky top-0 hidden h-dvh flex-col items-center gap-2 bg-night py-4 lg:flex print:hidden" aria-label="Navegação principal">
          <Link href={homeHref} className="mb-3 rounded-xl p-1" aria-label="Tropi, ir para o início">
            <LogoMark className="size-9" onDark />
          </Link>
          <nav className="flex w-full flex-1 flex-col items-center gap-1 px-2">
            {main.map((item) => (
              <RailLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </nav>
          {config ? <RailLink item={config} active={isActive(config.href)} /> : null}
          <form action={logoutAction} className="w-full px-2">
            <button type="submit" className="flex w-full flex-col items-center gap-1 rounded-xl py-2 text-[0.68rem] font-semibold text-white/60 hover:bg-white/10 hover:text-white">
              <LogOut className="size-5" aria-hidden />
              Sair
            </button>
          </form>
        </aside>

        <div className={cn("flex min-w-0 flex-col", contactId && pinned ? "lg:pr-[23rem]" : "")}>
          {/* --------------------------------- Barra superior --------------------------------- */}
          <header className="sticky top-0 z-30 border-b border-line bg-fog/90 backdrop-blur print:hidden">
            <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
              <Link href={homeHref} className="lg:hidden" aria-label="Tropi, ir para o início">
                <LogoMark className="size-8" />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-base font-bold leading-tight">{clinicName}</p>
                <p className="truncate text-xs text-ink-soft">
                  {user.name}, {user.roleLabel}
                </p>
              </div>

              {/* Módulos: os não contratados aparecem com cadeado (didático, sem esconder o ecossistema) */}
              <nav aria-label="Módulos" className="hidden items-center gap-1 rounded-full bg-paper p-1 ring-1 ring-line md:flex">
                {modules.map((m) => (
                  <Link
                    key={m.id}
                    href={moduleHref(m)}
                    aria-current={current === m.id ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold",
                      current === m.id ? "bg-ink text-white" : "text-ink-soft hover:text-ink",
                    )}
                  >
                    {m.enabled ? <span className={cn("size-2 rounded-full", moduleDot[m.id])} aria-hidden /> : <Lock className="size-3.5" aria-label="não contratado" />}
                    {m.label}
                  </Link>
                ))}
              </nav>

              <span
                role="status"
                className={cn("hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold sm:inline-flex", online ? "bg-ok-tint text-ok-ink" : "bg-erp-tint text-erp-ink")}
              >
                {online ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
                {online ? "Conectado" : "Sem internet"}
              </span>

              {/* Avisos ativos (acesso de emergência, triagem urgente) */}
              <NoticeBell />

              <button
                type="button"
                onClick={() => emit("eco:open-commands")}
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-paper px-3 text-sm text-ink-soft ring-1 ring-line hover:ring-ink/30"
                aria-label="Buscar (Ctrl+K)"
              >
                <Search className="size-4" aria-hidden />
                <span className="hidden sm:inline">Buscar</span>
                <kbd className="hidden rounded bg-fog px-1.5 text-xs xl:inline">Ctrl K</kbd>
              </button>
            </div>
            {!online ? (
              <p className="border-t border-erp/30 bg-erp-tint px-4 py-1.5 text-center text-xs font-semibold text-erp-ink">
                Sem internet. Consultas continuam visíveis; envios ficam para quando a conexão voltar (modo offline completo na próxima etapa).
              </p>
            ) : null}
            {channelAlert ? (
              <p role="alert" className="border-t border-alert/30 bg-alert-tint px-4 py-1.5 text-center text-xs font-semibold text-alert">
                {channelAlert.channels.join(" e ")} desconectado: as mensagens esperam na fila.{" "}
                {channelAlert.canFix ? (
                  <Link href="/configuracoes/canais" className="underline underline-offset-2">
                    Reconectar
                  </Link>
                ) : (
                  "Avise a gestão da clínica."
                )}
              </p>
            ) : null}
          </header>

          <main id="conteudo" className="min-w-0 flex-1 px-3 pt-4 pb-28 sm:px-5 lg:px-8 lg:pb-10">
            {children}
          </main>
        </div>

        {/* --------------------------- Barra inferior (celular) --------------------------- */}
        <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
          <ul className="grid grid-cols-5">
            {main
              .filter((n) => n.primary)
              .slice(0, 4)
              .map((item) => (
                <li key={item.href}>
                  <TabLink item={item} active={isActive(item.href)} />
                </li>
              ))}
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-expanded={moreOpen}
                className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold text-ink-soft"
              >
                <Menu className="size-5" aria-hidden />
                Mais
              </button>
            </li>
          </ul>
        </nav>

        {/* Folha "Mais" (celular) */}
        {moreOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Mais opções">
            <button type="button" aria-label="Fechar" className="absolute inset-0 bg-ink/40" onClick={() => setMoreOpen(false)} />
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-paper p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-lg font-bold">Mais</p>
                <button type="button" onClick={() => setMoreOpen(false)} aria-label="Fechar" className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-ink/5">
                  <X aria-hidden />
                </button>
              </div>
              <ul className="grid grid-cols-3 gap-2">
                {nav
                  .filter((n) => !n.primary)
                  .map((item) => {
                    const Icon = icons[item.icon];
                    return (
                      <li key={item.href}>
                        <Link href={item.href} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-fog text-sm font-semibold">
                          <Icon className="size-5" aria-hidden />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                {simulator ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        emit("eco:open-simulator");
                      }}
                      className="flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl bg-crm-tint text-sm font-semibold text-crm"
                    >
                      <Radio className="size-5" aria-hidden />
                      Simulador
                    </button>
                  </li>
                ) : null}
                <li>
                  <form action={logoutAction}>
                    <button type="submit" className="flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl bg-fog text-sm font-semibold">
                      <LogOut className="size-5" aria-hidden />
                      Sair
                    </button>
                  </form>
                </li>
              </ul>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Módulos">
                {modules.map((m) => (
                  <li key={m.id}>
                    <Link href={moduleHref(m)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-fog px-3 text-sm font-semibold">
                      {m.enabled ? <span className={cn("size-2 rounded-full", moduleDot[m.id])} aria-hidden /> : <Lock className="size-3.5" aria-label="não contratado" />}
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <PatientRail />
        <CommandPalette nav={nav} />
        <ScheduleDialog professionals={professionals} />
        <UiPrefsSync />
        {simulator ? (
          <div className="print:hidden">
            <Simulator />
          </div>
        ) : null}
      </div>
    </RailContext.Provider>
  );
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = icons[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full flex-col items-center gap-1 rounded-xl py-2 text-[0.68rem] font-semibold transition-colors",
        active ? "bg-white text-night" : "text-white/70 hover:bg-white/10 hover:text-white",
      )}
    >
      <Icon className="size-5" aria-hidden />
      {item.label}
      {item.badge ? (
        <span className="absolute top-1 right-2 min-w-5 rounded-full bg-alert px-1 text-center text-[0.65rem] leading-5 font-bold text-white tabular" aria-label={`${item.badge} aguardando`}>
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = icons[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold", active ? "text-crm" : "text-ink-soft")}
    >
      <Icon className="size-5" aria-hidden />
      {item.label}
      {item.badge ? (
        <span className="absolute top-1.5 left-1/2 ml-2 min-w-5 rounded-full bg-alert px-1 text-center text-[0.65rem] leading-5 font-bold text-white tabular">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
    </Link>
  );
}
