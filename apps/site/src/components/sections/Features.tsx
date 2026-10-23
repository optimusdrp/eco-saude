import { WaitlistDemo } from "@/components/demos/WaitlistDemo";
import { Container } from "@/components/ui/Container";
import { ModuleTag } from "@/components/ui/ModuleTag";
import { SoonTag } from "@/components/ui/SoonTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { features } from "@/content/features";

/**
 * Seção "Diferenciais".
 * A primeira funcionalidade (lista de espera) ganha demonstração interativa;
 * as demais aparecem em lista, com as etiquetas dos módulos envolvidos.
 */
export function Features() {
  const [featured, ...rest] = features;

  return (
    <section id="diferenciais" aria-labelledby="dif-title" className="py-20 lg:py-28">
      <Container>
        <SectionHeading id="dif-title" title="O que quase nenhum sistema de clínica faz">
          Funcionalidades pensadas a partir da rotina real da recepção, do consultório
          e da gestão, e não de uma lista de cadastros.
        </SectionHeading>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-14">
          {featured ? (
            <div>
              <div className="flex flex-wrap gap-1.5">
                {featured.modules.map((id) => (
                  <ModuleTag key={id} id={id} />
                ))}
              </div>
              <h3 className="mt-3 text-2xl font-bold sm:text-3xl">{featured.title}</h3>
              <p className="mt-3 max-w-xl text-ink-soft">{featured.description}</p>
              <div className="mt-6">
                <WaitlistDemo />
              </div>
            </div>
          ) : null}

          <ul className="divide-y divide-line border-y border-line">
            {rest.map((f) => (
              <li key={f.id} className="py-6">
                <h3 className="flex flex-wrap items-center gap-2 text-xl font-bold">
                  {f.title}
                  {f.soon ? <SoonTag /> : null}
                </h3>
                <p className="mt-2 text-[0.98rem] text-ink-soft">{f.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {f.modules.map((id) => (
                    <ModuleTag key={id} id={id} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
