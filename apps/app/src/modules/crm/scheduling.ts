import "server-only";
import {
  addDaysIso,
  APPOINTMENT_STATUS_LABEL,
  AUTO_CONFIRM_LAST_HOUR,
  APPOINTMENT_TRANSITIONS,
  ATTENDANCE_TOLERANCE_MIN,
  dayMinutes,
  describePeriods,
  fitsDay,
  weeklyOf,
  CRM_FEATURES,
  fillTemplate,
  matchesPeriod,
  WAITLIST_OFFER_SIZE,
  dayRangeUtc,
  todayIso,
  utcToZoned,
  scoreCandidate,
  type AppointmentStatus,
  type CandidateFacts,
  type CandidateScore,
  type LogisticModel,
} from "@ecosaude/core/crm";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, schema, sql, type Tx } from "@ecosaude/db";
import { UserError } from "@/lib/server";
import { logEvent, onAttended, onScheduled, onUnscheduled, setStage } from "./journey";
import { automationSettings, sendAutomated } from "./automation-settings";
import { bestChannel, ensureConversation, queueOutbound, templateVars } from "./messaging";
import { renderTemplate, templateText } from "./templates";
import type { CrmScope } from "./scope";
import { activeModel } from "./ml/models";
import { freeRoomsAt, mainUnit, placeFor, placeVars } from "./units";
import { loadClosures } from "./opening";
import { BOOKABLE_ROOM_KINDS, closureOn, unitAt } from "@ecosaude/core/crm";

/**
 * Regras da agenda: marcar, mudar status, pedir confirmação, oferecer
 * horário liberado à lista de espera. O conflito de horário é garantido
 * pelo banco (restrição de exclusão); aqui ficam as regras de negócio.
 */

const MIN = 60_000;

/* ------------------------- Avisos e ofertas sobrepostas --------------------- */

/**
 * Aviso que NÃO impede a marcação, mas exige confirmação ("marcar mesmo assim"):
 * horário fora do expediente/intervalo, ou paciente já com consulta no mesmo horário.
 */
export class ScheduleWarning extends UserError {}

export async function scheduleWarnings(
  tx: Tx,
  input: {
    pro: typeof schema.professionals.$inferSelect;
    contactId: string;
    startsAt: Date;
    endsAt: Date;
    excludeAppointmentId?: string;
  },
): Promise<string[]> {
  const out: string[] = [];
  const z = utcToZoned(input.startsAt);
  const start = z.minutes;
  const end = start + Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / MIN);
  const p = input.pro;
  // Ausência (férias, folga) tem prioridade sobre o horário da semana
  const [absent] = await tx
    .select({ reason: schema.professionalAbsences.reason })
    .from(schema.professionalAbsences)
    .where(and(eq(schema.professionalAbsences.professionalId, p.id), lte(schema.professionalAbsences.startsOn, z.date), gte(schema.professionalAbsences.endsOn, z.date)))
    .limit(1);
  const day = dayMinutes(weeklyOf(p), z.weekday, p.slotMinutes);
  const fit = fitsDay(day, start, end);
  // Feriado ou fechamento da unidade onde a consulta aconteceria (ou da clínica inteira)
  const main = await mainUnit(tx);
  const unitId = unitAt(weeklyOf(p), z.weekday, start, end, main.id);
  const closure = closureOn(await loadClosures(tx, z.date, z.date), unitId, z.date);
  if (closure) out.push(`${closure.unitId ? "a unidade" : "a clínica"} está fechada neste dia (${closure.reason})`);
  if (absent) out.push(`o profissional está ausente neste dia${absent.reason ? ` (${absent.reason})` : ""}`);
  else if (!fit.ok && fit.reason === "dia") out.push("o profissional não atende neste dia da semana");
  else if (!fit.ok && fit.reason === "fora") out.push(`fora do expediente (${describePeriods(day!)})`);
  else if (!fit.ok) out.push(`no intervalo (atende ${describePeriods(day!)})`);

  // O mesmo paciente com outra consulta (qualquer profissional) no mesmo horário
  const [clash] = await tx
    .select({ startsAt: schema.appointments.startsAt, pro: schema.professionals.name })
    .from(schema.appointments)
    .innerJoin(schema.professionals, eq(schema.professionals.id, schema.appointments.professionalId))
    .where(
      and(
        eq(schema.appointments.contactId, input.contactId),
        inArray(schema.appointments.status, ["agendado", "confirmado"]),
        lt(schema.appointments.startsAt, input.endsAt),
        gt(schema.appointments.endsAt, input.startsAt),
        input.excludeAppointmentId ? ne(schema.appointments.id, input.excludeAppointmentId) : undefined,
      ),
    )
    .limit(1);
  if (clash) out.push(`o paciente já tem consulta às ${utcToZoned(clash.startsAt).time} com ${clash.pro}`);
  return out;
}

/**
 * Um horário foi ocupado (marcação, remarcação, desfazer cancelamento):
 * ofertas abertas da lista de espera para esse horário são canceladas e os
 * pacientes voltam para a fila (sem perder o lugar).
 */
