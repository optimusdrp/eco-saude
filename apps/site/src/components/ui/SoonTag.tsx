import { cn } from "@/lib/cn";

/**
 * Etiqueta "Em breve": marca no site o que ainda está em desenvolvimento.
 * Regra do site: nada que o sistema ainda não faz aparece sem esta etiqueta.
 */
export function SoonTag({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        inverted ? "bg-white/12 text-white ring-1 ring-white/25" : "bg-sun-tint text-ink ring-1 ring-sun/40",
        className,
      )}
    >
      Em breve
    </span>
  );
}
