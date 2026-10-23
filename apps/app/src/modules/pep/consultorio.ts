import "server-only";
import { dayRangeUtc } from "@ecosaude/core/crm";
import type { Vitals } from "@ecosaude/core/pep";
import { and, asc, eq, inArray, lt, ne, schema, sql, type Tx } from "@ecosaude/db";
import type { TriagePriority } from "@ecosaude/db/schema-pep";

/**
 * CONSULTÓRIO: o dia do profissional numa lista só.
 *
 * Situação de cada paciente (na ordem do fluxo):
 *   aguardando -> chegou (recepção marcou) -> triado (pré-consulta feita) -> em atendimento
 *   -> finalizado; ou faltou. Consultas canceladas não aparecem.
 *
 * O que a tela mostra depende das permissões (princípio da necessidade, LGPD art. 6º, III):
 * situação e horário para todos; queixa e sinais da triagem só para quem faz triagem ou lê
 * o prontuário; alerta de alergia só para quem vê o resumo de segurança.
 */
export type FlowStatus = "aguardando" | "chegou" | "triado" | "em_atendimento" | "finalizado" | "faltou";

export const FLOW_LABEL: Record<FlowStatus, string> = {
  aguardando: "Aguardando chegada",
  chegou: "Na recepção",
  triado: "Triagem feita",
  em_atendimento: "Em atendimento",
  finalizado: "Finalizado",
  faltou: "Faltou",
};

export interface DayRow {
  appointmentId: string;
  startsAt: Date;
  endsAt: Date;
  service: string | null;
  arrivedAt: Date | null;
  /** Versão da consulta (controle de edição simultânea ao marcar a chegada) */
  version: number;
  status: FlowStatus;
  contact: { id: string; name: string; birthDate: string | null; sex: string | null; anonymized: boolean };
  professional: { id: string; name: string; userId: string | null };
  unit: { id: string; name: string };
  room: { id: string; name: string } | null;
  triage: { complaint: string | null; vitals: Vitals; priority: TriagePriority; notes: string | null; by: string; at: Date } | null;
  encounterId: string | null;
  hasAllergy: boolean;
}

export async function loadDay(tx: Tx, input: { date: string; professionalId: string | null; unitIds?: string[] | null }): Promise<DayRow[]> {
  const { start, end } = dayRangeUtc(input.date);
  const rows = await tx
    .select({
      a: {
        id: schema.appointments.id,
        startsAt: schema.appointments.startsAt,
        endsAt: schema.appointments.endsAt,
        status: schema.appointments.status,
        service: schema.appointments.service,
        arrivedAt: schema.appointments.arrivedAt,
        version: schema.appointments.version,
      },
      c: { id: schema.contacts.id, name: schema.contacts.name, birthDate: schema.contacts.birthDate, sex: schema.contacts.sex, anonymizedAt: schema.contacts.anonymizedAt },
      p: { id: schema.professionals.id, name: schema.professionals.name, userId: schema.professionals.userId },
      u: { id: schema.clinicUnits.id, name: schema.clinicUnits.name },
      r: { id: schema.clinicRooms.id, name: schema.clinicRooms.name },
      t: schema.pepTriages,
      e: { id: schema.pepEncounters.id, status: schema.pepEncounters.status },
      allergy: sql<boolean>`exists (select 1 from pep_patient_profiles pp where pp.contact_id = ${schema.contacts.id} and jsonb_array_length(pp.allergies) > 0)`,
    })
    .from(schema.appointments)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.appointments.contactId))
    .innerJoin(schema.professionals, eq(schema.professionals.id, schema.appointments.professionalId))
    .innerJoin(schema.clinicUnits, eq(schema.clinicUnits.id, schema.appointments.unitId))
    .leftJoin(schema.clinicRooms, eq(schema.clinicRooms.id, schema.appointments.roomId))
    .leftJoin(schema.pepTriages, eq(schema.pepTriages.appointmentId, schema.appointments.id))
    .leftJoin(schema.pepEncounters, eq(schema.pepEncounters.appointmentId, schema.appointments.id))
    .where(
      and(
        sql`${schema.appointments.startsAt} >= ${start} and ${schema.appointments.startsAt} < ${end}`,
        ne(schema.appointments.status, "cancelado"),
        input.professionalId ? eq(schema.appointments.professionalId, input.professionalId) : undefined,
        input.unitIds ? inArray(schema.appointments.unitId, input.unitIds) : undefined,
      ),
    )
    .orderBy(asc(schema.appointments.startsAt));

  return rows.map(({ a, c, p, u, r, t, e, allergy }) => ({
    appointmentId: a.id,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    service: a.service,
    arrivedAt: a.arrivedAt,
    version: a.version,
    status: flowStatus(a.status, !!t, e?.status ?? null),
    contact: { id: c.id, name: c.name, birthDate: c.birthDate, sex: c.sex, anonymized: !!c.anonymizedAt },
    professional: p,
    unit: u,
    room: r?.id ? { id: r.id, name: r.name } : null,
    triage: t ? { complaint: t.complaint, vitals: t.vitals, priority: t.priority, notes: t.notes, by: t.recordedByName, at: t.updatedAt } : null,
    encounterId: e?.id ?? null,
    hasAllergy: allergy === true,
  }));
}

