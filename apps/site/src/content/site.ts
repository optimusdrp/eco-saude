import { BRAND } from "@ecosaude/core";
import type { NavItem } from "@/types";

/**
 * Configuração central do site.
 * Para trocar o nome da marca, o slogan ou o e-mail de contato,
 * altere SOMENTE este arquivo: todos os componentes leem daqui.
 */
export const siteConfig = {
  // Nome e slogan vêm da marca central (@ecosaude/core): mude lá, e site, CRM e backoffice acompanham
  name: BRAND.name,
  tagline: BRAND.tagline,
  description:
    "Tropi é o ecossistema da clínica: Atendimento, Gestão, Prontuário e Indicadores. Você contrata só os módulos que precisa e usa tudo em um único ambiente, que continua funcionando quando a internet cai.",
  /** Usado em metadados (Open Graph, sitemap). Ajuste após definir o domínio. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://tropi.vercel.app",
  locale: "pt_BR",
} as const;

/** Itens do menu principal. Os hrefs apontam para os ids das seções. */
export const navigation: NavItem[] = [
  { label: "Ecossistema", href: "#ecossistema" },
  { label: "Diferenciais", href: "#diferenciais" },
  { label: "Modo offline", href: "#offline" },
  { label: "Segurança", href: "#seguranca" },
  { label: "Perguntas", href: "#perguntas" },
];
