import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizeVerificationCode } from "@ecosaude/core/pep/server";
import { buttonStyles } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Conferir documento" };

async function go(form: FormData) {
  "use server";
  const code = normalizeVerificationCode(String(form.get("codigo") ?? ""));
  redirect(code ? `/documento/${code}` : "/documento?erro=1");
}

export default async function VerifyHome({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <section className="rounded-3xl bg-paper p-5 ring-1 ring-line sm:p-7">
      <h1 className="text-2xl font-bold">Conferir receita ou atestado</h1>
      <p className="mt-1 text-ink-soft">Digite o código impresso no rodapé do documento (12 letras e números).</p>
      <form action={go} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="codigo" className="sr-only">
          Código do documento
        </label>
        <input
          id="codigo"
          name="codigo"
          required
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="ABCD-EFGH-JKMN"
          aria-invalid={!!erro}
          aria-describedby={erro ? "codigo-erro" : undefined}
          className="min-h-12 flex-1 rounded-xl bg-paper px-4 font-mono text-lg tracking-wider uppercase ring-1 ring-line outline-none focus:ring-2 focus:ring-pep aria-[invalid=true]:ring-alert"
        />
        <button type="submit" className={buttonStyles("primary", "min-h-12 bg-pep hover:bg-pep-ink")}>
          Conferir
        </button>
      </form>
      {erro ? (
        <p id="codigo-erro" role="alert" className="mt-2 text-sm font-semibold text-alert">
          O código tem 12 caracteres (ex.: ABCD-EFGH-JKMN). Confira e digite de novo.
        </p>
      ) : null}
    </section>
  );
}