function flowStatus(appt: string, triaged: boolean, encounter: string | null): FlowStatus {
  if (encounter === "finalizado") return "finalizado";
  if (encounter === "rascunho") return "em_atendimento";
  if (appt === "faltou") return "faltou";
  if (triaged) return "triado";
  if (appt === "compareceu") return "chegou";
  return "aguardando";
}

const PRIORITY_RANK: Record<TriagePriority, number> = { urgente: 0, prioritario: 1, normal: 2 };

/**
 * Próximo paciente: quem já está na clínica (triado ou na recepção), urgência primeiro e depois
 * pelo horário marcado. Sem ninguém esperando, o próximo horário que ainda vai chegar.
 */
export function nextPatient(rows: DayRow[]): DayRow | null {
  const inClinic = rows
    .filter((r) => r.status === "triado" || r.status === "chegou")
    .sort((a, b) => PRIORITY_RANK[a.triage?.priority ?? "normal"] - PRIORITY_RANK[b.triage?.priority ?? "normal"] || a.startsAt.getTime() - b.startsAt.getTime());
  return inClinic[0] ?? rows.find((r) => r.status === "aguardando") ?? null;
}

/** Atendimentos começados em dias anteriores e não finalizados (rascunho não vale como registro) */
export async function staleDrafts(tx: Tx, professionalId: string, today: string) {
  const { start } = dayRangeUtc(today);
  return tx
    .select({ id: schema.pepEncounters.id, startedAt: schema.pepEncounters.startedAt, name: schema.contacts.name })
    .from(schema.pepEncounters)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.pepEncounters.contactId))
    .where(and(eq(schema.pepEncounters.professionalId, professionalId), eq(schema.pepEncounters.status, "rascunho"), lt(schema.pepEncounters.startedAt, start)))
    .orderBy(asc(schema.pepEncounters.startedAt))
    .limit(20);
}

export interface RoomNow {
  id: string;
  name: string;
  unitName: string;
  /** Profissional usando agora e até quando */
  busy: { professional: string; until: Date } | null;
  /** Próximo uso hoje (quando livre agora) */
  next: { professional: string; at: Date } | null;
}

/**
 * MAPA DOS CONSULTÓRIOS AGORA: quem está em cada sala e até quando, ou quando ela volta a ser
 * usada hoje. Mostra o profissional (não o paciente): serve para a equipe se organizar.
 */
export async function roomsNow(tx: Tx, input: { unitIds: string[] | null; now: Date; dayEnd: Date }): Promise<RoomNow[]> {
  const rooms = await tx
    .select({ id: schema.clinicRooms.id, name: schema.clinicRooms.name, unitName: schema.clinicUnits.name })
    .from(schema.clinicRooms)
    .innerJoin(schema.clinicUnits, eq(schema.clinicUnits.id, schema.clinicRooms.unitId))
    .where(and(eq(schema.clinicRooms.active, true), eq(schema.clinicUnits.active, true), input.unitIds ? inArray(schema.clinicRooms.unitId, input.unitIds) : undefined))
    .orderBy(asc(schema.clinicUnits.name), asc(schema.clinicRooms.sortOrder), asc(schema.clinicRooms.name));
  if (!rooms.length) return [];
  const appts = await tx
    .select({ roomId: schema.appointments.roomId, startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt, professional: schema.professionals.name })
    .from(schema.appointments)
    .innerJoin(schema.professionals, eq(schema.professionals.id, schema.appointments.professionalId))
    .where(
      and(
        inArray(
          schema.appointments.roomId,
          rooms.map((r) => r.id),
        ),
        sql`${schema.appointments.status} not in ('cancelado', 'faltou')`,
        sql`${schema.appointments.endsAt} > ${input.now}`,
        lt(schema.appointments.startsAt, input.dayEnd),
      ),
    )
    .orderBy(asc(schema.appointments.startsAt));
  return rooms.map((r) => {
    const mine = appts.filter((a) => a.roomId === r.id);
    const cur = mine.find((a) => a.startsAt <= input.now);
    // Consultas seguidas do mesmo profissional: ocupado até o fim do bloco
    let until = cur?.endsAt ?? null;
    if (cur) for (const a of mine) if (until && a.startsAt.getTime() <= until.getTime() && a.endsAt > until && a.professional === cur.professional) until = a.endsAt;
    const nxt = mine.find((a) => a.startsAt > input.now);
    return { ...r, busy: cur && until ? { professional: cur.professional, until } : null, next: !cur && nxt ? { professional: nxt.professional, at: nxt.startsAt } : null };
  });
}
