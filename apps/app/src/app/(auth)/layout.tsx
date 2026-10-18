import { LogoMark } from "@/components/shell/LogoMark";

/**
 * Telas de acesso do ambiente da clínica.
 * Desktop: faixa com a proposta do ambiente. Celular: só o formulário.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-night p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark />
          <span className="font-display text-xl font-bold">EcoSaúde</span>
        </div>
        <div>
          <p className="font-display text-4xl leading-tight font-bold">Sua clínica inteira num só lugar.</p>
          <p className="mt-3 max-w-sm text-white/70">
            Conversas de todos os canais, agenda e relacionamento com os pacientes, com o mesmo login para todos os módulos contratados.
          </p>
        </div>
        <p className="text-sm text-white/50">Os dados de cada clínica ficam isolados e cada acesso é registrado.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <span className="font-display text-xl font-bold">EcoSaúde</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
