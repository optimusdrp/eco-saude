import { OfflineSimulator } from "@/components/demos/OfflineSimulator";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

/**
 * Seção "Modo offline" (fundo escuro). EM DESENVOLVIMENTO: a seção leva a etiqueta "Em breve"
 * e fala no futuro. Só a regra das mensagens já vale hoje (fila que sai quando o canal volta).
 * À esquerda, as regras de sincronização; à direita, o simulador para o visitante testar.
 */
const rules = [
  {
    title: "Agenda",
    text: "Se dois aparelhos marcarem o mesmo horário sem internet, o sistema vai mostrar as duas marcações para uma pessoa decidir.",
  },
  {
    title: "Cadastro",
    text: "Alterações em campos diferentes serão unidas sozinhas. Na mesma informação, vale a mais recente e a anterior fica no histórico.",
  },
  {
    title: "Atendimento",
    text: "Registros clínicos nunca serão sobrescritos: cada versão fica guardada com autor, data e aparelho.",
  },
  {
    title: "Mensagens",
    text: "Já funciona hoje: quando um canal cai, as mensagens de WhatsApp, Instagram, Messenger e Telegram esperam na fila e saem sozinhas quando ele volta.",
  },
];

export function Offline() {
  return (
    <section id="offline" aria-labelledby="off-title" className="bg-night py-20 text-white lg:py-28">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
        <div>
          <SectionHeading id="off-title" inverted soon title="A internet caiu. O atendimento, não.">
            Em desenvolvimento: o que for feito sem conexão vai ficar salvo no próprio aparelho
            e ser sincronizado quando a internet voltar, com uma regra clara para cada informação.
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
