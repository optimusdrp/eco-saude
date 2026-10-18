"use client";

/**
 * RASCUNHO SUGERIDO (IA com plano B)
 *
 * O atendente pede, lê, e escolhe: usar no campo (e editar à vontade), gerar
 * outro ou descartar. Nada é enviado daqui: o envio continua no botão Enviar.
 * A origem fica sempre visível: "Gemini" ou "Sugestão por regras" com o motivo
 * (IA desligada, fora do ar, lenta...), para ninguém confiar às cegas.
 */
import { AlertTriangle, Bot, RefreshCw, Sparkles, UserRound, X } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/components/ui/styles";
import { discardDraftAction, draftReplyAction } from "@/modules/crm/actions/ai";
import type { DraftOutput } from "@/modules/crm/ai/draft";

export function useDraftAssistant(conversationId: string) {
  const [draft, setDraft] = useState<DraftOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Trocou de conversa: some o rascunho da anterior
  const [forConv, setForConv] = useState(conversationId);
  if (forConv !== conversationId) {
    setForConv(conversationId);
    setDraft(null);
    setError(null);
  }
  const request = (regenerate = false) =>
    start(async () => {
      setError(null);
      const res = await draftReplyAction({ conversationId, regenerate });
      if (res.ok) setDraft(res.draft);
      else setError(res.message);
    });
  const dismiss = (discarded: boolean) => {
    if (draft && discarded) void discardDraftAction(draft.id);
    setDraft(null);
    setError(null);
  };
  return { draft, error, pending, request, dismiss };
}

export function SuggestButton({ onClick, pending, disabled }: { onClick: () => void; pending: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-crm hover:underline disabled:opacity-50 sm:min-h-9"
      title="Sugere uma resposta lendo a conversa, a ficha, a agenda e as respostas rápidas"
    >
      <Sparkles className={cn("size-4", pending && "animate-pulse")} aria-hidden />
      {pending ? "Lendo a conversa..." : "Sugerir resposta"}
    </button>
  );
}

export function DraftCard({
  draft,
  error,
  pending,
  hasText,
  onUse,
  onRegenerate,
  onDismiss,
}: {
  draft: DraftOutput | null;
  error: string | null;
  pending: boolean;
  /** Já há texto no campo: "Usar" substitui (com aviso) */
  hasText: boolean;
  onUse: (d: DraftOutput) => void;
  onRegenerate: () => void;
  onDismiss: (discarded: boolean) => void;
}) {
  if (pending && !draft) {
    return (
      <div className="mb-2 rounded-xl bg-crm-tint/60 p-3" role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-semibold text-crm">
          <Sparkles className="size-4 animate-pulse" aria-hidden /> Lendo a conversa, a agenda e as respostas rápidas...
        </p>
        <div className="mt-2 space-y-1.5" aria-hidden>
          <div className="h-2.5 w-11/12 animate-pulse rounded-full bg-crm/15" />
          <div className="h-2.5 w-8/12 animate-pulse rounded-full bg-crm/15" />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
        {error}
        <button type="button" onClick={() => onDismiss(false)} aria-label="Fechar aviso" className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-paper">
          <X className="size-4" aria-hidden />
        </button>
      </p>
    );
  }
  if (!draft) return null;

  const ai = draft.source === "ia";
  return (
    <section aria-label="Rascunho sugerido" className={cn("mb-2 rounded-xl p-3 ring-1", ai ? "bg-crm-tint/50 ring-crm/30" : "bg-fog ring-line")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", ai ? "bg-crm text-white" : "bg-paper text-ink-soft ring-1 ring-line")}>
          {ai ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          {ai ? "Rascunho da IA" : "Sugestão por regras"}
        </span>
        {ai ? (
          <span className="text-ink-soft">
            {draft.cached ? "o mesmo de há pouco" : draft.latencyMs ? `${(draft.latencyMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : ""}
          </span>
        ) : draft.fallbackReason ? (
          <span className="text-ink-soft">sem IA: {draft.fallbackReason}</span>
        ) : null}
        <button type="button" onClick={() => onDismiss(true)} className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-paper hover:text-ink" aria-label="Descartar rascunho">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {draft.needsHuman ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-erp-tint px-2 py-1.5 text-xs font-semibold text-erp-ink">
          <UserRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Pede decisão de uma pessoa{draft.reason ? `: ${draft.reason}` : ""}. Revise com atenção.
        </p>
      ) : null}

      <p className={cn("mt-2 text-sm break-words whitespace-pre-line", pending && "opacity-50")}>{draft.text}</p>

      {draft.warnings.length ? (
        <ul className="mt-2 space-y-0.5">
          {draft.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-xs text-erp-ink">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      ) : null}
      {!draft.windowOpen ? (
        <p className="mt-2 text-xs font-semibold text-erp-ink">Fora da janela de 24h: este texto não pode ser enviado agora. Use um modelo aprovado.</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onUse(draft)}
          disabled={!draft.windowOpen}
          className="inline-flex min-h-10 items-center rounded-xl bg-crm px-3 text-sm font-semibold text-white hover:bg-[#5a37cf] disabled:opacity-50 sm:min-h-9"
        >
          {hasText ? "Substituir o texto do campo" : "Usar no campo"}
        </button>
        <button type="button" onClick={onRegenerate} disabled={pending} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-50 sm:min-h-9">
          <RefreshCw className={cn("size-3.5", pending && "animate-spin")} aria-hidden /> Gerar outro
        </button>
        <span className="text-xs text-ink-soft">Revise antes de enviar: a sugestão pode errar.</span>
      </div>
    </section>
  );
}