export async function closeOverlappingOffers(tx: Tx, professionalId: string, startsAt: Date, endsAt: Date) {
  const closed = await tx
    .update(schema.slotOffers)
    .set({ status: "cancelada" })
    .where(and(eq(schema.slotOffers.professionalId, professionalId), eq(schema.slotOffers.status, "aberta"), lt(schema.slotOffers.startsAt, endsAt), gt(schema.slotOffers.endsAt, startsAt)))
    .returning({ id: schema.slotOffers.id });
  if (closed.length)
    await releaseOfferCandidates(
      tx,
      closed.map((c) => c.id),
    );
  return closed.length;
}

/** Devolve para "aguardando" quem estava com oferta pendente nestas ofertas. */
export async function releaseOfferCandidates(tx: Tx, offerIds: string[]) {
  if (offerIds.length === 0) return;
  await tx.execute(sql`
    update waitlist_entries w set status = 'aguardando'
      from slot_offer_candidates c
     where c.waitlist_entry_id = w.id and w.status = 'oferecido'
       and c.offer_id in (${sql.join(
         offerIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})`);
}

/* -------------------------------- Marcação --------------------------------- */

export async function createAppointment(
  tx: Tx,
  scope: CrmScope,
  input: {
    contactId: string;
    professionalId: string;
    startsAt: Date;
    service?: string;
    notes?: string;
    source: "recepcao" | "conversa" | "lista_espera";
    notifyConversationId?: string;
    /** Duração própria (padrão = do profissional) */
    durationMinutes?: number;
    /** Marcar mesmo com aviso (fora do expediente, paciente com outra consulta) */
    force?: boolean;
  },
) {
  const pro = await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, input.professionalId) });
  if (!pro?.active) throw new UserError("Profissional não encontrado.");
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, input.contactId) });
  if (!contact) throw new UserError("Paciente não encontrado.");
  if (input.startsAt.getTime() < Date.now() - 5 * MIN) throw new UserError("Esse horário já passou.");

  const endsAt = new Date(input.startsAt.getTime() + (input.durationMinutes ?? pro.slotMinutes) * MIN);
  // Unidade e consultório: do período da semana do profissional (ou um consultório livre)
  const place = await placeFor(tx, pro, input.startsAt, endsAt);
  if (!input.force) {
    const warnings = await scheduleWarnings(tx, { pro, contactId: contact.id, startsAt: input.startsAt, endsAt });
    // Unidade com consultórios e todos ocupados nesse horário: a consulta ficaria sem sala
    if (!place.roomId && (await freeRoomsAt(tx, place.unitId, input.startsAt, endsAt)).some((r) => BOOKABLE_ROOM_KINDS.includes(r.kind)))
      warnings.push("todos os consultórios da unidade estão ocupados nesse horário (a consulta fica sem consultório definido)");
    if (warnings.length) throw new ScheduleWarning(`Atenção: ${warnings.join("; ")}. Confirme para marcar mesmo assim.`);
  }
  // Se o horário (do profissional ou do consultório) estiver ocupado, o banco recusa (23P01)
  const [appt] = await tx
    .insert(schema.appointments)
    .values({
      contactId: contact.id,
      professionalId: pro.id,
      unitId: place.unitId,
      roomId: place.roomId,
      startsAt: input.startsAt,
      endsAt,
      service: input.service ?? null,
      notes: input.notes ?? null,
      source: input.source,
      createdBy: scope.actorId,
    })
    .returning();

  await onScheduled(tx, contact.id, scope.actorId);
  // Horário que estava sendo oferecido à lista de espera deixa de estar livre
  await closeOverlappingOffers(tx, pro.id, input.startsAt, endsAt);
  // Quem estava na lista de espera e conseguiu horário sai dela
  await tx
    .update(schema.waitlistEntries)
    .set({ status: "agendado", resolvedAt: new Date() })
    .where(and(eq(schema.waitlistEntries.contactId, contact.id), inArray(schema.waitlistEntries.status, ["aguardando", "oferecido"])));
  await logEvent(tx, {
    contactId: contact.id,
    actorId: scope.actorId,
    type: "appointment_created",
    data: { appointmentId: appt!.id, startsAt: input.startsAt.toISOString(), profissional: pro.name, origem: input.source },
  });

  if (input.notifyConversationId) {
    const conv = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, input.notifyConversationId) });
    if (conv && conv.contactId === contact.id) {
      const body = await renderTemplate(tx, "agendamento", templateVars(contact, scope.clinicName, { startsAt: input.startsAt, professionalName: pro.name }, await placeVars(tx, place.unitId, place.roomId)));
      if (body) await queueOutbound(tx, { conversation: conv, body, authorId: scope.actorId, templateKey: "agendamento", meta: { appointmentId: appt!.id } });
    }
  }
  return appt!;
}

/* ------------------------------ Mudança de status -------------------------- */

export interface FreedSlot {
  professionalId: string;
  startsAt: string;
  endsAt: string;
  appointmentId: string;
}

