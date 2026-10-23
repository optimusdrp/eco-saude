import { Container } from "@/components/ui/Container";
import { Logo } from "@/components/ui/Logo";
import { modules } from "@/content/modules";
import { navigation, siteConfig } from "@/content/site";

/** Rodapé: marca, navegação, módulos e avisos legais. */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-night text-white/75">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-sm">
          <Logo inverted />
          <p className="mt-4 text-[0.95rem]">{siteConfig.tagline} Atendimento, Gestão, Prontuário e Indicadores para clínicas, contratados do jeito que fizer sentido.</p>
        </div>

        <nav aria-label="Rodapé">
          <h2 className="font-sans text-sm font-semibold text-white">Navegação</h2>
          <ul className="mt-3 space-y-2 text-[0.95rem]">
            {navigation.map((item) => (
              <li key={item.href}>
                <a className="hover:text-white" href={item.href}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="font-sans text-sm font-semibold text-white">Módulos</h2>
          <ul className="mt-3 space-y-2 text-[0.95rem]">
            {modules.map((m) => (
              <li key={m.id}>{m.fullName}</li>
            ))}
          </ul>
        </div>
      </Container>

      <div className="border-t border-white/10">
        <Container className="flex flex-col gap-2 py-6 text-sm sm:flex-row sm:justify-between">
          <p>
            © {year} {siteConfig.name}. Versão de testes.
          </p>
          <p>Dados pessoais tratados conforme a LGPD.</p>
        </Container>
      </div>
    </footer>
  );
}
