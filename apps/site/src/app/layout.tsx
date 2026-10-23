import type { Metadata, Viewport } from "next";
// Fontes hospedadas pelo próprio site (pacotes @fontsource): não dependem do
// Google Fonts em tempo de execução e não enviam dados do visitante a terceiros.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "./globals.css";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { siteConfig } from "@/content/site";

/** Metadados para buscadores e redes sociais. */
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name}: ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: `${siteConfig.name}: ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  // Ambiente de testes: não indexar até o lançamento oficial.
  robots: { index: false, follow: false },
};

/** Viewport: cor da barra do navegador no celular e zoom liberado (acessibilidade). */
export const viewport: Viewport = {
  themeColor: "#f7f7fa",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {/* Link "pular para o conteúdo" para quem navega por teclado */}
        <a
          href="#conteudo"
          className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Pular para o conteúdo
        </a>
        <Header />
        <main id="conteudo">{children}</main>
        <Footer />
        <CommandPalette />
      </body>
    </html>
  );
}