export async function changeAppointmentStatus(
  tx: Tx,
  scope: CrmScope,
  input: { id: string; status: AppointmentStatus; reason?: string; version: number },
): Promise<{ freed: FreedSlot | null; npsQueued: boolean }> {
  const appt = await tx.query.appointments.findFirst({
    where: eq(schema.appointments.id, input.id),
    with: { contact: true, professional: true },
  });
  if (!appt) throw new UserError("Consulta não encontrada.");
  if (!APPOINTMENT_TRANSITIONS[appt.status].includes(input.status)) {
    throw new UserError(`Não é possível mudar de "${APPOINTMENT_STATUS_LABEL[appt.status]}" para "${APPOINTMENT_STATUS_LABEL[input.status]}".`);
  }
  if (input.status === "cancelado" && !input.reason) throw new UserError("Informe o motivo do cancelamento.");

  const now = new Date();
  // "Chegou" e "Faltou" só a partir de pouco antes do horário (evita toque errado em consulta futura)
  if ((input.status === "compareceu" || input.status === "faltou") && appt.startsAt.getTime() - ATTENDANCE_TOLERANCE_MIN * MIN > now.getTime()) {
    throw new UserError(`Só dá para marcar "${APPOINTMENT_STATUS_LABEL[input.status]}" a partir de ${ATTENDANCE_TOLERANCE_MIN} minutos antes da consulta.`);
  }
  // Desfazer cancelamento: só para consulta futura (o banco recusa se o horário já foi ocupado)
  if (appt.status === "cancelado" && input.status === "agendado" && appt.startsAt <= now) {
    throw new UserError("Esta consulta já passou: marque uma nova em vez de desfazer o cancelamento.");
  }
  // Controle de edição simultânea: só grava se ninguém mudou a consulta desde que a tela carregou
  const updated = await tx
    .update(schema.appointments)
    .set({
      status: input.status,
      version: sql`${schema.appointments.version} + 1`,
      confirmedAt: input.status === "confirmado" ? now : input.status === "agendado" ? null : appt.confirmedAt,
      cancelledAt: input.status === "cancelado" ? now : null,
      cancelReason: input.status === "cancelado" ? (input.reason ?? null) : null,
      // "Chegou" registra a chegada (duração real); desfazer limpa chegada e saída
      arrivedAt: input.status === "compareceu" ? now : null,
      finishedAt: input.status === "compareceu" ? appt.finishedAt : null,
    })
    .where(and(eq(schema.appointments.id, appt.id), eq(schema.appointments.version, input.version)))
    .returning({ id: schema.appointments.id });
  if (updated.length === 0) {
    throw new UserError("Esta consulta foi alterada por outra pessoa enquanto você olhava. Atualize a página e tente de novo.");
  }

  await logEvent(tx, {
    contactId: appt.contactId,
    actorId: scope.actorId,
    type: "appointment_status",
    data: { appointmentId: appt.id, de: appt.status, para: input.status, motivo: input.reason ?? null, startsAt: appt.startsAt.toISOString() },
  });

  let freed: FreedSlot | null = null;
  let npsQueued = false;

  // Desfazer cancelamento: volta a ocupar o horário
  if (appt.status === "cancelado" && input.status === "agendado") {
    await closeOverlappingOffers(tx, appt.professionalId, appt.startsAt, appt.endsAt);
    await onScheduled(tx, appt.contactId, scope.actorId);
  }

  // Desfazer "compareceu": a última visita e a etapa voltam a refletir só o que de fato aconteceu
  if (appt.status === "compareceu" && input.status !== "compareceu") {
    const [last] = await tx
      .select({ at: sql<Date | null>`max(${schema.appointments.startsAt})` })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.contactId, appt.contactId), eq(schema.appointments.status, "compareceu")));
    const lastVisit = last?.at ? new Date(last.at) : null;
    await tx.update(schema.contacts).set({ lastVisitAt: lastVisit }).where(eq(schema.contacts.id, appt.contactId));
    if (!lastVisit && appt.contact.stage === "paciente") await setStage(tx, appt.contactId, "agendado", { actorId: scope.actorId, auto: true });
  }

  const auto = await automationSettings(tx);
  const vars = templateVars(appt.contact, scope.clinicName, { startsAt: appt.startsAt, professionalName: appt.professional.name }, await placeVars(tx, appt.unitId, appt.roomId));

  // Faltou: sai de "Agendado" (se não tiver outra marcada) e vira tarefa de remarcar (automação "Falta vira tarefa")
  if (input.status === "faltou") {
    await onUnscheduled(tx, appt.contactId, scope.actorId);
    if (auto.falta?.enabled) {
      await tx.insert(schema.tasks).values({
        contactId: appt.contactId,
        title: `Remarcar: faltou à consulta com ${appt.professional.name}`,
        dueDate: todayIso(now),
        assigneeId: scope.actorId,
        createdBy: scope.actorId,
        kind: "falta",
      });
      if (auto.falta.enviarMensagem && (await sendAutomated(tx, { contactId: appt.contactId, key: "falta", vars, meta: { appointmentId: appt.id } }))) {
        await logEvent(tx, { contactId: appt.contactId, type: "no_show_followup", data: { appointmentId: appt.id } });
      }
    }
  }

  if (input.status === "compareceu") {
    await onAttended(tx, appt.contactId, appt.startsAt, scope.actorId);
    // Pesquisa de satisfação: só com a funcionalidade no plano e sem pedido de descadastro
    if (scope.has(CRM_FEATURES.nps) && auto.nps?.enabled && !appt.contact.optedOutAt && !appt.npsRequestedAt) {
      if (await sendAutomated(tx, { contactId: appt.contactId, key: "nps", vars, meta: { kind: "nps", appointmentId: appt.id } })) {
        await tx.update(schema.appointments).set({ npsRequestedAt: now }).where(eq(schema.appointments.id, appt.id));
        npsQueued = true;
      }
    }
  }

  if (input.status === "cancelado") {
    await onUnscheduled(tx, appt.contactId, scope.actorId);
    // Automação "Avisar cancelamento": só para consulta futura cancelada pela equipe
    if (auto.cancelamento_aviso?.enabled && appt.startsAt > now && scope.actorId) {
      if (await sendAutomated(tx, { contactId: appt.contactId, key: "cancelamento", vars, meta: { appointmentId: appt.id } })) {
        await logEvent(tx, { contactId: appt.contactId, type: "cancel_notice", data: { appointmentId: appt.id } });
      }
    }
    if (appt.startsAt > now) {
      freed = { professionalId: appt.professionalId, startsAt: appt.startsAt.toISOString(), endsAt: appt.endsAt.toISOString(), appointmentId: appt.id };
    }
  }
  return { freed, npsQueued };
}

