"use client";

/**
 * "PROMETIDO NESTA CONVERSA": tarefas criadas sozinhas a partir das promessas
 * ("vou te mandar o orçamento amanhã"), com:
 *  - prazo ("amanhã", "atrasada desde ontem") e quem vai cumprir;
 *  - a origem (IA ou regras), para ninguém confiar às cegas;
 *  - "Feito" (conclui a tarefa) e "Não era promessa" (apaga e conta como erro da leitura).
 * Enquanto a IA lê a última mensagem, mostra "conferindo" e atualiza sozinho.
 */
import { Bot, Check, HandHeart, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { cn } from "@/components/ui/styles";
import { completeTaskAction } from "@/modules/crm/actions/contacts";
import { undoPromiseAction } from "@/modules/crm/actions/conversations";
import type { ThreadData } from "./types";

export function PromisesBox({ thread, canEdit }: { thread: ThreadData; canEdit: boolean }) {
  const router = useRouter();
  // A IA ainda está lendo a mensagem: atualiza a tela sozinha por alguns segundos
  useEffect(() => {
    if (!thread.promisePending) return;
    const timer = setTimeout(() => router.refresh(), 3500);
    return () => clearTimeout(timer);
  }, [thread.promisePending, router]);

  if (!thread.promises.length && !thread.promisePending) return null;
  return (
    <section aria-labelledby="prometido">
      <h2 id="prometido" className="flex items-center gap-1.5 text-sm font-bold">
        <HandHeart className="size-4 text-crm" aria-hidden /> Prometido nesta conversa
      </h2>
      {thread.promisePending ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-crm" role="status">
          <Sparkles className="size-3 animate-pulse" aria-hidden /> Conferindo se a última mensagem tem uma promessa...
        </p>
      ) : null}
      <ul className="mt-1.5 space-y-2">
        {thread.promises.map((p) => (
          <PromiseItem key={p.id} p={p} conversationId={thread.id} canEdit={canEdit} />
        ))}
      </ul>
    </section>
  );
}

function PromiseItem({ p, conversationId, canEdit }: { p: ThreadData["promises"][number]; conversationId: string; canEdit: boolean }) {
  const router = useRouter();
  const [done, doneAction, donePending] = useActionState(completeTaskAction, {});
  const [undone, undoAction, undoPending] = useActionState(undoPromiseAction, {});
  useEffect(() => {
    if (done.ok || undone.ok) router.refresh();
  }, [done, undone, router]);

  return (
    <li className={cn("rounded-xl p-2.5 ring-1", p.overdue ? "bg-alert-tint/50 ring-alert/30" : "bg-fog ring-line")}>
      <p className="text-sm font-semibold">{p.title}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
        <span className={cn(p.overdue && "font-bold text-alert")}>{p.overdue ? `atrasada (era para ${p.dueLabel})` : `para ${p.dueLabel}`}</span>
        {p.assignee ? <span>com {p.assignee}</span> : null}
        {p.source ? (
          <span className="inline-flex items-center gap-0.5" title={p.source === "ia" ? "Promessa entendida pela IA" : "Promessa lida pelas regras do Tropi"}>
            {p.source === "ia" ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
            {p.source === "ia" ? "IA" : "regras"}
          </span>
        ) : null}
      </p>
      {canEdit ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <form action={doneAction}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" disabled={donePending} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-paper px-2.5 text-xs font-semibold text-ok-ink ring-1 ring-line hover:ring-ok disabled:opacity-50">
              <Check className="size-3.5" aria-hidden /> Feito
            </button>
          </form>
          <form action={undoAction}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="conversationId" value={conversationId} />
            <button type="submit" disabled={undoPending} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-50">
              <X className="size-3.5" aria-hidden /> Não era promessa
            </button>
          </form>
        </div>
      ) : null}
      {undone.message && !undone.ok ? <p className="mt-1 text-xs font-semibold text-alert">{undone.message}</p> : null}
    </li>
  );
}
