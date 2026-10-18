import { cn } from "@/lib/cn";
import type { ComponentPropsWithoutRef } from "react";

/**
 * Container: limita a largura do conteúdo e aplica as margens laterais.
 * Margem de 16px no celular, crescendo em telas maiores.
 */
export function Container({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10", className)}
      {...props}
    />
  );
}
