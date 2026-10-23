import "server-only";
import { type Channel, clinicTimeZone, formatDayShort, formatWhen, todayIso } from "@ecosaude/core/crm";
import { asc, count, eq, inArray, inSequence, isNotNull, schema, sql, withTenant } from "@ecosaude/db";
import type { ContactRow, ContactsData } from "@/components/crm/contacts/types";
import { now } from "@/lib/clock";
import { ago } from "./format";
import { openPrivacyCounts } from "./privacy";
import { contactColumns, contactOrder, contactWhere, isPatient, parseContactFilters, SEGMENTS, SORTS, type ContactSearchParams } from "./contacts-list";

/**
 * DADOS DAS LISTAS DE PESSOAS
 *  - Pacientes (menu): só pacientes efetivos, com atalhos do prontuário.
 *  - Leads (aba de Conversas): só quem ainda não virou paciente.
 * As duas usam os mesmos filtros e a mesma exportação (contacts-list.ts).
 */

/** Idade a partir da data de nascimento (AAAA-MM-DD) */
function age(birth: string | null, today: string): number | null {
  if (!birth) return null;
  const [by, bm, bd] = birth.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export interface BoardAccess {
  clinicId: string;
  can: (p: string) => boolean;
  /** Atendimento (CRM) contratado */
  crm: boolean;
  /** Prontuário contratado */
  pep: boolean;
}

export async function loadContactsBoard(a: BoardAccess, sp: ContactSearchParams, scope: NonNullable<ContactsData["scope"]>): Promise<ContactsData> {
  // O tipo vem do escopo da página, nunca da URL
  const f = { ...parseContactFilters(sp), tipo: scope.kind };
  const current = now();
  const today = todayIso(current);
  const where = contactWhere(f);
  const c = schema.contacts;
  // Resumo de segurança do prontuário (alergia na lista): só para quem pode ver
  const showAllergy = a.pep && (a.can("prontuario.ver") || a.can("prontuario.resumo"));

  const data = await withTenant(a.clinicId, async (tx) => {
    const [rows, total, stats, byStage, sources, tags, channels, team] = await inSequence([
      () =>
        tx
          .select({ ...contactColumns, ownerName: schema.clinicUsers.name })
          .from(c)
          .leftJoin(schema.clinicUsers, eq(schema.clinicUsers.id, c.ownerId))
          .where(where)
          .orderBy(...contactOrder(f))
          .limit(f.size)
          .offset((f.page - 1) * f.size),
      () => tx.select({ n: count() }).from(c).where(where),
      // Números da base (sem filtros, fora as fichas apagadas a pedido)
      () =>
        tx
          .select({
            total: sql<number>`count(*) filter (where ${scope.kind === "paciente" ? isPatient : sql`not ${isPatient}`})::int`,
            pacientes: sql<number>`count(*) filter (where ${isPatient})::int`,
            leads: sql<number>`count(*) filter (where not ${isPatient})::int`,
            novos30: sql<number>`count(*) filter (where ${c.createdAt} > now() - interval '30 days' and ${scope.kind === "paciente" ? isPatient : sql`not ${isPatient}`})::int`,
            semConsent: sql<number>`count(*) filter (where not ${c.consentMarketing} and ${c.optedOutAt} is null and ${scope.kind === "paciente" ? isPatient : sql`not ${isPatient}`})::int`,
            aniversariantes: sql<number>`count(*) filter (where extract(month from ${c.birthDate}) = extract(month from now() at time zone ${clinicTimeZone()}) and ${scope.kind === "paciente" ? isPatient : sql`not ${isPatient}`})::int`,
          })
          .from(c)
          .where(sql`${c.anonymizedAt} is null`),
      () => tx.select({ stage: c.stage, n: count() }).from(c).where(contactWhere({ ...f, stage: null })).groupBy(c.stage),
      () => tx.selectDistinct({ v: c.source }).from(c).where(isNotNull(c.source)).orderBy(asc(c.source)).limit(50),
      () => tx.execute<{ v: string }>(sql`select distinct unnest(tags) as v from contacts order by 1 limit 80`).then((r) => r.rows),
      () => tx.selectDistinct({ v: c.preferredChannel }).from(c).where(isNotNull(c.preferredChannel)),
      () => tx.select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name }).from(schema.clinicUsers).where(eq(schema.clinicUsers.active, true)).orderBy(asc(schema.clinicUsers.name)),
    ]);
    const privacy = a.can("pacientes.anonimizar") ? await openPrivacyCounts(tx) : null;
    // Quem da página tem alergia registrada (resumo de segurança do prontuário)
    const allergic = showAllergy && rows.length
      ? new Set(
          (
            await tx
              .select({ id: schema.pepPatientProfiles.contactId })
              .from(schema.pepPatientProfiles)
              .where(sql`${inArray(schema.pepPatientProfiles.contactId, rows.map((r) => r.id))} and jsonb_array_length(${schema.pepPatientProfiles.allergies}) > 0`)
          ).map((r) => r.id),
        )
      : new Set<string>();
    return { rows, total: total[0]?.n ?? 0, stats: stats[0], byStage, sources, tags, channels, team, privacy, allergic };
  });

  const rows: ContactRow[] = data.rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    stage: r.stage,
    kind: r.patient ? "paciente" : "lead",
    allergy: data.allergic.has(r.id),
    tags: r.tags,
    channel: r.channel,
    source: r.source,
    ownerName: r.ownerName?.split(" ")[0] ?? null,
    birthdayToday: r.birthDate?.slice(5) === today.slice(5),
    age: age(r.birthDate, today),
    optedOut: !!r.optedOutAt,
    consent: r.consentMarketing,
    next: r.nextAt ? formatWhen(new Date(r.nextAt), current) : null,
    lastInteraction: r.lastInteractionAt ? ago(r.lastInteractionAt, current.getTime()) : null,
    lastVisit: r.lastVisitAt ? formatDayShort(r.lastVisitAt) : null,
    createdAt: formatDayShort(r.createdAt),
    visits: r.visits,
    noShows: r.noShows,
    conversationId: r.conversationId,
  }));

  const s = data.stats ?? { total: 0, pacientes: 0, leads: 0, novos30: 0, semConsent: 0, aniversariantes: 0 };
  // O tipo não vai na URL das listas com escopo
  const params = Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "" && e[0] !== "tipo"));
  return {
    rows,
    total: data.total,
    page: f.page,
    pages: Math.max(1, Math.ceil(data.total / f.size)),
    size: f.size,
    params,
    stats: s,
    stageCounts: Object.fromEntries(data.byStage.map((b) => [b.stage, b.n])),
    facets: {
      sources: data.sources.map((x) => x.v).filter((v): v is string => !!v),
      tags: data.tags.map((x) => x.v),
      channels: data.channels.map((x) => x.v).filter((v): v is Channel => !!v),
    },
    team: data.team,
    segments: SEGMENTS,
    sorts: SORTS,
    canEdit: a.crm && a.can("pacientes.editar"),
    canStage: a.crm && a.can("jornada.editar"),
    canSchedule: a.crm && a.can("agenda.editar"),
    canExport: a.crm && a.can("contatos.exportar"),
    privacy: a.crm ? data.privacy : null,
    scope: { ...scope, other: scope.other ? { ...scope.other, count: scope.kind === "paciente" ? s.leads : s.pacientes } : null },
    crm: a.crm,
    pep: a.pep ? { canOpen: a.can("prontuario.ver") || a.can("prontuario.resumo") || a.can("prontuario.documentos") || a.can("prontuario.triagem") } : null,
  };
}
