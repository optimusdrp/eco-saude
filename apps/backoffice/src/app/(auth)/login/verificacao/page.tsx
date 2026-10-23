import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logoutAction } from "@/lib/auth/actions";
import { getCurrentUser, pendingStep, routeForStep } from "@/lib/auth/dal";
import { VerifyCodeForm } from "../../forms";

export const metadata: Metadata = { title: "Verificação" };

/** Segunda etapa do login: código do aplicativo autenticador. */
export default async function VerifyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const step = pendingStep(user);
  if (step !== "two-factor") redirect(step ? routeForStep(step) : "/");

  return (
    <>
      <h1 className="text-2xl font-bold">Verificação em duas etapas</h1>
      <p className="mt-1 mb-6 text-ink-soft">
        Abra o aplicativo autenticador no celular e digite o código de “Tropi Backoffice” (se ativou antes da mudança de nome, aparece como “EcoSaúde Backoffice”).
      </p>
      <VerifyCodeForm />
      <form action={logoutAction} className="mt-4">
        <button type="submit" className="min-h-11 text-sm font-semibold text-ink-soft underline-offset-4 hover:underline">
          Entrar com outra conta
        </button>
      </form>
    </>
  );
}
