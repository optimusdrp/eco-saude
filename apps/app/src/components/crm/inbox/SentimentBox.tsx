"use client";

/**
 * "COMO O PACIENTE ESTÁ": o sentimento da conversa, com a origem visível
 *  - "entendido pela IA (88% de certeza)" e o trecho que decidiu
 *  - "por palavras-chave e sinais" (plano B, ou enquanto a IA confere)
 *  - "corrigido pela equipe"
 * "Corrigir" vale na hora: mexe na fila, pode avisar a gestão e mede o acerto da IA.
 */
import { SENTIMENT_HINT, SENTIMENT_LABEL, SENTIMENTS, type Sentiment } from "@ecosaude/core/crm";
import { Flame, Pencil, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { cn } from "@/components/ui/styles";
import { setSentimentAction } from "@/modules/crm/actions/conversations";
import type { ThreadData } from "./types";

const TONE = (level: number) => (level >= 3 ? "bg-alert-tint text-alert" : level === 2 ? "bg-erp-tint text-erp-ink" : level === 1 ? "bg-fog text-ink" : "bg-pep-tint text-pep-ink");

export function SentimentBox({ thread, canEdit }: { thread: ThreadData; canEdit: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setSentimentAction, {});
  const [editing, setEditing] = useState(false);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setEditing(false);
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  // A IA ainda está conferindo: atualiza a tela sozinha por alguns segundos
  useEffect(() => {
    if (!thread.sentimentPending) return;
    const timer = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(timer);
  }, [thread.sentimentPending, router]);

  if (!thread.sentiment) return null;
  const s = thread.sentiment as Sentiment;
  const source =
    thread.sentimentSource === "ia"
      ? `entendido pela IA${thread.sentimentConfidence !== null ? ` (${thread.sentimentConfidence}% de certeza)` : ""}`
      : thread.sentimentSource === "equipe"
        ? "corrigido pela equipe"
        : "por palavras-chave e sinais";

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Como o paciente está</h2>
        {canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-crm hover:bg-crm-tint">
            <Pencil className="size-3" aria-hidden /> Corrigir
          </button>
        ) : null}
      </div>

      {editing ? (
        <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={thread.id} />
          <select name="sentiment" defaultValue={s} aria-label="Sentimento correto" className="min-h-10 flex-1 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
            {SENTIMENTS.map((x) => (
              <option key={x} value={x}>
                {SENTIMENT_LABEL[x]}: {SENTIMENT_HINT[x]}
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
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", TONE(thread.sentimentLevel))}>
              {thread.sentimentSource === "ia" ? <Sparkles className="size-3" aria-hidden /> : thread.sentimentLevel >= 2 ? <Flame className="size-3" aria-hidden /> : null}
              {SENTIMENT_LABEL[s]}
            </span>
            <span className="text-xs text-ink-soft">{source}</span>
          </p>
          {thread.sentimentReason ? <p className="mt-1 text-xs text-ink-soft">{thread.sentimentSource === "ia" ? `“${thread.sentimentReason}”` : thread.sentimentReason}</p> : null}
          {thread.sentimentHot ? <p className="mt-1 text-xs font-semibold text-erp-ink">Subiu na fila. Responda com calma e sem pressa de encerrar.</p> : null}
          {thread.sentimentPending ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-crm" role="status">
              <Sparkles className="size-3 animate-pulse" aria-hidden /> A IA está conferindo o tom da conversa...
            </p>
          ) : null}
        </>
      )}
      {state.message && !state.ok ? <p className="mt-1 text-xs font-semibold text-alert">{state.message}</p> : null}
    </section>
  );
}
