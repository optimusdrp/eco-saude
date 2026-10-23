"use client";

import { AlarmClock, CheckCircle2, ChevronDown, RotateCcw, ShieldOff, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useRef } from "react";
import { buttonStyles, cn } from "@/components/ui/styles";
import { markConversationReadAction, updateConversationAction } from "@/modules/crm/actions/conversations";

/**
 * Botões do topo da conversa: assumir, adiar (1 h a 1 dia), resolver/reabrir,
 * limpar urgência e transferir. Também zera o "não lidas" ao abrir a conversa.
 *
 * Atalhos: os botões têm data-shortcut ("a" assumir, "e" resolver) e o
 * quadro de mensagens dispara o clique quando a tecla é pressionada.
 * Com "ir para a próxima" ligado, resolver abre a próxima conversa da lista.
 */
const SNOOZE = [
  { hours: 1, label: "1 hora" },
  { hours: 2, label: "2 horas" },
  { hours: 4, label: "4 horas" },
  { hours: 24, label: "Amanhã (24 h)" },
];

export function ThreadControls({
  conversationId,
  resolved,
  mine,
  urgent,
  unread,
  canReply,
  assigneeId,
  team,
  nextHref,
  autoAdvance,
}: {
  conversationId: string;
  resolved: boolean;
  mine: boolean;
  assigneeId: string | null;
  team: { id: string; name: string }[];
  urgent: boolean;
  unread: number;
  canReply: boolean;
  /** Próxima conversa da lista (para "resolver e ir para a próxima") */
  nextHref?: string | null;
  autoAdvance?: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateConversationAction, {});
  const snoozeRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (unread > 0) markConversationReadAction(conversationId).then(() => router.refresh());
  }, [conversationId, unread, router]);

  const onDone = useEffectEvent(() => {
    const op = (state.data as { op?: string } | undefined)?.op;
    if (snoozeRef.current) snoozeRef.current.open = false;
    // Resolveu ou adiou: segue para a próxima (se a pessoa quiser)
    if (autoAdvance && nextHref && (op === "resolver" || op === "adiar")) router.push(nextHref);
    else router.refresh();
  });
  useEffect(() => {
    if (state.ok) onDone();
  }, [state]);

  if (!canReply) return null;
  const btn = (op: string, label: string, icon: React.ReactNode, opts: { extra?: Record<string, string>; variant?: "secondary" | "ghost" | "primary"; shortcut?: string } = {}) => (
    <form action={action}>
      <input type="hidden" name="id" value={conversationId} />
      <input type="hidden" name="op" value={op} />
      {Object.entries(opts.extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        disabled={pending}
        className={buttonStyles(opts.variant ?? "ghost", "min-h-10 px-3")}
        title={opts.shortcut ? `${label} (${opts.shortcut.toUpperCase()})` : label}
        aria-label={label}
        data-shortcut={opts.shortcut}
      >
        {icon}
        <span className="hidden 2xl:inline">{label}</span>
      </button>
    </form>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {urgent ? btn("limpar_urgencia", "Tirar alerta", <ShieldOff className="size-4" aria-hidden />) : null}
        {!mine && !resolved ? btn("assumir", "Assumir", <UserCheck className="size-4" aria-hidden />, { shortcut: "a" }) : null}
        {!resolved ? (
          // Adiar: menu com prazos (some da fila e volta sozinha)
          <details ref={snoozeRef} className="group relative">
            <summary className={cn(buttonStyles("ghost", "min-h-10 list-none px-3"), "[&::-webkit-details-marker]:hidden")} title="Adiar">
              <AlarmClock className="size-4" aria-hidden />
              <span className="hidden 2xl:inline">Adiar</span>
              <ChevronDown className="size-3.5" aria-hidden />
              <span className="sr-only">Adiar</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 w-44 rounded-xl bg-paper p-1 shadow-xl ring-1 ring-line">
              {SNOOZE.map((s) => (
                <form key={s.hours} action={action}>
                  <input type="hidden" name="id" value={conversationId} />
                  <input type="hidden" name="op" value="adiar" />
                  <input type="hidden" name="hours" value={s.hours} />
                  <button type="submit" disabled={pending} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold hover:bg-fog">
                    {s.label}
                  </button>
                </form>
              ))}
            </div>
          </details>
        ) : null}
        {resolved
          ? btn("reabrir", "Reabrir", <RotateCcw className="size-4" aria-hidden />, { variant: "secondary" })
          : btn("resolver", autoAdvance && nextHref ? "Resolver e ir para a próxima" : "Resolver", <CheckCircle2 className="size-4" aria-hidden />, { variant: "secondary", shortcut: "e" })}
      </div>
      {!resolved ? (
        // Transferir: escolher o colega muda o responsável na hora
        <form action={action} className="flex items-center gap-1.5">
          <input type="hidden" name="id" value={conversationId} />
          <input type="hidden" name="op" value="atribuir" />
          <label htmlFor={`assignee-${conversationId}`} className="text-xs text-ink-soft">
            Responsável
          </label>
          <select
            id={`assignee-${conversationId}`}
            name="assigneeId"
            defaultValue={assigneeId ?? ""}
            key={assigneeId ?? "none"}
            disabled={pending}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="min-h-9 max-w-40 rounded-lg bg-fog px-2 text-xs font-semibold ring-1 ring-line"
          >
            <option value="">Ninguém</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </form>
      ) : null}
      {state.message ? (
        <p role="status" className={cn("text-xs font-semibold", state.ok ? "text-ok-ink" : "text-alert")}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/** Chip de sugestão do assistente: clica e a resposta vai para a caixa de texto. */
export function SuggestionChip({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("eco:fill-composer", { detail: { body: text } }))}
      className="w-full rounded-xl bg-paper px-3 py-2 text-left text-sm ring-1 ring-line hover:ring-crm"
    >
      {text}
    </button>
  );
}
