import { BRAND } from "@ecosaude/core";
import { Logo } from "@/components/shell/LogoMark";

/**
 * Telas de acesso do ambiente da clínica.
 * Desktop: faixa índigo com a marca e o slogan. Celular: só o logotipo e o formulário.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-night p-10 text-white lg:flex">
        <Logo onDark />
        <div>
          <p className="font-display text-4xl leading-tight font-bold">{BRAND.tagline}</p>
          <p className="mt-3 max-w-sm text-white/70">
            Conversas de todos os canais, agenda e relacionamento com os pacientes, com o mesmo login para todos os módulos contratados.
          </p>
        </div>
        <p className="text-sm text-white/60">Os dados de cada clínica ficam isolados e cada acesso é registrado.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
