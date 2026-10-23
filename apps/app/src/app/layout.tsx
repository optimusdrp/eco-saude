import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tropi", template: "%s | Tropi" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#2b2a4c",
  width: "device-width",
  initialScale: 1,
  // Em celulares com "notch", ocupa a tela toda e respeita as áreas seguras
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
