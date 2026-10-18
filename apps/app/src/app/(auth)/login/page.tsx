import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, pendingStep, routeForStep } from "@/lib/auth/dal";
import { emailStatus } from "@/lib/email";
import { LoginForm } from "../forms";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ bloqueado?: string; senha?: string }> }) {
  const user = await getCurrentUser();
  if (user) {
    const step = pendingStep(user);
    redirect(step ? routeForStep(step) : "/hoje");
  }
  const { bloqueado, senha } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold">Entrar</h1>
      <p className="mt-1 mb-6 text-ink-soft">Use o e-mail e a senha que a sua clínica cadastrou para você.</p>
      {bloqueado ? (
        <p role="alert" className="mb-4 rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          Muitos códigos errados. Por segurança, a conta foi bloqueada por 15 minutos.
        </p>
      ) : null}
      {senha === "redefinida" ? (
        <p role="status" className="mb-4 rounded-xl bg-pep-tint px-3 py-2 text-sm font-semibold text-pep-ink">
          Senha alterada. Entre com a nova senha.
        </p>
      ) : null}
      <LoginForm />
      {emailStatus().configured ? (
        <Link href="/login/esqueci" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-crm underline-offset-4 hover:underline">
          Esqueci minha senha
        </Link>
      ) : (
        <p className="mt-6 text-sm text-ink-soft">Esqueceu a senha? Peça para a gestão da clínica redefinir.</p>
      )}
    </>
  );
}
