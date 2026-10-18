import Link from "next/link";
import { buttonStyles } from "@/components/ui/styles";

/** Mostrada quando o perfil do usuário não permite acessar a página. */
export default function NoPermissionPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Sem acesso a esta área</h1>
      <p className="mt-2 mb-6 text-ink-soft">
        Seu perfil não inclui esta permissão. Se precisar dela para o seu trabalho, peça a um administrador.
      </p>
      <Link href="/" className={buttonStyles("primary")}>
        Voltar ao painel
      </Link>
    </>
  );
}
