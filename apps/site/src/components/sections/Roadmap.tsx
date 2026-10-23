import { Container } from "@/components/ui/Container";
import { moduleColor } from "@/components/ui/ModuleTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { modules, statusLabel } from "@/content/modules";
import { cn } from "@/lib/cn";

/**
 * Seção "Roadmap": a ordem real de liberação dos módulos.
 * Aqui a numeração faz sentido porque o conteúdo É uma sequência.
 * Celular: linha vertical. Desktop: linha horizontal.
 */
export function Roadmap() {
  return (
    <section aria-labelledby="road-title" className="py-20 lg:py-28">
      <Container>
        <SectionHeading id="road-title" title="Um módulo de cada vez, bem feito">
          Atendimento e Prontuário já estão em teste com clínicas. Os demais módulos chegam nesta ordem.
        </SectionHeading>

        <ol className="relative mt-12 grid gap-8 lg:grid-cols-5 lg:gap-6">
          {/* Linha que liga as etapas (vertical no celular, horizontal no desktop) */}
          <span
            className="absolute top-2 bottom-2 left-[0.9rem] w-0.5 bg-line lg:top-[0.9rem] lg:right-0 lg:bottom-auto lg:left-0 lg:h-0.5 lg:w-auto"
            aria-hidden
          />
          {modules.map((m, i) => (
            <li key={m.id} className="relative flex gap-4 lg:flex-col lg:gap-0">
              <span
                className={cn(
                  "relative z-10 grid size-[1.85rem] shrink-0 place-items-center rounded-full text-sm font-bold ring-4 ring-fog",
                  m.status === "em-teste" ? cn(moduleColor[m.id].bg, "text-white") : "bg-paper text-ink ring-4 ring-fog outline outline-1 outline-line",
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 lg:mt-5">
                <p className={cn("text-sm font-semibold", moduleColor[m.id].text)}>{statusLabel[m.status]}</p>
                <h3 className="mt-1 text-xl font-bold">{m.fullName}</h3>
                <p className="mt-1.5 text-[0.95rem] text-ink-soft">{m.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
