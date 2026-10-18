import { OfflineSimulator } from "@/components/demos/OfflineSimulator";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

/**
 * Seção "Modo offline" (fundo escuro).
 * À esquerda, as regras de sincronização explicadas em linguagem simples;
 * à direita, o simulador para o visitante testar.
 */
const rules = [
  {
    title: "Agenda",
    text: "Se dois aparelhos marcarem o mesmo horário sem internet, o sistema mostra as duas marcações e uma pessoa decide.",
  },
  {
    title: "Cadastro",
    text: "Alterações em campos diferentes são unidas automaticamente. Na mesma informação, vale a mais recente e a anterior fica no histórico.",
  },
  {
    title: "Atendimento",
    text: "Registros clínicos nunca são sobrescritos. Cada versão é guardada com autor, data e aparelho.",
  },
  {
    title: "Mensagens",
    text: "WhatsApp, SMS e e-mail precisam de internet. Ficam prontos na fila e saem assim que a conexão volta.",
  },
];

export function Offline() {
  return (
    <section id="offline" aria-labelledby="off-title" className="bg-night py-20 text-white lg:py-28">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
        <div>
          <SectionHeading id="off-title" inverted title="A internet caiu. O atendimento, não.">
            O que é feito sem conexão fica salvo no próprio aparelho e é sincronizado
            quando a internet volta. Cada tipo de informação tem uma regra clara.
          </SectionHeading>

          <dl className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {rules.map((rule) => (
              <div key={rule.title} className="border-l-2 border-crm pl-4">
                <dt className="font-display text-lg font-bold">{rule.title}</dt>
                <dd className="mt-1 text-[0.97rem] text-white/72">{rule.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:pt-2">
          <OfflineSimulator />
        </div>
      </Container>
    </section>
  );
}