/* -------------------------------- Remarcação -------------------------------- */

/**
 * REMARCAR: muda dia/horário (e, se quiser, o profissional) da MESMA consulta.
 * Diferente de cancelar e marcar outra: o histórico mostra "remarcada", não
 * conta como cancelamento e não perde a origem da marcação.
 *
 * - Volta para "agendado" e zera a confirmação (o novo horário precisa ser confirmado).
 * - Conflito de horário: o banco recusa (mesma restrição da marcação).
 * - O horário antigo, se ainda for futuro, volta como "liberado" para a lista de espera.
 */
export async function rescheduleAppointment(
  tx: Tx,
  scope: CrmScope,
  input: { id: string; version: number; professionalId: string; startsAt: Date; notify: boolean; durationMinutes?: number; force?: boolean },
): Promise<{ freed: FreedSlot | null; notified: boolean; notifySkipped: string | null }> {
  const appt = await tx.query.appointments.findFirst({
    where: eq(schema.appointments.id, input.id),
    with: { contact: true, professional: true },
  });
  if (!appt) throw new UserError("Consulta não encontrada.");
  if (appt.status !== "agendado" && appt.status !== "confirmado") {
    throw new UserError(`Só dá para remarcar consulta agendada ou confirmada (esta está "${APPOINTMENT_STATUS_LABEL[appt.status].toLowerCase()}").`);
  }
  if (input.startsAt.getTime() < Date.now()) throw new UserError("Escolha um horário no futuro.");
  if (input.startsAt.getTime() === appt.startsAt.getTime() && input.professionalId === appt.professionalId) {
    throw new UserError("É o mesmo horário de agora. Escolha outro.");
  }
  const pro = input.professionalId === appt.professionalId ? appt.professional : await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, input.professionalId) });
  if (!pro?.active) throw new UserError("Profissional não encontrado.");

  // Duração: a escolhida; senão a atual (mesmo profissional) ou a padrão do novo profissional
  const currentLength = Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / MIN);
  const length = input.durationMinutes ?? (pro.id === appt.professionalId ? currentLength : pro.slotMinutes);
  const endsAt = new Date(input.startsAt.getTime() + length * MIN);
  if (!input.force) {
    const warnings = await scheduleWarnings(tx, { pro, contactId: appt.contactId, startsAt: input.startsAt, endsAt, excludeAppointmentId: appt.id });
    if (warnings.length) throw new ScheduleWarning(`Atenção: ${warnings.join("; ")}. Confirme para remarcar mesmo assim.`);
  }
  const updated = await tx
    .update(schema.appointments)
    .set({
      professionalId: pro.id,
      // Novo horário pode ser em outra unidade (outro dia da semana) ou outro consultório
      ...(await placeFor(tx, pro, input.startsAt, endsAt, { excludeAppointmentId: appt.id })),
      startsAt: input.startsAt,
      endsAt,
      status: "agendado",
      confirmationRequestedAt: null,
      confirmedAt: null,
      version: sql`${schema.appointments.version} + 1`,
    })
    .where(and(eq(schema.appointments.id, appt.id), eq(schema.appointments.version, input.version)))
    .returning({ id: schema.appointments.id });
  if (updated.length === 0) {
    throw new UserError("Esta consulta foi alterada por outra pessoa enquanto você olhava. Atualize a página e tente de novo.");
  }

  await onScheduled(tx, appt.contactId, scope.actorId);
  await closeOverlappingOffers(tx, pro.id, input.startsAt, endsAt);
  await logEvent(tx, {
    contactId: appt.contactId,
    actorId: scope.actorId,
    type: "appointment_rescheduled",
    data: {
      appointmentId: appt.id,
      deStartsAt: appt.startsAt.toISOString(),
      startsAt: input.startsAt.toISOString(),
      profissional: pro.name,
      deProfissional: appt.professional.name,
    },
  });

  // Aviso ao paciente (respeita quem pediu SAIR)
  let notified = false;
  let notifySkipped: string | null = null;
  if (input.notify) {
    const channel = appt.contact.optedOutAt ? null : await bestChannel(tx, appt.contactId);
    if (!channel) {
      notifySkipped = appt.contact.optedOutAt ? "o paciente pediu para não receber mensagens" : "o paciente não tem canal de contato";
    } else {
      const conv = await ensureConversation(tx, appt.contactId, channel);
      // Local do NOVO horário (pode ter mudado de unidade ou de consultório)
      const [moved] = await tx.select({ unitId: schema.appointments.unitId, roomId: schema.appointments.roomId }).from(schema.appointments).where(eq(schema.appointments.id, appt.id));
      const body = fillTemplate((await templateText(tx, "remarcacao")) ?? "", templateVars(appt.contact, scope.clinicName, { startsAt: input.startsAt, professionalName: pro.name }, await placeVars(tx, moved?.unitId, moved?.roomId)));
      await queueOutbound(tx, { conversation: conv, body, authorId: scope.actorId, templateKey: "remarcacao", meta: { kind: "reschedule", appointmentId: appt.id } });
      notified = true;
    }
  }

  // O horário antigo só fica livre se o novo não ocupar parte dele (mesmo profissional, horários sobrepostos)
  const overlapsOld = pro.id === appt.professionalId && input.startsAt < appt.endsAt && appt.startsAt < endsAt;
  const freed =
    appt.startsAt > new Date() && !overlapsOld ? { professionalId: appt.professionalId, startsAt: appt.startsAt.toISOString(), endsAt: appt.endsAt.toISOString(), appointmentId: appt.id } : null;
  return { freed, notified, notifySkipped };
}

