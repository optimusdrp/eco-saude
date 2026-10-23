import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Backoffice", template: "%s | Backoffice Tropi" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#2b2a4c",
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
