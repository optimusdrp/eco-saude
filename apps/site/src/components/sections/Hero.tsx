import { AdaptiveDemo } from "@/components/demos/AdaptiveDemo";
import { buttonStyles } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { moduleColor } from "@/components/ui/ModuleTag";
import { modules } from "@/content/modules";
import { siteConfig } from "@/content/site";
import { cn } from "@/lib/cn";

/**
 * Herói: a primeira coisa que o visitante vê.
 * Em vez de um banner estático, mostra o produto funcionando
 * (AdaptiveDemo), que é o argumento principal da plataforma.
 */
export function Hero() {
  return (
    <section id="inicio" aria-labelledby="hero-title" className="pb-16 pt-24 sm:pt-28 lg:pb-24 lg:pt-32">
      <Container className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div>
          <h1
            id="hero-title"
            className="text-[2.5rem] font-extrabold xs:text-5xl sm:text-6xl lg:text-[3.4rem] xl:text-[4.1rem]"
          >
            {siteConfig.tagline}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-soft sm:text-xl">
            Atendimento, Gestão, Prontuário e Indicadores: módulos que você contrata separadamente e usa
            juntos, com o mesmo login. A tela muda conforme quem usa e, se a internet cair, a clínica continua atendendo.
          </p>

          <div className="mt-8 flex flex-col gap-3 xs:flex-row">
            <a href="#demonstracao" className={buttonStyles({ variant: "sun", size: "lg" })}>
              Pedir demonstração
            </a>
            <a href="#ecossistema" className={buttonStyles({ variant: "secondary", size: "lg" })}>
              Conhecer os módulos
            </a>
          </div>

          {/* Legenda de cores: as mesmas cores aparecem na demonstração ao lado */}
          <ul className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft" aria-label="Módulos e suas cores">
            {modules.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", moduleColor[m.id].dot)} aria-hidden />
                {m.fullName}
              </li>
            ))}
          </ul>
        </div>

        <AdaptiveDemo />
      </Container>
    </section>
  );
}
