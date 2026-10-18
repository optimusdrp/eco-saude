import { type Channel, clinicTimeZone, formatDayShort, formatWhen, todayIso } from "@ecosaude/core/crm";
import { asc, count, eq, inSequence, isNotNull, schema, sql, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { ContactsExplorer } from "@/components/crm/contacts/ContactsExplorer";
import type { ContactRow, ContactsData } from "@/components/crm/contacts/types";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { ago } from "@/modules/crm/format";
import { openPrivacyCounts } from "@/modules/crm/privacy";
import { contactColumns, contactOrder, contactWhere, parseContactFilters, SEGMENTS, SORTS, type ContactSearchParams } from "@/modules/crm/contacts-list";

export const metadata: Metadata = { title: "Contatos" };
export const dynamic = "force-dynamic";

/** Idade a partir da data de nascimento (AAAA-MM-DD) */
function age(birth: string | null, today: string): number | null {
  if (!birth) return null;
  const [by, bm, bd] = birth.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/**
 * CONTATOS: todos os leads e pacientes da clínica num lugar só.
 *
 * O servidor filtra e pagina (a base pode ser grande) com os mesmos filtros
 * da exportação (modules/crm/contacts-list.ts). A parte interativa
 * (ContactsExplorer) cuida de busca ao digitar, filtros, tabela ou cartões,
 * colunas escolhidas por cada pessoa, seleção em lote e ações rápidas.
 */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<ContactSearchParams> }) {
  const ctx = await requireCrm("pacientes.ver");
  const sp = await searchParams;
  const f = parseContactFilters(sp);
  const current = now();
  const today = todayIso(current);
  const where = contactWhere(f);
  const c = schema.contacts;

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
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
      // Números da base inteira (sem filtros)
      () =>
        tx
          .select({
            total: sql<number>`count(*)::int`,
            pacientes: sql<number>`count(*) filter (where exists (select 1 from appointments a where a.contact_id = "contacts"."id" and a.status = 'compareceu'))::int`,
            novos30: sql<number>`count(*) filter (where ${c.createdAt} > now() - interval '30 days')::int`,
            semConsent: sql<number>`count(*) filter (where not ${c.consentMarketing} and ${c.optedOutAt} is null)::int`,
            aniversariantes: sql<number>`count(*) filter (where extract(month from ${c.birthDate}) = extract(month from now() at time zone ${clinicTimeZone()}))::int`,
          })
          .from(c),
      () => tx.select({ stage: c.stage, n: count() }).from(c).groupBy(c.stage),
      () => tx.selectDistinct({ v: c.source }).from(c).where(isNotNull(c.source)).orderBy(asc(c.source)).limit(50),
      () => tx.execute<{ v: string }>(sql`select distinct unnest(tags) as v from contacts order by 1 limit 80`).then((r) => r.rows),
      () => tx.selectDistinct({ v: c.preferredChannel }).from(c).where(isNotNull(c.preferredChannel)),
      () => tx.select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name }).from(schema.clinicUsers).where(eq(schema.clinicUsers.active, true)).orderBy(asc(schema.clinicUsers.name)),
    ]);
    // Pedidos LGPD em aberto (atalho com contador para quem decide)
    const privacy = ctx.can("pacientes.anonimizar") ? await openPrivacyCounts(tx) : null;
    return { rows, total: total[0]?.n ?? 0, stats: stats[0], byStage, sources, tags, channels, team, privacy };
  });

  const rows: ContactRow[] = data.rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    stage: r.stage,
    kind: r.visits > 0 ? "paciente" : "lead",
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

  const s = data.stats ?? { total: 0, pacientes: 0, novos30: 0, semConsent: 0, aniversariantes: 0 };
  const params = Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  const board: ContactsData = {
    rows,
    total: data.total,
    page: f.page,
    pages: Math.max(1, Math.ceil(data.total / f.size)),
    size: f.size,
    params,
    stats: { ...s, leads: s.total - s.pacientes },
    stageCounts: Object.fromEntries(data.byStage.map((b) => [b.stage, b.n])),
    facets: {
      sources: data.sources.map((x) => x.v).filter((v): v is string => !!v),
      tags: data.tags.map((x) => x.v),
      channels: data.channels.map((x) => x.v).filter((v): v is Channel => !!v),
    },
    team: data.team,
    segments: SEGMENTS,
    sorts: SORTS,
    canEdit: ctx.can("pacientes.editar"),
    canStage: ctx.can("jornada.editar"),
    canSchedule: ctx.can("agenda.editar"),
    canExport: ctx.can("contatos.exportar"),
    privacy: data.privacy,
  };

  return <ContactsExplorer data={board} />;
}
