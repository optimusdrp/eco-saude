import { cn } from "@/lib/cn";
import type { ReactNode } from "react";
import { SoonTag } from "./SoonTag";

/**
 * Título + texto de apoio de cada seção.
 * O id do título é usado em aria-labelledby da <section>, para leitores de tela.
 */
export function SectionHeading({
  id,
  title,
  children,
  inverted = false,
  soon = false,
  className,
}: {
  id: string;
  title: string;
  /** Recurso ainda em desenvolvimento: mostra a etiqueta "Em breve" acima do título */
  soon?: boolean;
  children?: ReactNode;
  inverted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {soon ? <SoonTag inverted={inverted} className="mb-4" /> : null}
      <h2
        id={id}
        className={cn(
          "text-[2rem] font-bold sm:text-[2.6rem] lg:text-5xl",
          inverted ? "text-white" : "text-ink",
        )}
      >
        {title}
      </h2>
      {children ? (
        <p className={cn("mt-4 text-lg", inverted ? "text-white/75" : "text-ink-soft")}>{children}</p>
      ) : null}
    </div>
  );
}
