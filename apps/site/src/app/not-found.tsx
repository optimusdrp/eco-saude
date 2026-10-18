import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

/** Página 404: explica o que houve e oferece o caminho de volta. */
export default function NotFound() {
  return (
    <Container className="flex min-h-[70vh] flex-col items-start justify-center pt-24">
      <h1 className="text-4xl font-bold sm:text-5xl">Esta página não existe</h1>
      <p className="mt-4 max-w-md text-lg text-ink-soft">
        O endereço pode ter sido digitado errado ou a página mudou de lugar.
      </p>
      <Link href="/" className={buttonStyles({ size: "lg", className: "mt-8" })}>
        Voltar ao início
      </Link>
    </Container>
  );
}
