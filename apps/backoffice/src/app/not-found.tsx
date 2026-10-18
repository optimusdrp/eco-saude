import Link from "next/link";
import { buttonStyles } from "@/components/ui/styles";

/** Página 404 do backoffice. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-bold">Registro não encontrado</h1>
      <p className="mt-2 mb-6 text-ink-soft">O endereço está errado ou o registro foi removido.</p>
      <Link href="/" className={buttonStyles("primary", "self-start")}>
        Voltar ao painel
      </Link>
    </main>
  );
}
