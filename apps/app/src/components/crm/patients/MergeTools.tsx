"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { CheckboxField, FormMessage, SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { dismissDuplicateAction, mergeContactsAction } from "@/modules/crm/actions/duplicates";

/**
 * UNIFICAR DOIS CADASTROS (parte interativa da tela de comparação)
 * A pessoa escolhe qual cadastro fica como principal; o outro é incorporado.
 */
export interface MergeSide {
  id: string;
  version: number;
  name: string;
  summary: string[];
}

export function MergeForm({ a, b, suggested }: { a: MergeSide; b: MergeSide; suggested: string }) {
  const router = useRouter();
  const [state, action] = useActionState(mergeContactsAction, {});
  const [primary, setPrimary] = useState(suggested);
  const main = primary === a.id ? a : b;
  const other = primary === a.id ? b : a;
  useEffect(() => {
    const id = (state.data as { contactId?: string } | undefined)?.contactId;
    if (state.ok && id) router.push(`/crm/contatos/${id}`);
  }, [state, router]);

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="primaryId" value={main.id} />
      <input type="hidden" name="secondaryId" value={other.id} />
      <input type="hidden" name="primaryVersion" value={main.version} />
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Qual cadastro fica como principal?</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {[a, b].map((side) => (
            <label key={side.id} className={cn("block cursor-pointer rounded-2xl p-4 ring-2", primary === side.id ? "bg-crm-tint ring-crm" : "bg-paper ring-line")}>
              <span className="flex items-center gap-2">
                <input type="radio" name="_primary" checked={primary === side.id} onChange={() => setPrimary(side.id)} className="size-4 accent-[var(--color-crm)]" />
                <span className="font-bold">{side.name}</span>
                {primary === side.id ? <span className="ml-auto rounded-full bg-crm px-2 py-0.5 text-xs font-semibold text-white">principal</span> : null}
              </span>
              <ul className="mt-2 space-y-0.5 text-sm text-ink-soft">
                {side.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="rounded-xl bg-fog p-3 text-sm">
        <p className="font-semibold">O que vai acontecer</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
          <li>
            Conversas, consultas, lista de espera, tarefas e histórico de <strong>{other.name}</strong> passam para <strong>{main.name}</strong>.
          </li>
          <li>Conversas do mesmo canal viram uma só, com todas as mensagens.</li>
          <li>Dados vazios no principal são completados com os do outro; etiquetas somam.</li>
          <li>Se algum dos dois pediu SAIR, o cadastro unificado continua sem receber mensagens.</li>
          <li>O cadastro de {other.name} deixa de existir. Não dá para desfazer.</li>
        </ul>
      </div>
      <CheckboxField name="confirm" label="Confirmo que é a mesma pessoa" />
      <SubmitButton variant="danger" pendingText="Unificando...">
        Unificar cadastros
      </SubmitButton>
    </form>
  );
}

/** "Não é a mesma pessoa": o par não volta a aparecer como suspeito. */
export function DismissPair({ a, b, label = "Não é a mesma pessoa" }: { a: string; b: string; label?: string }) {
  const router = useRouter();
  const [state, action] = useActionState(dismissDuplicateAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action}>
      <input type="hidden" name="a" value={a} />
      <input type="hidden" name="b" value={b} />
      <SubmitButton variant="ghost" pendingText="...">
        {label}
      </SubmitButton>
      {state.message && !state.ok ? <p className="text-xs text-alert">{state.message}</p> : null}
    </form>
  );
}
