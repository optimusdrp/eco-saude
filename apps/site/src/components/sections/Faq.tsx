import { Plus } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { faq } from "@/content/faq";

/**
 * Perguntas frequentes.
 * Usa <details>/<summary> nativos: acessíveis por teclado e leitores de tela
 * sem nenhum JavaScript. O ícone "+" gira quando o item abre (group-open).
 */
export function Faq() {
  return (
    <section id="perguntas" aria-labelledby="faq-title" className="bg-paper py-20 lg:py-28">
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-16">
        <SectionHeading id="faq-title" title="Perguntas frequentes">
          Não encontrou sua dúvida? Peça uma demonstração e conversamos sobre a sua clínica.
        </SectionHeading>

        <div className="border-t border-line">
          {faq.map((item) => (
            <details key={item.question} className="group border-b border-line">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {item.question}
                <Plus className="size-5 shrink-0 text-crm transition-transform group-open:rotate-45" aria-hidden />
              </summary>
              <p className="max-w-2xl pb-6 text-ink-soft">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