/* --------------------------- Corrigir detalhes ----------------------------- */

/** Corrige serviço, observações e duração de uma consulta já marcada. */
export async function updateAppointmentDetails(
  tx: Tx,
  scope: CrmScope,
  input: { id: string; version: number; service?: string; notes?: string; durationMinutes?: number; /** "" = sem consultório; undefined = não muda */ roomId?: string },
) {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.id) });
  if (!appt) throw new UserError("Consulta não encontrada.");
  const currentLength = Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / MIN);
  const lengthChanged = input.durationMinutes !== undefined && input.durationMinutes !== currentLength;
  if (lengthChanged && appt.status !== "agendado" && appt.status !== "confirmado") {
    throw new UserError("A duração só pode mudar em consulta agendada ou confirmada.");
  }
  const endsAt = lengthChanged ? new Date(appt.startsAt.getTime() + input.durationMinutes! * MIN) : appt.endsAt;
  if (input.roomId && input.roomId !== appt.roomId) {
    const rooms = await freeRoomsAt(tx, appt.unitId ?? (await mainUnit(tx)).id, appt.startsAt, endsAt, appt.id);
    const room = rooms.find((r) => r.id === input.roomId);
    if (!room) throw new UserError("Consultório não encontrado nesta unidade.");
    if (!room.free) throw new UserError(`${room.name} está ocupado nesse horário. Escolha outro.`);
  }
  const updated = await tx
    .update(schema.appointments)
    .set({
      service: input.service ?? null,
      notes: input.notes ?? null,
      endsAt,
      ...(input.roomId !== undefined ? { roomId: input.roomId || null } : {}),
      version: sql`${schema.appointments.version} + 1`,
    })
    .where(and(eq(schema.appointments.id, appt.id), eq(schema.appointments.version, input.version)))
    .returning({ id: schema.appointments.id });
  if (updated.length === 0) throw new UserError("Esta consulta foi alterada por outra pessoa. Atualize a página e tente de novo.");
  if (lengthChanged && endsAt > appt.endsAt) await closeOverlappingOffers(tx, appt.professionalId, appt.endsAt, endsAt);
  await logEvent(tx, {
    contactId: appt.contactId,
    actorId: scope.actorId,
    type: "appointment_updated",
    data: { appointmentId: appt.id, startsAt: appt.startsAt.toISOString(), servico: input.service ?? null, duracao: lengthChanged ? input.durationMinutes : null },
  });
}

/* ------------------------------ Confirmações ------------------------------- */

/**
 * Envia pedido de confirmação ("responda 1 para confirmar") para as consultas.
 * A resposta do paciente confirma a consulta sozinha (ver ingest.ts).
 */
