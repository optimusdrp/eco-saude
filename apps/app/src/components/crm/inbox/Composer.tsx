"use client";

import { ATTACHMENT_ACCEPT, fillTemplate, formatBytes, MAX_ATTACHMENT_BYTES, type TemplateVariables } from "@ecosaude/core/crm";
import { Lock, Paperclip, Send, StickyNote, X, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { cn } from "@/components/ui/styles";
import { useAppEvent } from "@/lib/hooks";
import { sendMessageAction } from "@/modules/crm/actions/conversations";
import { DraftCard, SuggestButton, useDraftAssistant } from "./DraftAssistant";
import { readDraft, useHydrated, writeDraft } from "./drafts";

/**
 * Caixa de resposta da conversa.
 * - "/" abre as respostas rápidas (com variáveis já preenchidas)
 * - Nota interna: fica só para a equipe
 * - Fora da janela de 24h: só modelos aprovados (regra da Meta)
 * - Enter envia, Shift+Enter quebra linha (ou Ctrl+Enter envia, conforme a preferência)
 * - Rascunho salvo por conversa neste navegador (trocar de conversa não perde o texto)
 * - Cada envio leva um ID gerado aqui (clientId): clique duplo não duplica
 * - "Sugerir resposta": rascunho da IA (ou do plano B por regras) para revisar; nunca envia sozinho
 */
export interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  approvedTemplate: boolean;
}

