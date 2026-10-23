/**
 * Componentes de exibição sem interatividade (podem ser usados em
 * Server Components sem enviar JavaScript ao navegador).
 */
import type { ModuleId } from "@ecosaude/core";
import { MODULE_LABEL } from "@ecosaude/core";
import { clsx, type ClassValue } from "clsx";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ---------------------------------- Badge ---------------------------------- */

export type Tone = "neutral" | "crm" | "erp" | "pep" | "bi" | "lab" | "alert" | "success" | "warning";

const toneClass: Record<Tone, string> = {
  neutral: "bg-fog text-ink-soft ring-1 ring-line",
  crm: "bg-crm-tint text-crm",
  erp: "bg-erp-tint text-erp-ink",
  pep: "bg-pep-tint text-pep-ink",
  bi: "bg-bi-tint text-bi",
  lab: "bg-lab-tint text-lab-ink",
  alert: "bg-alert-tint text-alert",
  success: "bg-ok-tint text-ok-ink",
  warning: "bg-erp-tint text-erp-ink",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const moduleDot: Record<ModuleId, string> = { crm: "bg-crm", erp: "bg-erp", pep: "bg-pep", bi: "bg-bi", lab: "bg-lab" };

/** Etiqueta de módulo com a cor da identidade visual. */
export function ModuleBadge({ id }: { id: ModuleId }) {
  return (
    <Badge tone={id}>
      <span className={cn("size-1.5 rounded-full", moduleDot[id])} aria-hidden />
      {MODULE_LABEL[id]}
    </Badge>
  );
}

/* ------------------------------- Estrutura --------------------------------- */

/** Cabeçalho de página: título, descrição opcional e ações à direita. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** Bloco com fundo branco para agrupar conteúdo. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5", className)}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
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

/** Tela vazia que convida a agir, em vez de só dizer "nada aqui". */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/20 px-4 py-10 text-center">
      <p className="font-display text-lg font-bold">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-ink-soft">{children}</div> : null}
    </div>
  );
}

/** Lista "rótulo: valor" usada nas páginas de detalhe. */
export function DataList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold text-ink-soft">{label}</dt>
          <dd className="mt-0.5 break-words">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
