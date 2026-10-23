import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, pendingStep, routeForStep } from "@/lib/auth/dal";
import { ChangePasswordForm } from "../forms";

export const metadata: Metadata = { title: "Criar senha" };

/** Primeiro acesso (ou senha redefinida): troca obrigatória da senha temporária. */
export default async function FirstAccessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const step = pendingStep(user);
  if (step !== "change-password") redirect(step ? routeForStep(step) : "/");
  return (
    <>
      <h1 className="text-2xl font-bold">Crie sua senha</h1>
      <p className="mt-1 mb-6 text-ink-soft">
        Olá, {user.name.split(" ")[0]}! Troque a senha temporária por uma só sua para entrar no ambiente da {user.clinicName}.
      </p>
      <ChangePasswordForm />
    </>
  );
}
