"use client";

/**
 * RESUMO DA CONVERSA ("Resumir"), para quem assume no meio
 *
 *  - Botão "Resumir" no topo da conversa (ResumeButton).
 *  - Faixa logo abaixo do topo (SummaryBar): a linha principal sempre à vista;
 *    "Ver detalhes" abre os pontos, o próximo passo e os avisos.
 *  - O último resumo fica guardado: quem abrir a conversa depois já vê, com
 *    "N mensagens novas desde o resumo" e o botão "Atualizar".
 *  - A origem fica visível ("Resumo da IA" ou "Resumo automático, sem IA" com o
 *    motivo), e "Ajudou?" mede se vale manter a IA ligada.
 * Nada aqui envia mensagem ao paciente.
 */
import { AlertTriangle, Bot, ChevronDown, NotebookText, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/components/ui/styles";
import { rateSummaryAction, summarizeAction } from "@/modules/crm/actions/ai";
import type { SummaryView } from "@/modules/crm/ai/summary";

export function useSummary(conversationId: string, saved: SummaryView | null) {
  const [summary, setSummary] = useState<SummaryView | null>(saved);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Trocou de conversa, ou o servidor trouxe um resumo diferente/atualizado (novas mensagens)
  const key = `${conversationId}:${saved?.id ?? "-"}:${saved?.newSince ?? 0}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    const sameConversation = lastKey.startsWith(`${conversationId}:`);
    setLastKey(key);
    setSummary(saved);
    setError(null);
    if (!sameConversation) {
      setOpen(false);
      setHidden(false);
    }
  }

  const request = (regenerate = false) =>
    start(async () => {
      setError(null);
      setHidden(false);
      const res = await summarizeAction({ conversationId, regenerate });
      if (res.ok) {
        setSummary(res.summary);
        setOpen(true);
      } else setError(res.message);
    });
  return { summary, open, setOpen, hidden, setHidden, error, setError, pending, request };
}

export type SummaryState = ReturnType<typeof useSummary>;

/** Botão do topo da conversa. Com resumo guardado e em dia, só mostra/abre. */
export function ResumeButton({ s }: { s: SummaryState }) {
  const fresh = s.summary && s.summary.newSince === 0;
  return (
    <button
      type="button"
      onClick={() => (fresh && s.hidden ? s.setHidden(false) : fresh ? s.setOpen(!s.open) : s.request(!!s.summary))}
      disabled={s.pending}
      data-shortcut="s"
      aria-expanded={s.summary ? s.open && !s.hidden : undefined}
      title="Resume a conversa: o que o paciente quer, o que já foi combinado e o que está pendente"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-crm hover:bg-crm-tint disabled:opacity-60"
    >
      <NotebookText className={cn("size-4", s.pending && "animate-pulse")} aria-hidden />
      <span className="hidden sm:inline">{s.pending ? "Resumindo..." : "Resumir"}</span>
      <span className="sr-only sm:hidden">{s.pending ? "Resumindo" : "Resumir conversa"}</span>
    </button>
  );
}

export function SummaryBar({ s }: { s: SummaryState }) {
  const [rated, setRated] = useState<boolean | null>(null);
  const [ratedFor, setRatedFor] = useState<string | null>(null);
  const sum = s.summary;
  if (sum && ratedFor !== sum.id) {
    setRatedFor(sum.id);
    setRated(sum.helpful);
  }

  if (s.pending && !sum) {
    return (
      <div className="border-b border-line bg-crm-tint/60 px-4 py-3" role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-semibold text-crm">
          <NotebookText className="size-4 animate-pulse" aria-hidden /> Lendo a conversa para resumir...
        </p>
        <div className="mt-2 h-2.5 w-9/12 animate-pulse rounded-full bg-crm/15" aria-hidden />
      </div>
    );
  }
  if (s.error) {
    return (
      <p role="alert" className="flex items-center justify-between gap-2 border-b border-line bg-alert-tint px-4 py-2 text-sm font-semibold text-alert">
        {s.error}
        <button type="button" onClick={() => s.setError(null)} aria-label="Fechar aviso" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-paper">
          <X className="size-4" aria-hidden />
        </button>
      </p>
    );
  }
  if (!sum || s.hidden) return null;

  const ai = sum.source === "ia";
  const rate = (v: boolean) => {
    setRated(v);
    void rateSummaryAction(sum.id, v);
  };

  return (
    <section aria-label="Resumo da conversa" className={cn("border-b px-4 py-2.5", ai ? "border-crm/25 bg-crm-tint/50" : "border-line bg-paper")}>
      <div className="flex items-start gap-2">
        <span
          className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", ai ? "bg-crm text-white" : "bg-fog text-ink-soft ring-1 ring-line")}
          title={ai ? `Resumo da IA${sum.model ? ` (${sum.model})` : ""}` : `Resumo automático pelas regras do CRM${sum.fallbackReason ? `: ${sum.fallbackReason}` : ""}`}
        >
          {ai ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          <span className="sr-only sm:not-sr-only">{ai ? "Resumo da IA" : "Resumo automático"}</span>
        </span>

        <button type="button" onClick={() => s.setOpen(!s.open)} aria-expanded={s.open} className="min-w-0 flex-1 text-left">
          <span className={cn("block text-sm font-semibold first-letter:uppercase", !s.open && "line-clamp-2", s.pending && "opacity-50")}>{sum.headline}</span>
          {sum.newSince > 0 ? (
            <span className="mt-0.5 block text-xs font-semibold text-erp-ink">
              {sum.newSince} {sum.newSince === 1 ? "mensagem nova" : "mensagens novas"} desde o resumo
            </span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center">
          {sum.newSince > 0 ? (
            <button type="button" onClick={() => s.request(true)} disabled={s.pending} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-crm hover:bg-paper disabled:opacity-50">
              <RefreshCw className={cn("size-3.5", s.pending && "animate-spin")} aria-hidden /> Atualizar
            </button>
          ) : null}
          <button type="button" onClick={() => s.setOpen(!s.open)} aria-label={s.open ? "Recolher resumo" : "Ver detalhes do resumo"} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-paper hover:text-ink">
            <ChevronDown className={cn("size-4 transition-transform", s.open && "rotate-180")} aria-hidden />
          </button>
          <button type="button" onClick={() => s.setHidden(true)} aria-label="Fechar resumo" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-soft hover:bg-paper hover:text-ink">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {s.open ? (
        <div className="thin-scroll mt-2 max-h-[26dvh] overflow-y-auto pl-1 sm:max-h-[40dvh] lg:max-h-72">
          {sum.points.length ? (
            <ul className="space-y-1 text-sm">
              {sum.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-crm" aria-hidden />
                  <span className="min-w-0 break-words">{p}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {sum.nextStep ? (
            <p className="mt-2 text-sm">
              <strong>Próximo passo:</strong> {sum.nextStep}
            </p>
          ) : null}
          {sum.warnings.length ? (
            <ul className="mt-2 space-y-0.5">
              {sum.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-xs text-erp-ink">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
            <span>
              {sum.by ? `Resumido por ${sum.by}` : "Resumido"} {sum.when}
              {!ai && sum.fallbackReason ? `. Sem IA: ${sum.fallbackReason}` : ""}.
            </span>
            {sum.newSince === 0 ? (
              <button type="button" onClick={() => s.request(true)} disabled={s.pending} className="inline-flex min-h-8 items-center gap-1 font-semibold text-crm hover:underline disabled:opacity-50">
                <RefreshCw className={cn("size-3", s.pending && "animate-spin")} aria-hidden /> Gerar de novo
              </button>
            ) : null}
            <span className="inline-flex items-center gap-1">
              Ajudou?
              <button type="button" onClick={() => rate(true)} aria-pressed={rated === true} aria-label="Ajudou" className={cn("inline-flex size-8 items-center justify-center rounded-lg hover:bg-paper", rated === true && "bg-pep-tint text-pep-ink")}>
                <ThumbsUp className="size-3.5" aria-hidden />
              </button>
              <button type="button" onClick={() => rate(false)} aria-pressed={rated === false} aria-label="Não ajudou" className={cn("inline-flex size-8 items-center justify-center rounded-lg hover:bg-paper", rated === false && "bg-erp-tint text-erp-ink")}>
                <ThumbsDown className="size-3.5" aria-hidden />
              </button>
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">Confira na conversa antes de decidir: o resumo pode errar.</p>
        </div>
      ) : null}
    </section>
  );
}
