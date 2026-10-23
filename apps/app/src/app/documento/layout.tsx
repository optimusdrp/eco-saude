import { Logo } from "@/components/shell/LogoMark";

/** Verificação pública de documentos (sem login): farmácia, escola, empresa. */
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-fog px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <Logo className="mb-8" suffix="Prontuário" />
        {children}
        <p className="mt-8 text-xs text-ink-soft">
          Esta página confirma que o documento foi emitido pela clínica no Tropi e não foi alterado. Os dados de saúde ficam protegidos: aparece só o necessário para conferir o papel.
        </p>
      </div>
    </div>
  );
}
