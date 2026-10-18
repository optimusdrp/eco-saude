import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, pendingStep, routeForStep } from "@/lib/auth/dal";
import { LoginForm } from "../forms";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ bloqueado?: string }> }) {
  // Já logado? Vai direto para onde precisa estar
  const user = await getCurrentUser();
  if (user) {
    const step = pendingStep(user);
    redirect(step ? routeForStep(step) : "/");
  }
  const { bloqueado } = await searchParams;

  return (
    <>
      <h1 className="text-2xl font-bold">Entrar</h1>
      <p className="mt-1 mb-6 text-ink-soft">Use o e-mail e a senha da sua conta da equipe.</p>
      {bloqueado ? (
        <p role="alert" className="mb-4 rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          Muitos códigos errados. Por segurança, a conta foi bloqueada por 15 minutos.
        </p>
      ) : null}
      <LoginForm />
      <p className="mt-6 text-sm text-ink-soft">Esqueceu a senha? Peça a um administrador para redefinir.</p>
    </>
  );
}
