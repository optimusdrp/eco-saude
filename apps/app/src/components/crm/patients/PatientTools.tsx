"use client";

import { CHANNEL_LABEL, JOURNEY_STAGE_LABEL, JOURNEY_STAGES, type Channel, type JourneyStage } from "@ecosaude/core/crm";
import { CalendarDays, MessageCircle, Pencil, StickyNote, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Dialog, FormMessage, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { addNoteAction, moveStageAction } from "@/modules/crm/actions/contacts";
import { ContactForm, type ContactFormValues } from "./ContactForm";

/**
 * Peças interativas da FICHA 360 do paciente.
 * Cada uma chama uma server action e atualiza a página ao concluir.
 */

/** Atualiza a página quando a ação deu certo. */
function useRefreshOnOk(state: { ok?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
}

/* ------------------------------ Editar cadastro ----------------------------- */

export function EditContactButton({ initial }: { initial: ContactFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles("secondary")}>
        <Pencil className="size-4" aria-hidden /> Editar cadastro
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Editar cadastro" description={initial.name}>
        <ContactForm
          initial={initial}
          idPrefix="edit"
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </Dialog>
    </>
  );
}

/* ------------------------------- Mudar etapa -------------------------------- */

export function StageSelect({ contactId, stage }: { contactId: string; stage: JourneyStage }) {
  const [state, action] = useActionState(moveStageAction, {});
  const [picked, setPicked] = useState<JourneyStage>(stage);
  useRefreshOnOk(state);
  // A etapa pode mudar sozinha (automação): acompanha o valor do servidor
  const [lastStage, setLastStage] = useState(stage);
  if (stage !== lastStage) {
    setLastStage(stage);
    setPicked(stage);
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contactId" value={contactId} />
      <label htmlFor="stage-select" className="text-sm font-semibold">
        Etapa da jornada
      </label>
      <div className="flex gap-2">
        <select
          id="stage-select"
          name="stage"
          value={picked}
          onChange={(e) => setPicked(e.target.value as JourneyStage)}
          className="min-h-11 min-w-0 flex-1 rounded-xl bg-paper px-3 ring-1 ring-line"
        >
          {JOURNEY_STAGES.map((s) => (
            <option key={s} value={s}>
              {JOURNEY_STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {picked !== stage ? (
          <SubmitButton variant="primary" pendingText="...">
            Mover
          </SubmitButton>
        ) : null}
      </div>
      {picked === "perdido" && stage !== "perdido" ? (
        <TextareaField label="Motivo da perda" name="lostReason" id="stage-lost" error={state.errors?.lostReason} placeholder="Ex.: achou caro, escolheu outra clínica" />
      ) : null}
      {state.message && !state.ok ? <FormMessage state={state} /> : null}
      <p className="text-xs text-ink-soft">Normalmente a etapa muda sozinha: ao responder, agendar, comparecer ou ficar muito tempo sem voltar.</p>
    </form>
  );
}

/* --------------------------------- Anotação --------------------------------- */

export function NoteForm({ contactId }: { contactId: string }) {
  const [state, action] = useActionState(addNoteAction, {});
  // clientId novo a cada nota salva: reenviar a mesma (rede instável) não duplica
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [formKey, setFormKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) {
      setClientId(crypto.randomUUID());
      setFormKey((k) => k + 1);
    }
  }
  useRefreshOnOk(state);
  return (
    <form key={formKey} action={action} className="space-y-2">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="clientId" value={clientId} />
      <TextareaField
        label="Nova anotação"
        name="body"
        id="note-body"
        placeholder="Ex.: prefere horários após as 18h; vem acompanhada da filha."
        error={state.errors?.body}
        hint="Só a equipe vê. Fica na linha do tempo."
      />
      <SubmitButton variant="secondary" pendingText="Salvando...">
        <StickyNote className="size-4" aria-hidden /> Salvar anotação
      </SubmitButton>
    </form>
  );
}

/* ----------------------------- Linha do tempo ------------------------------- */

export type TimelineKind = "in" | "out" | "note" | "appointment" | "event" | "system";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  /** ISO */
  at: string;
  /** Data/hora já formatada no servidor (fuso da clínica) */
  when: string;
  text: string;
  sub?: string;
  channel?: Channel | null;
  author?: string | null;
  conversationId?: string;
}

const FILTERS = [
  { id: "tudo", label: "Tudo", kinds: null },
  { id: "conversas", label: "Conversas", kinds: ["in", "out", "system"] },
  { id: "consultas", label: "Consultas", kinds: ["appointment"] },
  { id: "anotacoes", label: "Anotações", kinds: ["note"] },
  { id: "automacoes", label: "Automações", kinds: ["event"] },
] as const;

const kindStyle: Record<TimelineKind, { dot: string; icon: typeof MessageCircle; label: string }> = {
  in: { dot: "bg-crm text-white", icon: MessageCircle, label: "Paciente" },
  out: { dot: "bg-ink text-white", icon: MessageCircle, label: "Clínica" },
  system: { dot: "bg-bi text-white", icon: Zap, label: "Automático" },
  note: { dot: "bg-erp text-ink", icon: StickyNote, label: "Anotação" },
  appointment: { dot: "bg-pep text-white", icon: CalendarDays, label: "Consulta" },
  event: { dot: "bg-fog text-ink-soft ring-1 ring-line", icon: Zap, label: "Registro" },
};

/**
 * LINHA DO TEMPO UNIFICADA: mensagens de todos os canais, consultas,
 * anotações e automações numa única história, com filtro rápido.
 */
export function Timeline({ items }: { items: TimelineItem[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("tudo");
  const [limit, setLimit] = useState(25);
  const active = FILTERS.find((f) => f.id === filter)!;
  const shown = items.filter((i) => !active.kinds || (active.kinds as readonly string[]).includes(i.kind));

  return (
    <div>
      <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Filtrar linha do tempo">
        {FILTERS.map((f) => {
          const n = items.filter((i) => !f.kinds || (f.kinds as readonly string[]).includes(i.kind)).length;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setLimit(25);
              }}
              className={cn("inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold ring-1", filter === f.id ? "bg-ink text-white ring-ink" : "bg-paper ring-line")}
            >
              {f.label} <span className="tabular opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? <p className="py-6 text-center text-ink-soft">Nada por aqui ainda.</p> : null}

      <ol className="relative space-y-3 border-l-2 border-line pl-6">
        {shown.slice(0, limit).map((i) => {
          const s = kindStyle[i.kind];
          const Icon = s.icon;
          return (
            <li key={i.id} className="relative">
              <span className={cn("absolute top-0.5 -left-[2.15rem] inline-flex size-6 items-center justify-center rounded-full", s.dot)} aria-hidden>
                <Icon className="size-3.5" />
              </span>
              <p className="text-xs text-ink-soft">
                <span className="font-semibold text-ink">{i.author ?? s.label}</span>
                {i.channel ? ` pelo ${CHANNEL_LABEL[i.channel]}` : ""}, <time dateTime={i.at}>{i.when}</time>
              </p>
              <div
                className={cn(
                  "mt-1 rounded-xl px-3 py-2 text-sm break-words whitespace-pre-line",
                  i.kind === "in" && "bg-crm-tint",
                  i.kind === "out" && "bg-fog",
                  i.kind === "note" && "bg-erp-tint",
                  i.kind === "appointment" && "bg-pep-tint",
                  (i.kind === "event" || i.kind === "system") && "bg-paper ring-1 ring-line",
                )}
              >
                {i.text}
                {i.sub ? <span className="mt-0.5 block text-xs text-ink-soft">{i.sub}</span> : null}
              </div>
              {i.conversationId ? (
                <a href={`/crm/conversas/${i.conversationId}`} className="mt-1 inline-block text-xs font-semibold text-crm hover:underline">
                  Abrir conversa
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
      {shown.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + 25)} className="mt-3 min-h-10 text-sm font-semibold text-crm hover:underline">
          Ver mais antigas ({shown.length - limit})
        </button>
      ) : null}
    </div>
  );
}
