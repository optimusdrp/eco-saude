"use client";

/**
 * RESPOSTAS RÁPIDAS SUGERIDAS
 * Textos que a equipe digitou várias vezes, propostos como atalho.
 *  - "Criar atalho": abre o formulário já preenchido (dá para editar antes).
 *  - "Descartar": não volta a aparecer.
 *  - "Procurar agora": busca sem esperar a semana.
 */
import { Bot, ScanSearch, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { dismissQuickReplySuggestionAction, mineQuickRepliesAction } from "@/modules/crm/actions/settings";
import { QuickReplyButton } from "../forms";

export interface ReplySuggestionView {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  count: number;
  conversations: number;
  source: "ia" | "regras";
}

export function ReplySuggestions({ items, lastRun }: { items: ReplySuggestionView[]; lastRun: string | null }) {
  const router = useRouter();
  const [mined, mine] = useActionState(mineQuickRepliesAction, {});
  useEffect(() => {
    if (mined.ok) router.refresh();
  }, [mined, router]);

  return (
    <section aria-labelledby="sugeridas-t" className="mb-6 rounded-2xl bg-paper p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="sugeridas-t" className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="size-5 text-crm" aria-hidden /> Sugeridas pela repetição
          </h2>
          <p className="text-sm text-ink-soft">Textos que a equipe digitou várias vezes, em conversas diferentes. {lastRun ? `Última busca: ${lastRun}.` : "Ainda não houve busca."}</p>
        </div>
        <form action={mine}>
          <SubmitButton variant="secondary" pendingText="Procurando...">
            <ScanSearch className="size-4" aria-hidden /> Procurar agora
          </SubmitButton>
        </form>
      </div>
      {mined.message ? (
        <p role="status" className={cn("mt-2 text-sm", mined.ok ? "text-pep-ink" : "font-semibold text-alert")}>
          {mined.message}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">Nenhuma sugestão pendente.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {items.map((s) => (
            <li key={s.id} className="flex flex-col rounded-xl bg-fog p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="font-semibold">
                  /{s.shortcut} <span className="font-normal text-ink-soft">· {s.title}</span>
                </p>
                <span
                  className={cn("inline-flex items-center gap-1 text-xs", s.source === "ia" ? "text-crm" : "text-ink-soft")}
                  title={s.source === "ia" ? "Texto final redigido pela IA" : "A variação mais usada"}
                >
                  {s.source === "ia" ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
                  {s.source === "ia" ? "IA" : "regras"}
                </span>
              </div>
              <p className="mt-2 rounded-2xl rounded-tl-sm bg-paper px-3 py-2 text-sm whitespace-pre-wrap ring-1 ring-line">{s.body}</p>
              <p className="mt-1.5 text-xs text-ink-soft">
                Digitado {s.count} vezes em {s.conversations} conversas nos últimos 90 dias.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <QuickReplyButton suggestionId={s.id} initial={{ shortcut: s.shortcut, title: s.title, body: s.body, approvedTemplate: false }} />
                <Dismiss id={s.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Dismiss({ id }: { id: string }) {
  const router = useRouter();
  const [state, action] = useActionState(dismissQuickReplySuggestionAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" pendingText="...">
        <X className="size-4" aria-hidden /> Descartar
      </SubmitButton>
    </form>
  );
}
