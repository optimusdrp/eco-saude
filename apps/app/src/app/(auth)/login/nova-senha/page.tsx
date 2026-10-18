import type { Metadata } from "next";
import { ResetPasswordForm } from "../../forms";

/**
 * Página aberta pelo link do e-mail. "no-referrer": nada desta página é repassado
 * a outro site; o token fica depois do "#" e é tirado do endereço assim que lido.
 */
export const metadata: Metadata = {
  title: "Nova senha",
  referrer: "no-referrer",
  robots: { index: false },
};

export default function NewPasswordPage() {
  return <ResetPasswordForm />;
}
