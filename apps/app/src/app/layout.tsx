import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "EcoSaúde", template: "%s | EcoSaúde" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1f1842",
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
