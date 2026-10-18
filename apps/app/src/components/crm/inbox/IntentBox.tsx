"use client";

/**
 * "O QUE O PACIENTE QUER": a intenção da última mensagem, com a origem visível
 *  - "entendido pela IA" (com a certeza e o trecho que decidiu)
 *  - "por palavras-chave" (plano B, ou IA desligada)
 *  - "corrigido pela equipe"
 * e um "Corrigir" para a equipe ajustar (a correção também mede o acerto da IA).
 */
import { INTENT_LABEL, INTENTS } from "@ecosaude/core/crm";
import { Pencil, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Badge } from "@/components/ui/server";
import { setIntentAction } from "@/modules/crm/actions/conversations";
import type { ThreadData } from "./types";

export function IntentBox({ thread, canEdit }: { thread: ThreadData; canEdit: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setIntentAction, {});
  const [editing, setEditing] = useState(false);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setEditing(false);
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  // A IA ainda está lendo: atualiza a tela sozinho por alguns segundos
  useEffect(() => {
    if (!thread.intentPending) return;
    const timer = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(timer);
  }, [thread.intentPending, router]);

  const source =
    thread.intentSource === "ia"
      ? `entendido pela IA${thread.intentConfidence !== null ? ` (${thread.intentConfidence}% de certeza)` : ""}`
      : thread.intentSource === "equipe"
        ? "corrigido pela equipe"
        : thread.intentLabel
          ? "por palavras-chave"
          : null;

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">O que o paciente quer</h2>
        {canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-crm hover:bg-crm-tint">
            <Pencil className="size-3" aria-hidden /> Corrigir
          </button>
        ) : null}
      </div>

      {editing ? (
        <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={thread.id} />
          <select name="intent" defaultValue={thread.intent ?? ""} aria-label="Intenção correta" className="min-h-10 flex-1 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
            <option value="">Nada específico</option>
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {INTENT_LABEL[i]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-crm px-3 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "..." : "Salvar"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded-xl px-2 text-sm font-semibold text-ink-soft hover:bg-fog">
            Cancelar
          </button>
        </form>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            {thread.intentLabel ? (
              <Badge tone="crm">
                {thread.intentSource === "ia" ? <Sparkles className="size-3" aria-hidden /> : null}
                {thread.intentLabel}
              </Badge>
            ) : (
              <span className="text-sm text-ink-soft">Nada específico na última mensagem.</span>
            )}
            {source ? <span className="text-xs text-ink-soft">{source}</span> : null}
          </p>
          {thread.intentSource === "ia" && thread.intentReason ? <p className="mt-1 text-xs text-ink-soft">“{thread.intentReason}”</p> : null}
          {thread.intentPending ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-crm" role="status">
              <Sparkles className="size-3 animate-pulse" aria-hidden /> A IA está conferindo a última mensagem...
            </p>
          ) : null}
        </>
      )}
      {state.message && !state.ok ? <p className="mt-1 text-xs font-semibold text-alert">{state.message}</p> : null}
    </section>
  );
}