export async function requestConfirmations(tx: Tx, scope: CrmScope, appointmentIds: string[], opts: { skipOptedOut?: boolean } = {}) {
  if (appointmentIds.length === 0) return { sent: 0, skipped: [] as string[] };
  const appts = await tx.query.appointments.findMany({
    where: and(
      inArray(schema.appointments.id, appointmentIds),
      eq(schema.appointments.status, "agendado"),
      isNull(schema.appointments.confirmationRequestedAt),
      gt(schema.appointments.startsAt, new Date()),
    ),
    with: { contact: true, professional: true },
  });
  const template = (await templateText(tx, "confirmacao")) ?? "";
  let sent = 0;
  const skipped: string[] = [];

  for (const a of appts) {
    // Envio automático respeita quem pediu SAIR; o manual fica a critério da recepção
    if (opts.skipOptedOut && a.contact.optedOutAt) {
      skipped.push(`${a.contact.name} (pediu SAIR)`);
      continue;
    }
    const channel = await bestChannel(tx, a.contactId);
    if (!channel) {
      skipped.push(`${a.contact.name} (sem canal de contato)`);
      continue;
    }
    const conv = await ensureConversation(tx, a.contactId, channel);
    const body = fillTemplate(template, templateVars(a.contact, scope.clinicName, { startsAt: a.startsAt, professionalName: a.professional.name }, await placeVars(tx, a.unitId, a.roomId)));
    await queueOutbound(tx, { conversation: conv, body, authorId: null, templateKey: "confirmacao", meta: { kind: "confirmation", appointmentId: a.id } });
    await tx.update(schema.appointments).set({ confirmationRequestedAt: new Date() }).where(eq(schema.appointments.id, a.id));
    await logEvent(tx, { contactId: a.contactId, actorId: scope.actorId, type: "confirmation_requested", data: { appointmentId: a.id } });
    sent++;
  }
  return { sent, skipped };
}

/* ------------------------- Confirmação automática --------------------------- */

/**
 * Chamada pela rotina agendada (a cada 10 min). A partir do horário escolhido
 * pela clínica, pede confirmação das consultas do dia-alvo que ainda não
 * receberam o pedido. Como o filtro é "ainda não pedido", rodar várias vezes
 * não repete mensagens, e consultas marcadas mais tarde no mesmo dia também
 * entram no envio seguinte. Depois das 20h não envia (ninguém quer mensagem
 * de clínica à noite); o que sobrar sai no dia seguinte só se ainda fizer sentido.
 */
export async function runAutoConfirmations(tx: Tx, scope: CrmScope, now = new Date()): Promise<{ sent: number; skipped: string[]; reason?: string }> {
  if (!scope.has(CRM_FEATURES.confirmations)) return { sent: 0, skipped: [], reason: "fora do plano" };
  const [cfg] = await tx.select().from(schema.crmSettings).limit(1);
  const settings = cfg ?? { autoConfirm: true, confirmHour: 10, confirmDaysBefore: 1 };
  if (!settings.autoConfirm) return { sent: 0, skipped: [], reason: "desligada" };

  const local = utcToZoned(now);
  const hour = Math.floor(local.minutes / 60);
  if (hour < settings.confirmHour || hour > AUTO_CONFIRM_LAST_HOUR) return { sent: 0, skipped: [], reason: "fora do horário" };

  const target = addDaysIso(local.date, settings.confirmDaysBefore);
  const { start, end } = dayRangeUtc(target);
  const pending = await tx
    .select({ id: schema.appointments.id })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.status, "agendado"), isNull(schema.appointments.confirmationRequestedAt), gte(schema.appointments.startsAt, start), lt(schema.appointments.startsAt, end)));
  const result = await requestConfirmations(
    tx,
    scope,
    pending.map((p) => p.id),
    { skipOptedOut: true },
  );
  // Marca o dia da última execução (exibido em Ajustes > Clínica)
  if (result.sent > 0) {
    await tx
      .insert(schema.crmSettings)
      .values({ ...settings, lastAutoConfirmOn: local.date })
      .onConflictDoUpdate({ target: schema.crmSettings.clinicId, set: { lastAutoConfirmOn: local.date } });
  }
  return result;
}

/* ------------------------------ Lista de espera ---------------------------- */

/**
 * Pacientes da lista de espera que combinam com o horário (profissional e período).
 *  - Encaixe inteligente DESLIGADO: ordem de chegada (como sempre).
 *  - LIGADO (Ajustes > Inteligência artificial): ordem pela CHANCE DE ACEITAR, com os
 *    motivos; ordem de chegada como desempate. Modelo aprendido se aprovado; senão
 *    pesos fixos (plano B). A escolha continua com a recepção.
 */
