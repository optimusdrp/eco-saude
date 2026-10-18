import { FIRST_RESPONSE_TARGET_MIN } from "@ecosaude/core/crm";
import { initials } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";

/**
 * ANEL DE ESPERA
 * Avatar com um anel que "enche" enquanto o paciente espera resposta:
 * verde no começo, âmbar na metade da meta e vermelho quando a meta de
 * primeira resposta (15 min) estoura. Dá para ver a fila inteira de relance.
 */
export function WaitRing({ name, since, now, size = "md" }: { name: string; since: Date | null; now: number; size?: "md" | "lg" }) {
  const minutes = since ? (now - since.getTime()) / 60_000 : 0;
  const p = since ? Math.min(1, minutes / FIRST_RESPONSE_TARGET_MIN) : 0;
  const color = !since ? "transparent" : p < 0.5 ? "var(--color-pep)" : p < 1 ? "var(--color-erp)" : "var(--color-alert)";
  const dims = size === "lg" ? "size-14 text-base" : "size-11 text-sm";
  return (
    <span
      className={cn("wait-ring inline-flex shrink-0 items-center justify-center rounded-full p-[3px]", dims)}
      style={{ "--p": p, "--ring": color } as React.CSSProperties}
      aria-hidden
    >
      <span className="flex size-full items-center justify-center rounded-full bg-paper font-bold text-ink">{initials(name)}</span>
    </span>
  );
}
