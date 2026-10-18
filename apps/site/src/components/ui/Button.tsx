import { cn } from "@/lib/cn";
import type { ComponentPropsWithoutRef } from "react";

/**
 * Estilos de botão reaproveitáveis.
 * Exportamos a função (e não só o componente) para que links <a>
 * também possam ter aparência de botão: buttonStyles({ variant: "primary" }).
 */
type Variant = "primary" | "secondary" | "ghost" | "light";
type Size = "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-crm text-white hover:bg-[#5a37cf] active:bg-[#4d2cbd]",
  secondary: "bg-paper text-ink ring-1 ring-line hover:ring-ink/40",
  ghost: "text-ink hover:bg-ink/5",
  light: "bg-white text-night hover:bg-crm-tint",
};

const sizes: Record<Size, string> = {
  // altura mínima de 44px = área de toque recomendada para celular
  md: "min-h-11 px-5 text-[0.95rem]",
  lg: "min-h-12 px-6 text-base",
};

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold",
    "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant],
    sizes[size],
    className,
  );
}

type ButtonProps = ComponentPropsWithoutRef<"button"> & { variant?: Variant; size?: Size };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonStyles({ variant, size, className })} {...props} />;
}
