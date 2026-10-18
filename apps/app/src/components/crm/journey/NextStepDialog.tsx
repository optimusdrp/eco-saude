"use client";

/**
 * PRÓXIMO PASSO: o rascunho pronto para o cartão da Jornada.
 *  - O PASSO veio das regras (sempre certo); o TEXTO vem da IA ou, sem ela, das regras.
 *  - A pessoa edita e envia: agora, ou no melhor horário do paciente (se ligado).
 *  - Janela de 24h fechada: mensagem livre não sai; abre a conversa para usar um modelo.
 */
import { Bot, Clock, MessagesSquare, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Dialog, FormMessage } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { nextStepDraftAction, sendNextStepAction } from "@/modules/crm/actions/insights";
import type { NextStepDraftView } from "@/modules/crm/ai/insights";
import type { JourneyCard } from "./types";

export function NextStepDialog({ card, onClose }: { card: JourneyCard | null; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<NextStepDraftView | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const [state, action, pending] = useActionState(sendNextStepAction, {});
  const [forCard, setForCard] = useState<string | null>(null);

  // Abriu para outro cartão: limpa o anterior (ajuste durante a renderização, sem efeitos)
  const cardId = card?.id ?? null;
  if (forCard !== cardId) {
    setForCard(cardId);
    setDraft(null);
    setError(null);
  }

  // ...e busca o rascunho (fora da renderização)
  useEffect(() => {
    if (!cardId) return;
    let alive = true;
    start(async () => {
      const r = await nextStepDraftAction(cardId);
      if (!alive) return;
      if (r.ok) {
        setDraft(r.draft);
        setText(r.draft.text);
      } else setError(r.message);
    });
    return () => {
      alive = false;
    };
  }, [cardId]);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);

  return (
    <Dialog open={!!card} onClose={onClose} title={card ? `Próximo passo: ${card.name}` : ""} description={card?.nextStep?.title}>
      {loading && !draft ? (
        <p className="flex items-center gap-2 text-sm text-crm" role="status">
          <Sparkles className="size-4 animate-pulse" aria-hidden /> Preparando o rascunho...
        </p>
      ) : error ? (
        <p role="alert" className="rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          {error}
        </p>
      ) : draft ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="conversationId" value={draft.conversationId ?? ""} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", draft.source === "ia" ? "bg-crm text-white" : "bg-fog text-ink-soft ring-1 ring-line")}>
              {draft.source === "ia" ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
              {draft.source === "ia" ? "Rascunho da IA" : "Rascunho pronto"}
            </span>
            {draft.source === "regras" && draft.reason ? <span className="text-ink-soft">sem IA: {draft.reason}</span> : null}
          </div>
          <label htmlFor="next-step-text" className="sr-only">
            Mensagem
          </label>
          <textarea
            id="next-step-text"
            name="body"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="block w-full rounded-xl bg-paper p-3 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm"
          />
          <FormMessage state={state} />
          {!draft.conversationId ? (
            <p className="text-sm text-ink-soft">Este contato ainda não tem conversa. Comece pela ficha do paciente.</p>
          ) : !draft.windowOpen ? (
            <p className="rounded-xl bg-erp-tint px-3 py-2 text-sm text-erp-ink">Fora da janela de 24h do WhatsApp: mensagem livre não pode sair agora. Abra a conversa e use um modelo aprovado.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {draft.conversationId && draft.windowOpen ? (
              <>
                <button type="submit" name="at" value="" disabled={pending || !text.trim()} className={buttonStyles("primary")}>
                  <Send className="size-4" aria-hidden /> Enviar agora
                </button>
                {draft.best ? (
                  <button type="submit" name="at" value={draft.best.at} disabled={pending || !text.trim()} className={buttonStyles("secondary")} title={`Costuma responder ${draft.best.label}`}>
                    <Clock className="size-4" aria-hidden /> Enviar {draft.best.when}
                  </button>
                ) : null}
              </>
            ) : null}
            {draft.conversationId ? (
              <Link href={`/crm/conversas/${draft.conversationId}`} className={buttonStyles("ghost")}>
                <MessagesSquare className="size-4" aria-hidden /> Abrir conversa
              </Link>
            ) : null}
          </div>
          {draft.best ? <p className="text-xs text-ink-soft">Costuma responder {draft.best.label}.</p> : null}
          <p className="text-xs text-ink-soft">Revise antes de enviar: a sugestão pode errar.</p>
        </form>
      ) : null}
    </Dialog>
  );
}
