"use client";

import { FileCheck2, FlaskConical, ScanLine, Smile, Stethoscope, TestTubes } from "lucide-react";
import { buttonStyles } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

/**
 * Seção "Tropi Laboratório" (módulo PLANEJADO; o código está pausado).
 *
 * Mostra para quem é o módulo e o caminho do exame entre clínica e laboratório.
 * O caminho é uma sequência de verdade (pedido -> bancada -> laudo), por isso vai numerado.
 * O botão leva ao formulário já com "Laboratório" marcado (evento "ecosaude:interesse").
 */
const kinds = [
  { Icon: TestTubes, title: "Análises clínicas", text: "Pedido, coleta, bancada, conferência e liberação do laudo." },
  { Icon: ScanLine, title: "Imagem", text: "Agenda do exame, preparo do paciente e laudo do radiologista." },
  { Icon: Smile, title: "Prótese dentária", text: "Trabalho por etapa, prazo de entrega e retorno ao dentista." },
];

const path = [
  { Icon: Stethoscope, title: "A clínica pede", text: "O exame sai do prontuário e o preparo vai para o paciente pelo WhatsApp." },
  { Icon: FlaskConical, title: "O laboratório executa", text: "Etiqueta com código de barras, coleta, bancada e conferência antes de liberar." },
  { Icon: FileCheck2, title: "O laudo volta", text: "Direto no prontuário, com código de verificação, e o paciente é avisado." },
];

/** Leva ao formulário e marca "Laboratório" nos interesses */
function pedirAviso() {
  window.dispatchEvent(new CustomEvent("ecosaude:interesse", { detail: "lab" }));
}

export function Lab() {
  return (
    <section id="laboratorio" aria-labelledby="lab-title" className="bg-lab-tint/60 py-20 lg:py-28">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <SectionHeading id="lab-title" soon title="Para laboratórios, o mesmo ecossistema">
              O Tropi Laboratório está planejado para laboratórios de análises clínicas, imagem e
              prótese. Ele funciona sozinho e fica melhor ligado às clínicas que usam o Tropi: o pedido
              vai, o laudo volta, sem papel nem digitação dupla.
            </SectionHeading>
            <a href="#demonstracao" onClick={pedirAviso} className={buttonStyles({ variant: "secondary", size: "lg", className: "mt-8" })}>
              Quero ser avisado
            </a>
          </div>

          <div className="space-y-8">
            <ul className="grid gap-3 sm:grid-cols-3">
              {kinds.map(({ Icon, title, text }) => (
                <li key={title} className="rounded-2xl bg-paper p-4 ring-1 ring-line">
                  <Icon className="size-5 text-lab" aria-hidden />
                  <h3 className="mt-2 font-bold">{title}</h3>
                  <p className="mt-1 text-sm text-ink-soft">{text}</p>
                </li>
              ))}
            </ul>

            <div>
              <h3 className="text-lg font-bold">O caminho do exame</h3>
              <ol className="mt-4 grid gap-4 sm:grid-cols-3">
                {path.map(({ Icon, title, text }, i) => (
                  <li key={title} className="relative flex gap-3 sm:flex-col sm:gap-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lab text-sm font-bold text-white" aria-hidden>
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold text-lab-ink">
                        <Icon className="size-4" aria-hidden /> {title}
                      </p>
                      <p className="mt-1 text-sm text-ink-soft">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
