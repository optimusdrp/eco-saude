import type { Metadata } from "next";
import Link from "next/link";
import { emailStatus } from "@/lib/email";
import { ForgotPasswordForm } from "../../forms";

export const metadata: Metadata = {
  title: "Esqueci minha senha",
  robots: { index: false },
};
// Lê a configuração de e-mail a cada acesso (não "congela" o que valia na hora do build)
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  // Sem provedor de e-mail (ex.: produção ainda sem configuração): o caminho é a gestão da clínica
  const { configured } = emailStatus();
  return (
    <>
      <h1 className="text-2xl font-bold">Esqueci minha senha</h1>
      {configured ? (
        <>
          <p className="mt-1 mb-6 text-ink-soft">Informe o e-mail que você usa para entrar. Vamos enviar um link para você criar uma nova senha.</p>
          <ForgotPasswordForm />
        </>
      ) : (
        <p className="mt-1 mb-6 text-ink-soft">A recuperação por e-mail não está disponível no momento. Peça para a gestão da clínica criar uma senha temporária para você.</p>
      )}
      <Link href="/login" className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-ink-soft underline-offset-4 hover:underline">
        Voltar para o login
      </Link>
    </>
  );
}
