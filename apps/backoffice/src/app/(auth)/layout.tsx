import { LogoMark } from "@/components/shell/LogoMark";

/**
 * Layout das telas de acesso (login, código da 2FA, primeiro acesso).
 * Desktop: faixa escura com a marca à esquerda. Celular: só o formulário.
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
          <p className="font-display text-4xl font-bold leading-tight">Backoffice</p>
          <p className="mt-3 max-w-sm text-white/70">
            Contatos, clínicas, contratações e catálogo em um só lugar. Acesso restrito à equipe interna.
          </p>
        </div>
        <p className="text-sm text-white/50">Toda ação neste ambiente é registrada na trilha de auditoria.</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <span className="font-display text-xl font-bold">EcoSaúde Backoffice</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