export function Composer({
  conversationId,
  quickReplies,
  vars,
  windowOpen,
  canReply,
  enterToSend = true,
  extraActions,
}: {
  conversationId: string;
  quickReplies: QuickReply[];
  vars: TemplateVariables;
  windowOpen: boolean;
  canReply: boolean;
  enterToSend?: boolean;
  /** Ações extras na barra (ex.: "Agendar pelo pedido") */
  extraActions?: React.ReactNode;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(sendMessageAction, {});
  const [, startTransition] = useTransition();
  const [body, setBody] = useState("");
  // Anexo escolhido: fica no estado (não no campo do formulário) para não sumir se o envio der erro
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chooseFile = (f: File | null) => {
    setFileError(null);
    if (f && f.size > MAX_ATTACHMENT_BYTES) {
      setFileError(`Arquivo com ${formatBytes(f.size)}: o limite é ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
      f = null;
    }
    setFile(f);
    if (fileRef.current) fileRef.current.value = "";
  };
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [internal, setInternal] = useState(!canReply);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [menuIndex, setMenuIndex] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  // Rascunho sugerido em uso no campo (para medir se foi usado como veio ou editado)
  const [aiDraftId, setAiDraftId] = useState<string | null>(null);
  const assistant = useDraftAssistant(conversationId);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Rascunho: ao abrir (ou trocar de) conversa, recupera o texto salvo.
  // Só depois de "acordar" no navegador, para não divergir do HTML do servidor.
  const hydrated = useHydrated();
  const [draftFor, setDraftFor] = useState<string | null>(null);
  if (hydrated && draftFor !== conversationId) {
    setDraftFor(conversationId);
    setBody(readDraft(conversationId));
    setTemplateId(undefined);
    setAiDraftId(null);
  }
  const changeBody = (value: string) => {
    setBody(value);
    writeDraft(conversationId, value);
  };

  // Sugestões do assistente preenchem a caixa
  useAppEvent("eco:fill-composer", (d) => {
    changeBody(d.body);
    setTemplateId(d.templateId);
    setInternal(false);
    areaRef.current?.focus();
  });

  // Enviou: limpa, gera novo ID e atualiza a conversa
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) {
      setBody("");
      setFile(null);
      setTemplateId(undefined);
      setAiDraftId(null);
      setClientId(crypto.randomUUID());
    }
  }
  // Efeitos fora da renderização: apaga o rascunho salvo e atualiza a conversa
  const onSent = useEffectEvent(() => {
    writeDraft(conversationId, "");
    router.refresh();
  });
  useEffect(() => {
    if (state.ok) onSent();
  }, [state]);

  // "/atalho" -> lista de respostas rápidas
  const slashQuery = body.startsWith("/") && !body.includes(" ") ? body.slice(1).toLowerCase() : null;
  const options = useMemo(() => {
    const list = windowOpen || internal ? quickReplies : quickReplies.filter((q) => q.approvedTemplate);
    return slashQuery === null ? [] : list.filter((q) => q.shortcut.includes(slashQuery) || q.title.toLowerCase().includes(slashQuery));
  }, [slashQuery, quickReplies, windowOpen, internal]);

  const pick = (q: QuickReply) => {
    setAiDraftId(null);
    changeBody(fillTemplate(q.body, vars));
    setTemplateId(q.approvedTemplate ? q.id : undefined);
    setMenuIndex(0);
    areaRef.current?.focus();
  };

  // Fora da janela, mensagem livre não pode: só modelo aprovado (ou nota interna)
  const blocked = !internal && !windowOpen && !templateId;
  const templates = quickReplies.filter((q) => q.approvedTemplate);

  return (
    <form
      ref={formRef}
      // Envio manual: o formulário não é "limpo" pelo React depois de um erro (o anexo continua escolhido)
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (file && !internal) fd.set("file", file);
        startTransition(() => action(fd));
      }}
      className="border-t border-line bg-paper p-3"
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="clientId" value={clientId} />
      {templateId ? <input type="hidden" name="templateId" value={templateId} /> : null}
      {internal ? <input type="hidden" name="internal" value="on" /> : null}
      {aiDraftId && !internal ? <input type="hidden" name="aiDraftId" value={aiDraftId} /> : null}

      {!internal ? (
        <DraftCard
          draft={assistant.draft}
          error={assistant.error}
          pending={assistant.pending}
          hasText={!!body.trim() && body !== assistant.draft?.text}
          onUse={(d) => {
            changeBody(d.text);
            setTemplateId(undefined);
            setAiDraftId(d.id);
            assistant.dismiss(false);
            areaRef.current?.focus();
          }}
          onRegenerate={() => assistant.request(true)}
          onDismiss={assistant.dismiss}
        />
      ) : null}

      {!windowOpen && !internal ? (
        <div className="mb-2 rounded-xl bg-erp-tint p-3 text-sm text-erp-ink">
          <p className="flex items-center gap-1.5 font-semibold">
            <Lock className="size-4" aria-hidden /> Janela de 24h fechada
          </p>
          <p>O paciente não escreve há mais de 24h. Pela regra da Meta, só é possível enviar um modelo aprovado:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {templates.length === 0 ? <span>Nenhum modelo cadastrado (Ajustes &gt; Respostas rápidas).</span> : null}
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t)}
                className={cn("min-h-9 rounded-full px-3 font-semibold ring-1", templateId === t.id ? "bg-erp-ink text-white ring-erp-ink" : "bg-paper ring-erp/50")}
              >
                /{t.shortcut}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {state.message && !state.ok ? (
        <p role="alert" className="mb-2 rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          {state.message}
        </p>
      ) : null}

      <div className="relative">
        {options.length ? (
          <ul role="listbox" aria-label="Respostas rápidas" className="absolute bottom-full left-0 z-10 mb-2 max-h-64 w-full overflow-y-auto rounded-xl bg-paper p-1 shadow-xl ring-1 ring-line">
            {options.map((q, i) => (
              <li key={q.id} role="option" aria-selected={i === menuIndex}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(q)}
                  className={cn("flex w-full flex-col items-start rounded-lg px-3 py-2 text-left", i === menuIndex ? "bg-crm-tint" : "hover:bg-fog")}
                >
                  <span className="text-sm font-semibold">
                    /{q.shortcut} <span className="font-normal text-ink-soft">{q.title}</span>
                    {q.approvedTemplate ? <span className="ml-1 rounded bg-pep-tint px-1 text-xs text-pep-ink">modelo</span> : null}
                  </span>
                  <span className="line-clamp-1 text-xs text-ink-soft">{fillTemplate(q.body, vars)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor="composer" className="sr-only">
          {internal ? "Nota interna" : "Mensagem"}
        </label>
        <textarea
          ref={areaRef}
          id="composer"
          name="body"
          rows={2}
          value={body}
          onChange={(e) => {
            changeBody(e.target.value);
            // Editar o texto de um modelo o transforma em mensagem livre
            if (templateId) setTemplateId(undefined);
            setMenuIndex(0);
          }}
          onKeyDown={(e) => {
            if (options.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMenuIndex((i) => Math.min(i + 1, options.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMenuIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(options[menuIndex]!);
                return;
              }
            }
            const send = enterToSend ? e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey : e.key === "Enter" && (e.ctrlKey || e.metaKey);
            if (send) {
              e.preventDefault();
              if ((body.trim() || (file && !internal)) && !blocked && !pending) formRef.current?.requestSubmit();
            }
          }}
          placeholder={internal ? "Nota visível só para a equipe" : `Escreva a resposta. "/" abre as respostas rápidas. ${enterToSend ? "Enter envia." : "Ctrl+Enter envia."}`}
          className={cn(
            "block max-h-48 min-h-14 w-full resize-y rounded-xl px-3 py-2.5 ring-1 outline-none focus:ring-2",
            internal ? "bg-erp-tint ring-erp/50 focus:ring-erp" : "bg-fog ring-line focus:ring-crm",
          )}
        />
      </div>

      {file && !internal ? (
        <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl bg-crm-tint/60 px-3 py-1.5 text-sm">
          <Paperclip className="size-4 shrink-0 text-crm" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-semibold" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 text-xs text-ink-soft">{formatBytes(file.size)}</span>
          <button
            type="button"
            onClick={() => chooseFile(null)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-paper"
            aria-label={`Tirar o anexo ${file.name}`}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {fileError ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-alert">
          {fileError}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => {
              changeBody("/");
              areaRef.current?.focus();
            }}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-crm hover:underline sm:min-h-9"
          >
            <Zap className="size-4" aria-hidden />
            Respostas rápidas
          </button>
          {canReply && !internal ? <SuggestButton onClick={() => assistant.request(false)} pending={assistant.pending} /> : null}
          {!internal ? extraActions : null}
          {canReply && !internal ? (
            <>
              <input ref={fileRef} id="composer-file" type="file" accept={ATTACHMENT_ACCEPT} className="sr-only" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
              <label htmlFor="composer-file" className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-crm hover:underline sm:min-h-9">
                <Paperclip className="size-4" aria-hidden />
                Anexar
              </label>
            </>
          ) : null}
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold sm:min-h-9">
            <input type="checkbox" checked={internal} disabled={!canReply} onChange={(e) => setInternal(e.target.checked)} className="size-4 accent-[var(--color-erp-ink)]" />
            <StickyNote className="size-4 text-erp-ink" aria-hidden />
            Nota interna
          </label>
          {body.length > 0 ? (
            <span className={cn("text-xs tabular", body.length > 4000 ? "font-bold text-alert" : "text-ink-soft")} aria-live="polite">
              {body.length} caracteres{draftFor === conversationId && body.trim() ? ", rascunho salvo" : ""}
            </span>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={(!body.trim() && !(file && !internal)) || blocked || pending}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-10",
            internal ? "bg-erp-ink" : "bg-crm hover:bg-[#5a37cf]",
          )}
        >
          <Send className="size-4" aria-hidden />
          {pending ? "Enviando..." : internal ? "Salvar nota" : "Enviar"}
        </button>
      </div>
    </form>
  );
}
