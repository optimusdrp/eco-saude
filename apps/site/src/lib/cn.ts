import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Junta classes CSS de forma segura.
 * - clsx: permite condicionais, ex.: cn("a", ativo && "b").
 * - twMerge: resolve conflitos do Tailwind, ex.: cn("p-2", "p-4") => "p-4".
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
