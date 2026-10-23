"use client";

import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_TRANSITIONS, ATTENDANCE_TOLERANCE_MIN, RISK_LABEL, type AppointmentStatus, type NoShowRisk } from "@ecosaude/core/crm";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Dialog, FormMessage, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { useNow } from "@/lib/hooks";
import { ActionButton } from "@/components/crm/widgets";
import { changeAppointmentStatusAction, finishAppointmentAction, requestConfirmationsAction } from "@/modules/crm/actions/agenda";
import { StartEncounterButton } from "@/components/pep/widgets";
import { OfferPanel } from "./OfferPanel";
import { DetailsForm } from "./DetailsForm";
import { RescheduleForm } from "./RescheduleForm";

/**
 * Detalhe da consulta: mudar status em um toque, pedir confirmação,
 * ver o risco de falta explicado. Ao cancelar, já oferece o horário à lista de espera.
 */
export interface AppointmentView {
  id: string;
  version: number;
  status: AppointmentStatus;
  contactId: string;
  contactName: string;
  professionalId: string;
  professionalName: string;
  startsAt: string;
  endsAt: string;
  when: string;
  service: string | null;
  notes: string | null;
  confirmationRequested: boolean;
  /** Chegada e saída ("14:05"), para a duração real */
  arrivedAt?: string | null;
  finishedAt?: string | null;
  realMinutes?: number | null;
  risk: (NoShowRisk & { source?: "modelo" | "regras" }) | null;
  future: boolean;
  /** Onde: unidade (só se a clínica tem mais de uma) e consultório */
  unitId?: string | null;
  unitName?: string | null;
  roomId?: string | null;
  roomName?: string | null;
}

/** "Unidade Centro, Consultório 2" (o que existir) */
export function placeLabel(a: Pick<AppointmentView, "unitName" | "roomName">): string {
  return [a.unitName, a.roomName].filter(Boolean).join(", ");
}

/** Horário liberado (cancelamento ou remarcação), pronto para a lista de espera. */
type Freed = { professionalId: string; startsAt: string; endsAt: string; appointmentId: string; label: string };

const actionLabel: Record<AppointmentStatus, string> = {
  agendado: "Voltar para agendado", // (a partir de "cancelado" o texto vira "Desfazer cancelamento")
  confirmado: "Confirmar",
  compareceu: "Chegou / atendido",
  faltou: "Faltou",
  cancelado: "Cancelar",
};