export async function waitlistCandidates(tx: Tx, slot: { professionalId: string; startsAt: Date }) {
  const entries = (
    await tx.query.waitlistEntries.findMany({
      where: and(eq(schema.waitlistEntries.status, "aguardando"), or(isNull(schema.waitlistEntries.professionalId), eq(schema.waitlistEntries.professionalId, slot.professionalId))),
      with: { contact: true, professional: true },
      orderBy: asc(schema.waitlistEntries.createdAt),
    })
  ).filter((e) => matchesPeriod(slot.startsAt, e.period) && !e.contact.optedOutAt);
  // Paciente que só aceita uma unidade: o horário precisa ser lá
  if (entries.some((e) => e.unitId)) {
    const pro = await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, slot.professionalId) });
    if (pro) {
      const { unitId } = await placeFor(tx, pro, slot.startsAt, new Date(slot.startsAt.getTime() + pro.slotMinutes * MIN));
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.unitId && entries[i]!.unitId !== unitId) entries.splice(i, 1);
    }
  }

  const cfg = (await automationSettings(tx)).ia_encaixe;
  if (!cfg?.enabled || entries.length === 0) return entries.map((e) => ({ ...e, fit: null as (CandidateScore & { facts: CandidateFacts }) | null }));

  const facts = await candidateFacts(tx, entries, slot);
  const learned = await activeModel<LogisticModel>(tx, "encaixe");
  return entries
    .map((e) => {
      const f = facts.get(e.id)!;
      return { ...e, fit: { ...scoreCandidate(f, learned), facts: f } };
    })
    .sort((a, b) => b.fit.score - a.fit.score || a.createdAt.getTime() - b.createdAt.getTime());
}

/** Fatores de cada paciente da lista NO MOMENTO (também guardados na oferta, para aprender depois). */
async function candidateFacts(tx: Tx, entries: { id: string; contactId: string; period: string; professionalId: string | null; createdAt: Date }[], slot: { professionalId: string; startsAt: Date }) {
  const ids = [...new Set(entries.map((e) => e.contactId))];
  const now = Date.now();
  const offers = await tx
    .select({ contactId: schema.slotOfferCandidates.contactId, outcome: schema.slotOfferCandidates.outcome, status: schema.slotOffers.status })
    .from(schema.slotOfferCandidates)
    .innerJoin(schema.slotOffers, eq(schema.slotOffers.id, schema.slotOfferCandidates.offerId))
    .where(inArray(schema.slotOfferCandidates.contactId, ids));
  const visits = await tx
    .select({ contactId: schema.appointments.contactId, status: schema.appointments.status, n: sql<number>`count(*)::int` })
    .from(schema.appointments)
    .where(and(inArray(schema.appointments.contactId, ids), inArray(schema.appointments.status, ["compareceu", "faltou"])))
    .groupBy(schema.appointments.contactId, schema.appointments.status);
  const active = await tx
    .select({ contactId: schema.conversations.contactId })
    .from(schema.conversations)
    .where(and(inArray(schema.conversations.contactId, ids), gt(schema.conversations.lastInboundAt, new Date(now - 24 * 3_600_000))));
  const slotPeriod = utcToZoned(slot.startsAt).minutes < 12 * 60 ? "manha" : "tarde";
  const out = new Map<string, CandidateFacts>();
  for (const e of entries) {
    const mine = offers.filter((o) => o.contactId === e.contactId);
    const came = visits.find((v) => v.contactId === e.contactId && v.status === "compareceu")?.n ?? 0;
    const missed = visits.find((v) => v.contactId === e.contactId && v.status === "faltou")?.n ?? 0;
    out.set(e.id, {
      periodExact: e.period === slotPeriod,
      professionalExact: e.professionalId === slot.professionalId,
      waitingDays: (now - e.createdAt.getTime()) / 86_400_000,
      offersAccepted: mine.filter((o) => o.outcome === "aceitou" || o.outcome === "atrasado").length,
      offersDeclined: mine.filter((o) => o.outcome === "recusou").length,
      // Sem resposta numa oferta já encerrada
      offersIgnored: mine.filter((o) => o.outcome === "enviada" && o.status !== "aberta").length,
      attendanceRate: came + missed ? came / (came + missed) : null,
      activeLast24h: active.some((a) => a.contactId === e.contactId),
      hoursUntilSlot: (slot.startsAt.getTime() - now) / 3_600_000,
    });
  }
  return out;
}

/**
 * Oferece um horário livre a até 3 pacientes da lista de espera, ao mesmo tempo.
 * Quem responder SIM primeiro fica com o horário (automático, em ingest.ts).
 */
