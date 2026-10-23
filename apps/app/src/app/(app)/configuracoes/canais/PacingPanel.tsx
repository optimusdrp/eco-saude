"use client";

/**
 * RITMO DE ENVIO E FILA DO WHATSAPP (Ajustes > Canais)
 *
 * - Fila: quantas mensagens aguardam, quantas saíram na última hora, previsão e por que a
 *   próxima automática ainda não saiu; mensagens que venceram na fila nas últimas 24 h.
 * - Ritmo (só no WhatsApp do celular): três sugestões prontas, cada uma com para quem serve e
 *   o que significa na prática, ou números personalizados.
 */
import { formatDrain, PACING_BLOCK_LABEL, PACING_BOUNDS, PACING_PRESET_IDS, PACING_PRESETS, pacingTraits, type PacingChoice, type PacingLimits } from "@ecosaude/core/crm";
import { Gauge, Hourglass } from "lucide-react";
import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { savePacingAction } from "@/modules/crm/actions/channels";
import type { WhatsAppQueueStats } from "@/modules/crm/pacing";

/** Resumo da fila do WhatsApp (vale para qualquer forma de conexão) */
export function WhatsAppQueue({ q, paced }: { q: WhatsAppQueueStats; paced: boolean }) {
  return (
    <section aria-label="Fila do WhatsApp" className="space-y-2 rounded-xl bg-fog px-3 py-3 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Hourglass className="size-4 text-ink-soft" aria-hidden />
        {q.queued === 0 ? "Nenhuma mensagem aguardando" : `${q.queued} ${q.queued === 1 ? "mensagem aguardando" : "mensagens aguardando"}`}
      </p>
      <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 text-ink-soft sm:grid-cols-2">
        {paced ? (
          <>
            <div>
              <dt className="inline">Automáticas na fila: </dt>
              <dd className="inline font-semibold text-ink" data-testid="fila-automaticas">
                {q.queuedAutomatic}
              </dd>
            </div>
            <div>
              <dt className="inline">Saíram na última hora: </dt>
              <dd className="inline font-semibold text-ink tabular" data-testid="enviadas-hora">
                {q.sentLastHour} de {q.config.perHour}
              </dd>
            </div>
            {q.queuedAutomatic ? (
              <div className="sm:col-span-2">
                <dt className="inline">Previsão para a fila sair: </dt>
                <dd className="inline font-semibold text-ink">{formatDrain(q.etaMinutes)}</dd>
                {q.blocked && q.blocked !== "intervalo" ? <span className="text-erp-ink"> ({PACING_BLOCK_LABEL[q.blocked]})</span> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      {q.staleLastDay ? (
        <p role="status" className="text-alert">
          {q.staleLastDay} {q.staleLastDay === 1 ? "mensagem automática não foi enviada" : "mensagens automáticas não foram enviadas"} nas últimas 24 h por terem vencido na fila (ex.: lembrete de consulta que já começou).
        </p>
      ) : null}
    </section>
  );
}

/** Escolha do ritmo das mensagens automáticas (WhatsApp do celular) */
export function PacingForm({ config }: { config: WhatsAppQueueStats["config"] }) {
  const [state, action] = useActionState(savePacingAction, {});
  const [choice, setChoice] = useState<PacingChoice>(config.preset);
  const custom: PacingLimits = config.preset === "personalizado" ? config : PACING_PRESETS.cauteloso;
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4 text-ink-soft" aria-hidden /> Ritmo das mensagens automáticas
        </legend>
        <p className="text-sm text-ink-soft">
          Confirmações, lembretes, retornos e regras saem espaçados, como uma pessoa mandaria. As respostas que a equipe digita saem na hora, mas contam no limite.
        </p>
        {[...PACING_PRESET_IDS, "personalizado" as const].map((id) => {
          const p = id === "personalizado" ? null : PACING_PRESETS[id];
          return (
            <label
              key={id}
              className={cn("flex min-h-11 cursor-pointer items-start gap-2 rounded-xl px-3 py-2 ring-1", choice === id ? "bg-crm-tint ring-crm" : "bg-paper ring-line hover:ring-ink/30")}
            >
              <input type="radio" name="preset" value={id} checked={choice === id} onChange={() => setChoice(id)} className="mt-1 accent-crm" />
              <span className="min-w-0 text-sm">
                <span className="font-semibold">{p ? p.label : "Personalizado"}</span>
                <span className="block text-ink-soft">{p ? p.description : "Defina você o intervalo e os limites."}</span>
                {p ? (
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
                    {pacingTraits(p).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>
      {choice === "personalizado" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Intervalo mínimo (s)" name="minGapS" id="pace-min" type="number" inputMode="numeric" min={PACING_BOUNDS.minGapS.min} max={PACING_BOUNDS.minGapS.max} defaultValue={custom.minGapS} />
          <Field label="Intervalo máximo (s)" name="maxGapS" id="pace-max" type="number" inputMode="numeric" min={PACING_BOUNDS.maxGapS.min} max={PACING_BOUNDS.maxGapS.max} defaultValue={custom.maxGapS} />
          <Field label="Por minuto" name="perMinute" id="pace-minute" type="number" inputMode="numeric" min={PACING_BOUNDS.perMinute.min} max={PACING_BOUNDS.perMinute.max} defaultValue={custom.perMinute} />
          <Field label="Por hora" name="perHour" id="pace-hour" type="number" inputMode="numeric" min={PACING_BOUNDS.perHour.min} max={PACING_BOUNDS.perHour.max} defaultValue={custom.perHour} />
        </div>
      ) : null}
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Salvando...">
        Salvar ritmo
      </SubmitButton>
    </form>
  );
}
