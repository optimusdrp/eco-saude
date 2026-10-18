import { siteConfig } from "@/content/site";
import { cn } from "@/lib/cn";

/**
 * Marca: quatro pétalas, uma para cada módulo, encontrando-se no centro.
 * A mesma ideia do produto: módulos independentes que formam um só ambiente.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* Cada pétala é uma gota girada 90° em torno do centro (16,16) */}
      <path d="M16 15C16 8 12 3 7 3C5 8 9 14 16 15Z" fill="var(--color-crm)" />
      <path d="M17 16C24 16 29 12 29 7C24 5 18 9 17 16Z" fill="var(--color-erp)" />
      <path d="M16 17C16 24 20 29 25 29C27 24 23 18 16 17Z" fill="var(--color-pep)" />
      <path d="M15 16C8 16 3 20 3 25C8 27 14 23 15 16Z" fill="var(--color-bi)" />
    </svg>
  );
}

export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span
        className={cn(
          "font-display text-xl font-bold tracking-tight",
          inverted ? "text-white" : "text-ink",
        )}
      >
        {siteConfig.name}
      </span>
    </span>
  );
}
