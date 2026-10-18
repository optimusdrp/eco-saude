import Link from "next/link";
import { buttonStyles } from "@/components/ui/styles";

export default function NoPermissionPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Sem acesso a esta área</h1>
      <p className="mt-2 mb-6 text-ink-soft">Seu perfil não inclui esta permissão. Se precisar dela, peça para a gestão da clínica.</p>
      <Link href="/hoje" className={buttonStyles("primary")}>
        Voltar para Hoje
      </Link>
    </>
  );
}
