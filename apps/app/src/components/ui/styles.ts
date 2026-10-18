/**
 * Funções de estilo SEM "use client": podem ser usadas tanto em
 * Server Components quanto em componentes do navegador.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes e resolve conflitos do Tailwind (ex.: "p-2" + "p-4" = "p-4"). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";

const variants: Record<Variant, string> = {
  primary: "bg-crm text-white hover:bg-[#5a37cf]",
  secondary: "bg-paper text-ink ring-1 ring-line hover:ring-ink/35",
  ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink",
  danger: "bg-paper text-alert ring-1 ring-alert/40 hover:bg-alert-tint",
  dark: "bg-ink text-white hover:bg-night",
};

export function buttonStyles(variant: Variant = "primary", className?: string) {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors sm:min-h-10",
    "disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant],
    className,
  );
}