export async function offerSlot(tx: Tx, scope: CrmScope, input: { professionalId: string; startsAt: Date; endsAt: Date; originAppointmentId?: string; entryIds: string[] }) {
  if (input.entryIds.length === 0) throw new UserError("Escolha pelo menos um paciente da lista.");
  if (input.entryIds.length > WAITLIST_OFFER_SIZE) throw new UserError(`Ofereça a no máximo ${WAITLIST_OFFER_SIZE} pacientes por vez.`);
  if (input.startsAt.getTime() < Date.now() + 20 * MIN) throw new UserError("Muito em cima da hora para oferecer: os pacientes não teriam tempo de responder e chegar.");

  // O horário precisa estar livre
  const [busy] = await tx
    .select({ id: schema.appointments.id })
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.professionalId, input.professionalId),
        ne(schema.appointments.status, "cancelado"),
        lt(schema.appointments.startsAt, input.endsAt),
        gt(schema.appointments.endsAt, input.startsAt),
      ),
    )
    .limit(1);
  if (busy) throw new UserError("Esse horário não está mais livre.");

  const pro = await tx.query.professionals.findFirst({ where: eq(schema.professionals.id, input.professionalId) });
  if (!pro) throw new UserError("Profissional não encontrado.");

  // A oferta vale até 30 min antes da consulta, no máximo 3 horas, e sempre pelo menos 10 min
  const expiresAt = new Date(Math.min(Math.max(Math.min(input.startsAt.getTime() - 30 * MIN, Date.now() + 3 * 60 * MIN), Date.now() + 10 * MIN), input.startsAt.getTime() - 5 * MIN));
  const [offer] = await tx
    .insert(schema.slotOffers)
    .values({
      professionalId: pro.id,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      originAppointmentId: input.originAppointmentId ?? null,
      expiresAt,
      createdBy: scope.actorId,
    })
    .returning();

  const entries = await tx.query.waitlistEntries.findMany({
    where: and(inArray(schema.waitlistEntries.id, input.entryIds), eq(schema.waitlistEntries.status, "aguardando")),
    with: { contact: true },
  });
  // Fatores e chance de aceitar NO MOMENTO da oferta (é o que permite aprender quem aceita)
  const facts = await candidateFacts(tx, entries, { professionalId: pro.id, startsAt: input.startsAt });
  const template = (await templateText(tx, "oferta")) ?? "";
  const offered: string[] = [];
  // Onde será o horário oferecido (o paciente precisa saber o endereço antes de aceitar)
  const offerPlace = await placeVars(tx, (await placeFor(tx, pro, input.startsAt, new Date(input.startsAt.getTime() + pro.slotMinutes * MIN))).unitId);

  for (const entry of entries) {
    const channel = await bestChannel(tx, entry.contactId);
    if (!channel) continue;
    const conv = await ensureConversation(tx, entry.contactId, channel);
    const body = fillTemplate(template, templateVars(entry.contact, scope.clinicName, { startsAt: input.startsAt, professionalName: pro.name }, offerPlace));
    await queueOutbound(tx, { conversation: conv, body, authorId: null, templateKey: "oferta", meta: { kind: "slot_offer", offerId: offer!.id } });
    const f = facts.get(entry.id);
    await tx.insert(schema.slotOfferCandidates).values({
      offerId: offer!.id,
      waitlistEntryId: entry.id,
      contactId: entry.contactId,
      features: f ? { ...f } : null,
      score: f ? scoreCandidate(f).score : null,
    });
    await tx.update(schema.waitlistEntries).set({ status: "oferecido" }).where(eq(schema.waitlistEntries.id, entry.id));
    await logEvent(tx, { contactId: entry.contactId, actorId: scope.actorId, type: "slot_offered", data: { offerId: offer!.id, startsAt: input.startsAt.toISOString(), profissional: pro.name } });
    offered.push(entry.contact.name);
  }
  if (offered.length === 0) throw new UserError("Nenhum paciente escolhido pode ser contatado (sem canal disponível).");
  return { offerId: offer!.id, offered };
}

/** Ofertas vencidas: encerra e devolve os pacientes para a fila de espera. */
export async function expireOffers(tx: Tx): Promise<number> {
  const expired = await tx
    .update(schema.slotOffers)
    .set({ status: "expirada" })
    .where(and(eq(schema.slotOffers.status, "aberta"), lt(schema.slotOffers.expiresAt, new Date())))
    .returning({ id: schema.slotOffers.id });
  await releaseOfferCandidates(
    tx,
    expired.map((e) => e.id),
  );
  return expired.length;
}

/** A recepção cancela uma oferta aberta (ex.: o horário foi usado para outra coisa). */
export async function cancelOffer(tx: Tx, scope: CrmScope, offerId: string) {
  const [offer] = await tx
    .update(schema.slotOffers)
    .set({ status: "cancelada" })
    .where(and(eq(schema.slotOffers.id, offerId), eq(schema.slotOffers.status, "aberta")))
    .returning({ id: schema.slotOffers.id });
  if (!offer) throw new UserError("Esta oferta já foi encerrada.");
  await releaseOfferCandidates(tx, [offer.id]);
  await logEvent(tx, { actorId: scope.actorId, type: "offer_cancelled", data: { offerId } });
}

/**
 * "Finalizar atendimento": registra a saída (mede a duração real da consulta).
 * Só para quem já chegou; não dá para finalizar antes da chegada.
 */
export async function finishAppointment(tx: Tx, scope: CrmScope, id: string): Promise<{ minutes: number }> {
  const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, id) });
  if (!appt) throw new UserError("Consulta não encontrada.");
  if (appt.status !== "compareceu") throw new UserError("Marque “Chegou” antes de finalizar o atendimento.");
  if (appt.finishedAt) throw new UserError("Este atendimento já foi finalizado.");
  const now = new Date();
  await tx
    .update(schema.appointments)
    .set({ finishedAt: now, version: sql`${schema.appointments.version} + 1` })
    .where(eq(schema.appointments.id, id));
  const start = Math.max(appt.startsAt.getTime(), (appt.arrivedAt ?? appt.startsAt).getTime());
  const minutes = Math.max(0, Math.round((now.getTime() - start) / 60_000));
  await logEvent(tx, { contactId: appt.contactId, actorId: scope.actorId, type: "appointment_finished", data: { appointmentId: id, minutos: minutes } });
  return { minutes };
}
