"use client";

/**
 * Cartão de um contato no quadro da Jornada.
 * Clique no nome abre o trilho do paciente; ações rápidas: conversar,
 * agendar, criar tarefa e mover de etapa (também pelo teclado/celular).
 */
import { CHANNEL_LABEL, JOURNEY_STAGE_LABEL, JOURNEY_STAGES, JOURNEY_STALE_DAYS, type JourneyStage } from "@ecosaude/core/crm";
import { CalendarCheck2, CalendarPlus, Flame, ListPlus, MessageCircle, MessagesSquare, Sparkles } from "lucide-react";
import Link from "next/link";
import { channelDot, initials } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import type { JourneyCard, JourneyPrefs } from "./types";

export const isStale = (c: Pick<JourneyCard, "stage" | "daysInStage">) => (JOURNEY_STALE_DAYS[c.stage] ?? Infinity) <= c.daysInStage;

export function Card({
  card,
  prefs,
  canEdit,
  canSchedule,
  dragging,
  selecting,
  selected,
  onToggle,
  onDragStart,
  onDragEnd,
  onMove,
  onTask,
  onNextStep,
}: {
  card: JourneyCard;
  prefs: JourneyPrefs;
  canEdit: boolean;
  canSchedule: boolean;
  dragging: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onMove: (card: JourneyCard, stage: JourneyStage) => void;
  onTask: (card: JourneyCard) => void;
  onNextStep?: (card: JourneyCard) => void;
}) {
  const stale = isStale(card);
  const compact = prefs.density === "compacta";
  // "Calor": quanto mais tempo parado além do limite, mais forte o alerta
  const limit = JOURNEY_STALE_DAYS[card.stage];
  const heat = limit ? Math.min(3, Math.floor(card.daysInStage / limit)) : 0;

  return (
    <li
      draggable={canEdit && !selecting}
      onDragStart={(e) => {
        onDragStart(card.id);
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
      data-card={card.id}
      className={cn(
        "group relative rounded-xl bg-paper ring-1 ring-line transition-shadow hover:shadow-md",
        compact ? "p-2.5" : "p-3",
        canEdit && !selecting && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        stale && (heat >= 3 ? "ring-2 ring-alert" : "ring-2 ring-erp"),
        selected && "ring-2 ring-crm",
      )}
    >
      <div className="flex items-start gap-2">
        {selecting ? (
          <input type="checkbox" checked={selected} onChange={() => onToggle(card.id)} className="mt-1 size-4 shrink-0 accent-[var(--color-crm)]" aria-label={`Selecionar ${card.name}`} />
        ) : null}
        <button type="button" onClick={() => (selecting ? onToggle(card.id) : emit("eco:open-patient", card.id))} className="min-w-0 flex-1 text-left">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{card.name}</span>
            {card.channel ? <span className={cn("size-2 shrink-0 rounded-full", channelDot[card.channel])} title={CHANNEL_LABEL[card.channel]} aria-label={CHANNEL_LABEL[card.channel]} /> : null}
          </span>
          {card.waiting ? (
            <span className="mt-1 flex items-center gap-1 text-xs font-bold text-crm">
              <MessageCircle className="size-3.5" aria-hidden /> Esperando resposta
            </span>
          ) : null}
          {card.next ? (
            <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-pep-ink">
              <CalendarCheck2 className="size-3.5" aria-hidden /> {card.next}
            </span>
          ) : null}
          <span className={cn("mt-1 flex items-center gap-1 text-xs", stale ? (heat >= 3 ? "font-bold text-alert" : "font-bold text-erp-ink") : "text-ink-soft")}>
            {stale ? <Flame className="size-3.5" aria-hidden /> : null}
            {card.daysInStage === 0 ? "nesta etapa desde hoje" : `há ${card.daysInStage} ${card.daysInStage === 1 ? "dia" : "dias"} nesta etapa`}
          </span>
          {card.stage === "perdido" && card.lostReason && !compact ? <span className="mt-1 block text-xs text-ink-soft">Motivo: {card.lostReason}</span> : null}
          {!compact && ((prefs.showTags && card.tags.length) || (prefs.showSource && card.source)) ? (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {prefs.showSource && card.source ? <span className="rounded-full bg-fog px-2 py-0.5 text-[0.7rem] text-ink-soft">{card.source}</span> : null}
              {prefs.showTags
                ? card.tags.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full bg-fog px-2 py-0.5 text-[0.7rem] text-ink-soft ring-1 ring-line">
                      {t}
                    </span>
                  ))
                : null}
            </span>
          ) : null}
        </button>
        {prefs.showOwner && card.ownerName ? (
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[0.65rem] font-bold text-white"
            title={`Responsável: ${card.ownerName}`}
            aria-label={`Responsável: ${card.ownerName}`}
          >
            {initials(card.ownerName)}
          </span>
        ) : null}
      </div>

      {/* Próximo passo (Ajustes > IA): o que fazer agora, com rascunho pronto */}
      {card.nextStep && !selecting ? (
        <button
          type="button"
          onClick={() => onNextStep?.(card)}
          className="mt-2 flex w-full items-start gap-1.5 rounded-lg bg-crm-tint/60 px-2 py-1.5 text-left text-xs font-semibold text-crm hover:bg-crm-tint"
          title="Ver a mensagem sugerida"
        >
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{card.nextStep.title}</span>
        </button>
      ) : null}

      {/* Ações rápidas (aparecem ao passar o mouse ou focar; sempre visíveis no toque) */}
      {!selecting ? (
        <div className="mt-2 flex items-center gap-1 [@media(hover:hover)]:hidden [@media(hover:hover)]:group-focus-within:flex [@media(hover:hover)]:group-hover:flex">
          {card.conversationId ? (
            <Link
              href={`/crm/conversas/${card.conversationId}`}
              className="inline-flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-fog hover:text-crm"
              aria-label={`Abrir conversa com ${card.name}`}
              title="Abrir conversa"
            >
              <MessagesSquare className="size-4" aria-hidden />
            </Link>
          ) : null}
          {canSchedule ? (
            <button
              type="button"
              onClick={() => emit("eco:open-schedule", { contactId: card.id, contactName: card.name })}
              className="inline-flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-fog hover:text-crm"
              aria-label={`Agendar consulta para ${card.name}`}
              title="Agendar"
            >
              <CalendarPlus className="size-4" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onTask(card)}
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-fog hover:text-crm"
            aria-label={`Criar tarefa para ${card.name}`}
            title="Criar tarefa"
          >
            <ListPlus className="size-4" aria-hidden />
          </button>
          {canEdit ? (
            <select
              value={card.stage}
              onChange={(e) => onMove(card, e.target.value as JourneyStage)}
              className="ml-auto min-h-8 min-w-0 flex-1 rounded-lg bg-fog px-2 text-xs ring-1 ring-line"
              aria-label={`Mover ${card.name} para outra etapa`}
            >
              {JOURNEY_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s === card.stage ? `Em: ${JOURNEY_STAGE_LABEL[s]}` : `Mover para ${JOURNEY_STAGE_LABEL[s]}`}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
