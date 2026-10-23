"use client";

/**
 * MENSAGENS DA CONVERSA
 * - Abre já no fim (a mensagem mais nova) e acompanha as novas que chegam,
 *   a não ser que a pessoa tenha rolado para cima para ler; aí aparece
 *   "Novas mensagens" para descer.
 * - Mensagens seguidas da mesma pessoa ficam agrupadas (menos ruído).
 * - Busca dentro da conversa com destaque e "anterior/próxima".
 */
import { MessageAttachments } from "./Attachments";
import { AlertTriangle, ArrowDown, Bot, Check, CheckCheck, ChevronDown, ChevronUp, Clock, Copy, Search, Smartphone, StickyNote, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/styles";
import type { ThreadMessage } from "./types";

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MessageList({ messages, searchOpen, onCloseSearch }: { messages: ThreadMessage[]; searchOpen: boolean; onCloseSearch: () => void }) {
  const scroller = useRef<HTMLOListElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [seenCount, setSeenCount] = useState(messages.length);
  const [term, setTerm] = useState("");
  const [hit, setHit] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  // Ao abrir e quando chegam mensagens: desce até o fim (se a pessoa já estava no fim)
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
    // atBottom de propósito fora das dependências: só reage a mensagens novas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const newCount = atBottom ? 0 : Math.max(0, messages.length - seenCount);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom) setSeenCount(messages.length);
  };
  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setSeenCount(messages.length);
  };

  // Busca na conversa
  const q = plain(term.trim());
  const matches = q.length >= 2 ? messages.filter((m) => plain(m.body).includes(q)).map((m) => m.id) : [];
  const current = matches.length ? matches[Math.min(hit, matches.length - 1)] : null;
  const go = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (Math.min(hit, matches.length - 1) + dir + matches.length) % matches.length;
    setHit(next);
    document.getElementById(`msg-${matches[next]}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const copy = async (m: ThreadMessage) => {
    try {
      await navigator.clipboard.writeText(m.body);
      setCopied(m.id);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-line bg-paper px-3 py-2" role="search">
          <Search className="size-4 shrink-0 text-ink-soft" aria-hidden />
          <label htmlFor="thread-q" className="sr-only">
            Buscar nesta conversa
          </label>
          <input
            id="thread-q"
            autoFocus
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setHit(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") onCloseSearch();
            }}
            placeholder="Buscar nesta conversa"
            className="min-h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <span className="shrink-0 text-xs text-ink-soft tabular" aria-live="polite">
            {q.length >= 2 ? (matches.length ? `${Math.min(hit, matches.length - 1) + 1} de ${matches.length}` : "nada encontrado") : ""}
          </span>
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!matches.length}
            className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-fog disabled:opacity-30"
            aria-label="Resultado anterior"
          >
            <ChevronUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!matches.length}
            className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-fog disabled:opacity-30"
            aria-label="Próximo resultado"
          >
            <ChevronDown className="size-4" aria-hidden />
          </button>
          <button type="button" onClick={onCloseSearch} className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-fog" aria-label="Fechar busca">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <ol ref={scroller} onScroll={onScroll} className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-6" aria-label="Mensagens">
        {messages.length === 0 ? <li className="m-auto text-sm text-ink-soft">Nenhuma mensagem ainda.</li> : null}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const showDay = !prev || prev.dayLabel !== m.dayLabel;
          // Mesmo remetente, mesmo dia, até 5 min de diferença: mesma "bolha" visual
          const sameAsPrev = !!prev && !showDay && prev.direction === m.direction && prev.authorName === m.authorName && prev.auto === m.auto && prev.fromPhone === m.fromPhone && m.createdMs - prev.createdMs < 5 * 60_000;
          const sameAsNext =
            !!next && next.dayLabel === m.dayLabel && next.direction === m.direction && next.authorName === m.authorName && next.auto === m.auto && next.fromPhone === m.fromPhone && next.createdMs - m.createdMs < 5 * 60_000;
          const isHit = matches.includes(m.id);
          return (
            <Fragment key={m.id}>
              {showDay ? (
                <li className="my-3 self-center rounded-full bg-paper px-3 py-0.5 text-xs font-semibold text-ink-soft ring-1 ring-line first-letter:uppercase" aria-hidden>
                  {m.dayLabel}
                </li>
              ) : null}
              <li id={`msg-${m.id}`} className={cn("group flex flex-col", sameAsPrev ? "mt-0.5" : "mt-2.5")}>
                {m.direction === "note" || m.direction === "system" ? (
                  <div
                    className={cn(
                      "mx-auto w-full max-w-xl rounded-xl px-3 py-2 text-sm",
                      m.direction === "note" ? "bg-erp-tint text-erp-ink" : "bg-paper text-ink-soft ring-1 ring-line",
                      current === m.id && "ring-2 ring-crm",
                    )}
                  >
                    <p className="flex items-center gap-1 text-xs font-bold">
                      <StickyNote className="size-3.5" aria-hidden /> {m.direction === "note" ? `Nota interna de ${m.authorName ?? "alguém da equipe"}` : "Aviso do sistema"}
                      <span className="ml-auto font-normal">{m.time}</span>
                    </p>
                    <p className="whitespace-pre-line text-ink">
                      <Highlight text={m.body} term={isHit ? term.trim() : ""} />
                    </p>
                  </div>
                ) : (
                  <div className={cn("flex max-w-[88%] items-end gap-1 sm:max-w-[72%]", m.direction === "in" ? "self-start" : "flex-row-reverse self-end")}>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2",
                        m.direction === "in" ? "bg-paper ring-1 ring-line" : m.auto ? "bg-bi-tint" : "bg-crm-tint",
                        m.direction === "in" ? (sameAsPrev ? "rounded-tl-md" : "rounded-tl-sm") : sameAsPrev ? "rounded-tr-md" : "rounded-tr-sm",
                        sameAsNext && (m.direction === "in" ? "rounded-bl-md" : "rounded-br-md"),
                        current === m.id && "ring-2 ring-crm",
                      )}
                    >
                      {m.fromPhone && !sameAsPrev ? (
                        <p className="mb-0.5 flex items-center gap-1 text-xs font-bold text-crm" title="Respondida direto no celular da clínica: o Tropi não sabe quem da equipe digitou">
                          <Smartphone className="size-3.5" aria-hidden /> Enviada pelo celular
                        </p>
                      ) : null}
                      {m.auto && !sameAsPrev ? (
                        <p className="mb-0.5 flex items-center gap-1 text-xs font-bold text-bi">
                          <Bot className="size-3.5" aria-hidden /> Automático
                        </p>
                      ) : null}
                      <MessageAttachments items={m.attachments} outgoing={m.direction === "out"} />
                      {/* Só o rótulo do anexo ("[imagem]")? O anexo já diz isso: não repete o texto */}
                      {m.attachments.length && m.attachments.some((a) => a.label === m.body) ? null : (
                        <p className="whitespace-pre-line break-words">
                          <Highlight text={m.body} term={isHit ? term.trim() : ""} />
                        </p>
                      )}
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[0.7rem] text-ink-soft">
                        {m.direction === "out" && m.authorName && !sameAsNext ? `${m.authorName}, ` : ""}
                        {m.time}
                        {m.direction === "out" ? <StatusIcon status={m.status} /> : null}
                      </p>
                      {m.handledBy ? <p className="mt-1 text-xs font-semibold text-bi">Tratada automaticamente ({m.handledBy})</p> : null}
                      {m.status === "falhou" ? <p className="mt-1 text-xs font-semibold text-alert">Não enviada: {m.error}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => copy(m)}
                      className="mb-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-soft opacity-0 group-hover:opacity-100 hover:bg-paper focus-visible:opacity-100"
                      aria-label="Copiar texto da mensagem"
                      title={copied === m.id ? "Copiado" : "Copiar"}
                    >
                      {copied === m.id ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    </button>
                  </div>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>

      {!atBottom ? (
        <button type="button" onClick={toBottom} className="absolute right-4 bottom-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink px-3.5 text-sm font-semibold text-white shadow-lg">
          <ArrowDown className="size-4" aria-hidden />
          {newCount ? `${newCount} nova${newCount > 1 ? "s" : ""}` : "Mais recentes"}
        </button>
      ) : null}
    </div>
  );
}

/** Destaca o termo buscado (sem diferenciar acentos e maiúsculas) */
function Highlight({ text, term }: { text: string; term: string }) {
  if (term.length < 2) return <>{text}</>;
  const p = plain(text);
  const t = plain(term);
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  // O texto "plano" tem o mesmo tamanho do original (NFD + remoção de acentos de letras
  // pré-compostas pode mudar o tamanho); por segurança, só destaca se bater
  if (p.length !== text.length) return <>{text}</>;
  for (let at = p.indexOf(t); at !== -1; at = p.indexOf(t, at + t.length)) {
    parts.push(
      text.slice(i, at),
      <mark key={k++} className="rounded bg-erp/40 text-ink">
        {text.slice(at, at + t.length)}
      </mark>,
    );
    i = at + t.length;
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "fila") return <Clock className="size-3.5" aria-label="na fila" />;
  if (status === "enviada") return <Check className="size-3.5" aria-label="enviada" />;
  if (status === "entregue") return <CheckCheck className="size-3.5" aria-label="entregue" />;
  if (status === "lida") return <CheckCheck className="size-3.5 text-bi" aria-label="lida" />;
  if (status === "falhou") return <AlertTriangle className="size-3.5 text-alert" aria-label="falhou" />;
  return null;
}
