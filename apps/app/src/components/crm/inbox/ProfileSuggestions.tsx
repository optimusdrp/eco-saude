"use client";

/**
 * SUGESTÕES PARA A FICHA E ETIQUETAS (Ajustes > Inteligência artificial)
 * Dados mencionados no chat (nascimento, e-mail, convênio, indicação) e etiquetas
 * pelo comportamento ("prefere áudio", "sensível a preço"), sempre com a evidência.
 * A ficha só muda com "Aplicar"; "Descartar" não volta a sugerir o mesmo valor.
 */
import { PROFILE_FIELD_LABEL, type ProfileField } from "@ecosaude/core/crm";
import { Bot, Check, ScanSearch, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { cn } from "@/components/ui/styles";
import { analyzeContactAction, applySuggestionAction, dismissSuggestionAction } from "@/modules/crm/actions/insights";
import type { ThreadData } from "./types";

const showValue = (field: string, value: string) => (field === "birthDate" ? value.split("-").reverse().join("/") : value);

export function ProfileSuggestions({ thread, canEdit }: { thread: ThreadData; canEdit: boolean }) {
  const router = useRouter();
  const [analyze, analyzeAction, analyzing] = useActionState(analyzeContactAction, {});
  useEffect(() => {
    if (analyze.ok) router.refresh();
  }, [analyze, router]);
  // Análise em andamento: atualiza sozinha por alguns segundos
  useEffect(() => {
    if (!thread.profileSuggestionsPending) return;
    const t = setTimeout(() => router.refresh(), 3500);
    return () => clearTimeout(t);
  }, [thread.profileSuggestionsPending, router]);

  const fields = thread.profileSuggestions.filter((s) => s.kind === "campo");
  const tags = thread.profileSuggestions.filter((s) => s.kind === "etiqueta");
  return (
    <section aria-labelledby="sugestoes-ficha" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="sugestoes-ficha" className="text-sm font-bold">
          Sugestões para a ficha
        </h2>
        {canEdit ? (
          <form action={analyzeAction}>
            <input type="hidden" name="contactId" value={thread.contact.id} />
            <button
              type="submit"
              disabled={analyzing || thread.profileSuggestionsPending}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-crm hover:bg-crm-tint disabled:opacity-50"
            >
              <ScanSearch className="size-3.5" aria-hidden /> Analisar conversa
            </button>
          </form>
        ) : null}
      </div>
      {thread.profileSuggestionsPending ? (
        <p className="flex items-center gap-1 text-xs text-crm" role="status">
          <Sparkles className="size-3 animate-pulse" aria-hidden /> Lendo as conversas...
        </p>
      ) : null}
      {analyze.message && !analyze.ok ? <p className="text-xs font-semibold text-alert">{analyze.message}</p> : null}
      {!fields.length && !tags.length && !thread.profileSuggestionsPending ? <p className="text-xs text-ink-soft">Nada novo por enquanto.</p> : null}
      <ul className="space-y-1.5">
        {fields.map((s) => (
          <Item key={s.id} id={s.id} label={PROFILE_FIELD_LABEL[s.field as ProfileField] ?? s.field} value={showValue(s.field, s.value)} evidence={s.evidence} source={s.source} canEdit={canEdit} />
        ))}
      </ul>
      {tags.length ? (
        <>
          <h3 className="pt-1 text-xs font-bold text-ink-soft">Etiquetas sugeridas</h3>
          <ul className="space-y-1.5">
            {tags.map((s) => (
              <Item key={s.id} id={s.id} label="Etiqueta" value={s.value} evidence={s.evidence} source={s.source} canEdit={canEdit} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Item({ id, label, value, evidence, source, canEdit }: { id: string; label: string; value: string; evidence: string | null; source: "ia" | "regras"; canEdit: boolean }) {
  const router = useRouter();
  const [applied, apply, applying] = useActionState(applySuggestionAction, {});
  const [dismissed, dismiss, dismissing] = useActionState(dismissSuggestionAction, {});
  useEffect(() => {
    if (applied.ok || dismissed.ok) router.refresh();
  }, [applied, dismissed, router]);
  return (
    <li className="rounded-xl bg-fog p-2.5">
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span>
          <span className="text-ink-soft">{label}:</span> <strong className="break-all">{value}</strong>
        </span>
        <span className={cn("inline-flex items-center gap-0.5 text-[0.7rem]", source === "ia" ? "text-crm" : "text-ink-soft")} title={source === "ia" ? "Sugerido pela IA" : "Pelas regras do CRM"}>
          {source === "ia" ? <Sparkles className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          {source === "ia" ? "IA" : "regras"}
        </span>
      </p>
      {evidence ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{evidence.startsWith("“") ? evidence : `“${evidence}”`}</p> : null}
      {canEdit ? (
        <div className="mt-1.5 flex gap-1">
          <form action={apply}>
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              disabled={applying}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-paper px-2.5 text-xs font-semibold text-pep-ink ring-1 ring-line hover:ring-pep disabled:opacity-50"
            >
              <Check className="size-3.5" aria-hidden /> Aplicar
            </button>
          </form>
          <form action={dismiss}>
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              disabled={dismissing}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-50"
            >
              <X className="size-3.5" aria-hidden /> Descartar
            </button>
          </form>
        </div>
      ) : null}
      {applied.message && !applied.ok ? <p className="mt-1 text-xs font-semibold text-alert">{applied.message}</p> : null}
    </li>
  );
}
