import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Backoffice", template: "%s | Backoffice EcoSaúde" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1f1842",
  width: "device-width",
  initialScale: 1,
};

/** Layout raiz: só fontes e estilos. O "casco" com menu fica em (painel)/layout.tsx. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
