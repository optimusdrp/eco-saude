import { pendingMigrations } from "@ecosaude/db";
import type { ReactNode } from "react";

/**
 * PROTEÇÃO CONTRA BANCO DESATUALIZADO
 * Se o código tem migrações que o banco ainda não recebeu (esqueceram o
 * "pnpm db:migrate" depois de atualizar o projeto), mostra o que fazer em vez
 * de um erro técnico do tipo "column ... does not exist".
 */
export async function SchemaGuard({ children }: { children: ReactNode }) {
  const pending = await pendingMigrations();
  if (pending.length === 0) return children;
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-sm font-semibold text-alert">Banco de dados desatualizado</p>
      <h1 className="mt-1 text-2xl font-bold">Falta aplicar {pending.length === 1 ? "1 atualização" : `${pending.length} atualizações`} no banco</h1>
      <p className="mt-3 text-ink-soft">
        O sistema foi atualizado, mas o banco ainda não recebeu as mudanças. Nada foi perdido: basta aplicar as atualizações.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5">
        <li>
          Pare o servidor (<kbd className="rounded bg-fog px-1.5 ring-1 ring-line">Ctrl</kbd> + <kbd className="rounded bg-fog px-1.5 ring-1 ring-line">C</kbd> no terminal).
        </li>
        <li>
          Na pasta do projeto, rode: <code className="rounded bg-fog px-1.5 py-0.5 ring-1 ring-line">pnpm db:migrate</code>
        </li>
        <li>
          Suba de novo: <code className="rounded bg-fog px-1.5 py-0.5 ring-1 ring-line">pnpm dev</code> e recarregue esta página.
        </li>
      </ol>
      <details className="mt-6 text-sm text-ink-soft">
        <summary className="cursor-pointer font-semibold">Atualizações pendentes</summary>
        <ul className="mt-2 list-disc pl-5">
          {pending.map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
