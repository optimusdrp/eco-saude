import { getModule } from "@/content/modules";
import { cn } from "@/lib/cn";
import type { ModuleId } from "@/types";

/**
 * Classes de cor por módulo.
 * Ficam num mapa fixo (e não montadas com template string) porque o
 * Tailwind só gera as classes que encontra escritas por extenso no código.
 */
export const moduleColor: Record<ModuleId, { dot: string; tag: string; text: string; ring: string; bg: string }> = {
  crm: { dot: "bg-crm", tag: "bg-crm-tint text-crm", text: "text-crm", ring: "ring-crm", bg: "bg-crm" },
  erp: { dot: "bg-erp", tag: "bg-erp-tint text-erp-ink", text: "text-erp-ink", ring: "ring-erp", bg: "bg-erp" },
  pep: { dot: "bg-pep", tag: "bg-pep-tint text-pep-ink", text: "text-pep-ink", ring: "ring-pep", bg: "bg-pep" },
  bi: { dot: "bg-bi", tag: "bg-bi-tint text-bi", text: "text-bi", ring: "ring-bi", bg: "bg-bi" },
  lab: { dot: "bg-lab", tag: "bg-lab-tint text-lab-ink", text: "text-lab-ink", ring: "ring-lab", bg: "bg-lab" },
};

/** Etiqueta pequena com o nome do módulo e sua cor. */
export function ModuleTag({ id, className }: { id: ModuleId; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        moduleColor[id].tag,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", moduleColor[id].dot)} aria-hidden />
      {getModule(id).name}
    </span>
  );
}
