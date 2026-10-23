/**
 * Componentes de exibição sem interatividade (servem em Server Components,
 * sem enviar JavaScript ao navegador).
 */
import { CHANNEL_LABEL, JOURNEY_STAGE_LABEL, type Channel, type JourneyStage } from "@ecosaude/core/crm";
import type { ReactNode } from "react";
import { cn } from "./styles";

/* ---------------------------------- Badge ---------------------------------- */

export type Tone = "neutral" | "crm" | "erp" | "pep" | "bi" | "alert" | "success" | "warning" | "dark";

const toneClass: Record<Tone, string> = {
  neutral: "bg-fog text-ink-soft ring-1 ring-line",
  crm: "bg-crm-tint text-crm",
  erp: "bg-erp-tint text-erp-ink",
  pep: "bg-pep-tint text-pep-ink",
  bi: "bg-bi-tint text-bi",
  alert: "bg-alert-tint text-alert",
  success: "bg-ok-tint text-ok-ink",
  warning: "bg-erp-tint text-erp-ink",
  dark: "bg-ink text-white",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

/* --------------------------------- Canais ---------------------------------- */

export const channelDot: Record<Channel, string> = {
  whatsapp: "bg-ch-whatsapp",
  telegram: "bg-ch-telegram",
  instagram: "bg-ch-instagram",
  facebook: "bg-ch-facebook",
};

const channelText: Record<Channel, string> = {
  whatsapp: "text-ch-whatsapp",
  telegram: "text-ch-telegram",
  instagram: "text-ch-instagram",
  facebook: "text-ch-facebook",
};

/** Etiqueta do canal (cor + nome). A cor nunca é a única pista: o nome sempre aparece. */
export function ChannelBadge({ channel, compact = false }: { channel: Channel; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", channelText[channel])}>
      <span className={cn("size-2 rounded-full", channelDot[channel])} aria-hidden />
      {compact ? <span className="sr-only">{CHANNEL_LABEL[channel]}</span> : CHANNEL_LABEL[channel]}
    </span>
  );
}

/** Cor do profissional na agenda (classes escritas por extenso para o Tailwind gerar). */
export const proColor: Record<string, { dot: string; soft: string; border: string }> = {
  crm: { dot: "bg-crm", soft: "bg-crm-tint", border: "border-crm" },
  erp: { dot: "bg-erp", soft: "bg-erp-tint", border: "border-erp" },
  pep: { dot: "bg-pep", soft: "bg-pep-tint", border: "border-pep" },
  bi: { dot: "bg-bi", soft: "bg-bi-tint", border: "border-bi" },
};
export const colorOf = (c: string) => proColor[c] ?? proColor.crm!;

/* --------------------------------- Jornada --------------------------------- */

export const stageTone: Record<JourneyStage, Tone> = {
  novo: "crm",
  em_conversa: "bi",
  agendado: "warning",
  paciente: "success",
  reativar: "alert",
  perdido: "neutral",
};

export function StageBadge({ stage }: { stage: JourneyStage }) {
  return <Badge tone={stageTone[stage]}>{JOURNEY_STAGE_LABEL[stage]}</Badge>;
}

/* --------------------------------- Avatar ---------------------------------- */

const avatarColors = ["bg-crm-tint text-crm", "bg-ok-tint text-ok-ink", "bg-bi-tint text-bi", "bg-erp-tint text-erp-ink"];

export function initials(name: string): string {
  const parts = name.replace(/^(dra?\.?|sr\.?|sra\.?)\s+/i, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Avatar com iniciais; a cor é estável para o mesmo nome. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const color = avatarColors[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarColors.length];
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" };
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", color, sizes[size], className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

/* -------------------------------- Estrutura -------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm font-semibold text-crm">{eyebrow}</div> : null}
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description ? <div className="mt-1 max-w-2xl text-ink-soft">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5", className)}>
      {title ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{title}</h2>
            {description ? <p className="text-sm text-ink-soft">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-ink/20 px-4 py-8 text-center", className)}>
      <p className="font-display text-lg font-bold">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-ink-soft">{children}</div> : null}
    </div>
  );
}

/** Cartão de funcionalidade fora do plano: explica e convida, em vez de esconder. */
export function LockedFeature({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-paper p-5 ring-1 ring-line">
      <p className="text-sm font-semibold text-crm">Não incluído no seu plano</p>
      <h2 className="mt-1 text-lg font-bold">{title}</h2>
      <div className="mt-1 max-w-xl text-ink-soft">{children}</div>
      <p className="mt-3 text-sm text-ink-soft">Para liberar, fale com a equipe Tropi ou com a gestão da clínica.</p>
    </div>
  );
}