export function AppointmentDialog({
  appt,
  onClose,
  canEdit,
  pep = false,
  rooms = [],
  features,
  professionals,
  today,
}: {
  appt: AppointmentView | null;
  onClose: () => void;
  canEdit: boolean;
  /** Prontuário: botão "Iniciar atendimento" (abre o atendimento ligado a esta consulta) */
  pep?: boolean;
  /** Consultórios ativos (para trocar o consultório em "Editar detalhes") */
  rooms?: { id: string; unitId: string; name: string }[];
  features: { confirmations: boolean; waitlist: boolean; cancel?: boolean };
  /** Profissionais ativos (para remarcar com outro) */
  professionals: { id: string; name: string }[];
  /** Hoje no fuso da clínica (AAAA-MM-DD) */
  today: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState(changeAppointmentStatusAction, {});
  const [cancelling, setCancelling] = useState(false);
  const [lastState, setLastState] = useState(state);
  const [rescheduling, setRescheduling] = useState(false);
  const [editing, setEditing] = useState(false);
  // Relógio para liberar "Chegou/Faltou" perto do horário (atualiza a cada minuto)
  const nowMs = useNow(60_000);
  const [notice, setNotice] = useState<string | null>(null);
  const [freed, setFreed] = useState<Freed | null>(null);

  // Resultado da ação (ajuste de estado durante a renderização)
  if (state !== lastState) {
    setLastState(state);
    if (state.ok) {
      setCancelling(false);
      const f = (state.data as { freed?: Omit<Freed, "label"> } | undefined)?.freed;
      if (f && appt) setFreed({ ...f, label: `Horário de ${appt.when} com ${appt.professionalName} ficou livre` });
    }
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  // Trocou de consulta: limpa estados
  const [lastId, setLastId] = useState(appt?.id);
  if (appt?.id !== lastId) {
    setLastId(appt?.id);
    setCancelling(false);
    setRescheduling(false);
    setEditing(false);
    setNotice(null);
    setFreed(null);
  }

  if (!appt) return null;
  // "Chegou"/"Faltou" só perto do horário; "Desfazer cancelamento" só se a consulta ainda não passou
  const startsMs = new Date(appt.startsAt).getTime();
  const attendanceOpen = startsMs - ATTENDANCE_TOLERANCE_MIN * 60_000 <= nowMs;
  const transitions = APPOINTMENT_TRANSITIONS[appt.status].filter(
    (s) => s !== "cancelado" && (appt.future || s !== "confirmado") && ((s !== "compareceu" && s !== "faltou") || attendanceOpen) && !(appt.status === "cancelado" && !appt.future),
  );
  const durationNow = Math.round((new Date(appt.endsAt).getTime() - startsMs) / 60_000);

  return (
    <Dialog open={!!appt} onClose={onClose} title={appt.contactName} description={`${appt.when}, ${appt.professionalName}${appt.service ? `, ${appt.service}` : ""}${placeLabel(appt) ? `. ${placeLabel(appt)}` : ""}`}>
      <div className="space-y-4">
        <p>
          Situação: <strong>{APPOINTMENT_STATUS_LABEL[appt.status]}</strong>
          {appt.confirmationRequested && appt.status === "agendado" ? <span className="text-sm text-ink-soft"> (confirmação pedida, aguardando resposta)</span> : null}
        </p>

        {appt.risk ? (
          <div className={cn("rounded-xl p-3 text-sm", appt.risk.level === "alto" ? "bg-alert-tint" : appt.risk.level === "medio" ? "bg-erp-tint" : "bg-ok-tint")}>
            <p className="font-bold">
              {RISK_LABEL[appt.risk.level]} de falta ({appt.risk.score}%)
            </p>
            <p>{appt.risk.reasons.join(". ")}.</p>
            {appt.risk.source === "modelo" ? <p className="mt-1 text-xs opacity-80">Calculado com o histórico desta clínica.</p> : null}
            {appt.risk.suggestion ? <p className="mt-1 font-semibold">{appt.risk.suggestion}</p> : null}
          </div>
        ) : null}
        {appt.notes ? <p className="rounded-xl bg-fog p-3 text-sm">{appt.notes}</p> : null}

        {/* Chegada e saída: medem a duração real (Ajustes > Duração das consultas) */}
        {appt.status === "compareceu" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-fog p-3 text-sm">
            <p>
              {appt.arrivedAt ? (
                <>
                  Chegou às <strong>{appt.arrivedAt}</strong>
                </>
              ) : (
                "Chegada registrada"
              )}
              {appt.finishedAt ? (
                <>
                  {" "}
                  e saiu às <strong>{appt.finishedAt}</strong>
                  {appt.realMinutes !== null && appt.realMinutes !== undefined ? ` (${appt.realMinutes} min de atendimento)` : ""}
                </>
              ) : null}
              .
            </p>
            {canEdit && !appt.finishedAt ? <ActionButton action={finishAppointmentAction} fields={{ id: appt.id }} label="Finalizar atendimento" pendingText="..." variant="secondary" /> : null}
          </div>
        ) : null}

        {/* Prontuário: o profissional começa o atendimento direto da consulta (marca a chegada se faltar) */}
        {pep && attendanceOpen && appt.status !== "cancelado" && appt.status !== "faltou" ? (
          <div className="rounded-xl bg-pep-tint p-3">
            <StartEncounterButton contactId={appt.contactId} appointmentId={appt.id} label="Abrir atendimento no prontuário" />
          </div>
        ) : null}

        <FormMessage state={state} />
        {notice ? (
          <p role="status" className="rounded-xl bg-ok-tint px-3 py-2 text-sm font-semibold text-ok-ink">
            {notice}
          </p>
        ) : null}

        {canEdit && !freed ? (
          <>
            <div className="flex flex-wrap gap-2">
              {transitions.map((s) => (
                <form key={s} action={action}>
                  <input type="hidden" name="id" value={appt.id} />
                  <input type="hidden" name="version" value={appt.version} />
                  <input type="hidden" name="status" value={s} />
                  <SubmitButton variant={s === "compareceu" || s === "confirmado" ? "primary" : "secondary"} pendingText="...">
                    {appt.status === "cancelado" && s === "agendado" ? "Desfazer cancelamento" : actionLabel[s]}
                  </SubmitButton>
                </form>
              ))}
              <button
                type="button"
                onClick={() => {
                  setEditing((v) => !v);
                  setRescheduling(false);
                  setCancelling(false);
                }}
                aria-expanded={editing}
                className={buttonStyles("ghost")}
              >
                Editar detalhes
              </button>
              {appt.status === "agendado" || appt.status === "confirmado" ? (
                <button
                  type="button"
                  onClick={() => {
                    setRescheduling((v) => !v);
                    setCancelling(false);
                  }}
                  aria-expanded={rescheduling}
                  className={buttonStyles("secondary")}
                >
                  Remarcar
                </button>
              ) : null}
              {APPOINTMENT_TRANSITIONS[appt.status].includes("cancelado") && features.cancel !== false ? (
                <button
                  type="button"
                  onClick={() => {
                    setCancelling((v) => !v);
                    setRescheduling(false);
                  }}
                  className={buttonStyles("danger")}
                >
                  Cancelar consulta
                </button>
              ) : null}
            </div>

            {!attendanceOpen && (appt.status === "agendado" || appt.status === "confirmado") ? (
              <p className="text-xs text-ink-soft">“Chegou” e “Faltou” aparecem a partir de {ATTENDANCE_TOLERANCE_MIN} min antes do horário.</p>
            ) : null}

            {editing ? (
              <DetailsForm
                appt={{ id: appt.id, version: appt.version, service: appt.service, notes: appt.notes, duration: durationNow, roomId: appt.roomId ?? null }}
                rooms={rooms.filter((r) => r.unitId === appt.unitId)}
                canChangeDuration={appt.status === "agendado" || appt.status === "confirmado"}
                onDone={() => {
                  setEditing(false);
                  router.refresh();
                }}
              />
            ) : null}

            {rescheduling ? (
              <RescheduleForm
                appt={{ id: appt.id, version: appt.version, professionalId: appt.professionalId, startsAt: appt.startsAt }}
                professionals={professionals}
                today={today}
                onDone={(st) => {
                  setRescheduling(false);
                  const f = (st.data as { freed?: Omit<Freed, "label"> } | undefined)?.freed;
                  if (f) setFreed({ ...f, label: `Horário anterior (${appt.when} com ${appt.professionalName}) ficou livre` });
                  setNotice(st.message ?? null);
                  router.refresh();
                }}
              />
            ) : null}

            {cancelling ? (
              <form action={action} className="space-y-3 rounded-xl bg-alert-tint/60 p-3">
                <input type="hidden" name="id" value={appt.id} />
                <input type="hidden" name="version" value={appt.version} />
                <input type="hidden" name="status" value="cancelado" />
                <TextareaField label="Motivo do cancelamento" name="reason" id="cancel-reason" error={state.errors?.reason} placeholder="Ex.: paciente pediu para remarcar" />
                <SubmitButton variant="danger" pendingText="Cancelando...">
                  Confirmar cancelamento
                </SubmitButton>
              </form>
            ) : null}

            {appt.status === "agendado" && appt.future && !appt.confirmationRequested && features.confirmations ? <ConfirmButton id={appt.id} /> : null}
          </>
        ) : null}

        {freed && features.waitlist ? <OfferPanel slot={freed} title="Ofereça o horário liberado" /> : null}

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              emit("eco:open-patient", appt.contactId);
            }}
            className={buttonStyles("ghost")}
          >
            Ver paciente
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                emit("eco:open-schedule", { contactId: appt.contactId, contactName: appt.contactName, professionalId: appt.professionalId, service: appt.service ?? undefined });
              }}
              className={buttonStyles("ghost")}
            >
              Agendar outra para este paciente
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function ConfirmButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, action] = useActionState(requestConfirmationsAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="appointmentId" value={id} />
      <FormMessage state={state} />
      {!state.ok ? (
        <SubmitButton variant="secondary" pendingText="Enviando...">
          Pedir confirmação ao paciente
        </SubmitButton>
      ) : null}
    </form>
  );
}
