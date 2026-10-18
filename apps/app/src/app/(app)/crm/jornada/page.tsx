import { CRM_FEATURES, daysBetween, firstName, formatWhen, nextStep } from "@ecosaude/core/crm";
import { asc, desc, eq, inSequence, isNull, schema, sql, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { JourneyBoard } from "@/components/crm/journey/JourneyBoard";
import type { JourneyCard, JourneyData } from "@/components/crm/journey/types";
import { LockedFeature, PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { lossReport } from "@/modules/crm/ai/insights";
import { automationSettings } from "@/modules/crm/automation-settings";
import { recalcReactivation } from "@/modules/crm/journey";

export const metadata: Metadata = { title: "Jornada" };
export const dynamic = "force-dynamic";

/** Quantos contatos o quadro carrega (os que mudaram de etapa mais recentemente) */
const LIMIT = 800;

/**
 * JORNADA: do primeiro contato ao paciente fiel, num quadro só.
 *
 * O servidor junta os cartões (com próxima consulta, conversa mais recente,
 * se está esperando resposta e o último contato), o funil dos últimos 90 dias
 * e os motivos de perda. O quadro interativo (JourneyBoard) cuida de filtros,
 * ordenação, visão em quadro ou lista, seleção em lote e preferências.
 *
 * Ao abrir, pacientes sem consulta há mais de 6 meses vão para "Para reativar".
 */
export default async function JourneyPage() {
  const ctx = await requireCrm("jornada.ver");
  if (!ctx.has(CRM_FEATURES.funnel)) {
    return (
      <>
        <PageHeader title="Jornada do paciente" />
        <LockedFeature title="Jornada do paciente">Quadro do primeiro contato até o paciente fiel, com movimento automático e alerta de quem está parado há tempo demais.</LockedFeature>
      </>
    );
  }
  const current = now();

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    await recalcReactivation(tx);
    const [contacts, funnel, lost, team] = await inSequence([
      () =>
        tx.query.contacts.findMany({
          // Fichas anonimizadas (LGPD) saem do quadro
          where: isNull(schema.contacts.anonymizedAt),
          with: { owner: { columns: { id: true, name: true } } },
          extras: {
            // Subconsultas por contato. "contacts"."id" por extenso: nos "extras"
            // o drizzle não qualifica a coluna e "id" seria o da subconsulta.
            nextAt: sql<string | null>`(select min(a.starts_at) from appointments a
              where a.contact_id = "contacts"."id" and a.starts_at > now() and a.status in ('agendado', 'confirmado'))`.as("next_at"),
            conversationId: sql<string | null>`(select cv.id from conversations cv
              where cv.contact_id = "contacts"."id" order by cv.last_message_at desc nulls last limit 1)`.as("conversation_id"),
            waiting: sql<boolean>`exists (select 1 from conversations cv
              where cv.contact_id = "contacts"."id" and cv.status = 'aberta' and cv.awaiting_reply_since is not null)`.as("waiting"),
            // Para o "próximo passo": desde quando espera, quem falou por último e quando,
            // se perguntou valor (30 dias) e se a próxima consulta já foi confirmada
            waitingSince: sql<string | null>`(select min(cv.awaiting_reply_since) from conversations cv
              where cv.contact_id = "contacts"."id" and cv.status = 'aberta')`.as("waiting_since"),
            lastDir: sql<string | null>`(select m.direction from messages m join conversations cv on cv.id = m.conversation_id
              where cv.contact_id = "contacts"."id" and m.direction in ('in', 'out') order by m.created_at desc limit 1)`.as("last_dir"),
            lastMsgAt: sql<string | null>`(select max(m.created_at) from messages m join conversations cv on cv.id = m.conversation_id
              where cv.contact_id = "contacts"."id" and m.direction in ('in', 'out'))`.as("last_msg_at"),
            askedPrice: sql<boolean>`exists (select 1 from messages m join conversations cv on cv.id = m.conversation_id
              where cv.contact_id = "contacts"."id" and m.direction = 'in' and m.created_at > now() - interval '30 days'
                and m.body ~* '(quanto (custa|fica|é)|valor|pre[cç]o|orçamento|orcamento)')`.as("asked_price"),
            nextConfirmed: sql<boolean>`exists (select 1 from appointments a
              where a.contact_id = "contacts"."id" and a.starts_at > now() and a.status = 'confirmado')`.as("next_confirmed"),
          },
          orderBy: desc(schema.contacts.stageChangedAt),
          limit: LIMIT + 1,
        }),
      // Funil dos últimos 90 dias: dos que chegaram, quantos conversaram, marcaram e compareceram.
      // Degraus acumulados: quem marcou consulta conta como "conversou" (mesmo que tenha sido por telefone).
      () =>
        tx
          .execute<{ total: number; conversou: number; marcou: number; compareceu: number }>(
            sql`select count(*)::int as total,
              count(*) filter (where exists (select 1 from messages m join conversations cv on cv.id = m.conversation_id
                where cv.contact_id = c.id and m.direction = 'out')
                or exists (select 1 from appointments a where a.contact_id = c.id))::int as conversou,
              count(*) filter (where exists (select 1 from appointments a where a.contact_id = c.id))::int as marcou,
              count(*) filter (where exists (select 1 from appointments a where a.contact_id = c.id and a.status = 'compareceu'))::int as compareceu
            from contacts c where c.created_at > now() - interval '90 days'`,
          )
          .then((r) => r.rows[0] ?? { total: 0, conversou: 0, marcou: 0, compareceu: 0 }),
      () =>
        tx
          .select({ reason: sql<string>`coalesce(nullif(trim(${schema.contacts.lostReason}), ''), 'sem motivo')`, n: sql<number>`count(*)::int` })
          .from(schema.contacts)
          .where(eq(schema.contacts.stage, "perdido"))
          .groupBy(sql`1`)
          .orderBy(sql`2 desc`)
          .limit(5),
      () => tx.select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name }).from(schema.clinicUsers).where(eq(schema.clinicUsers.active, true)).orderBy(asc(schema.clinicUsers.name)),
    ]);
    // Ajustes > IA: próximo passo nos cartões e motivos de perda organizados
    const auto = await automationSettings(tx);
    const lossGroups = auto.ia_motivo_perda?.enabled ? await lossReport(tx) : null;
    return { contacts, funnel, lost, team, nextStepOn: !!auto.ia_proximo_passo?.enabled, followUpDays: Number(auto.ia_proximo_passo?.diasSemResposta) || 2, lossGroups };
  });

  const truncated = data.contacts.length > LIMIT;
  const cards: JourneyCard[] = data.contacts.slice(0, LIMIT).map((c) => {
    const lastTouch = [c.lastInteractionAt, c.lastVisitAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: c.id,
      name: c.name,
      stage: c.stage,
      channel: c.preferredChannel,
      daysInStage: Math.max(0, daysBetween(c.stageChangedAt, current)),
      next: c.nextAt ? formatWhen(new Date(c.nextAt), current) : null,
      nextMs: c.nextAt ? new Date(c.nextAt).getTime() : null,
      tags: c.tags,
      source: c.source,
      ownerId: c.owner?.id ?? null,
      ownerName: c.owner?.name.split(" ")[0] ?? null,
      lostReason: c.lostReason,
      conversationId: c.conversationId,
      waiting: !!c.waiting,
      lastTouchDays: lastTouch ? Math.max(0, daysBetween(lastTouch, current)) : null,
      // Próximo passo: decidido pelas REGRAS (a IA só redige a mensagem, quando pedida)
      nextStep: data.nextStepOn
        ? nextStep(
            {
              stage: c.stage,
              firstName: firstName(c.name),
              waiting: !!c.waiting,
              waitingHours: c.waitingSince ? (current.getTime() - new Date(c.waitingSince).getTime()) / 3_600_000 : 0,
              lastFrom: c.lastDir === "in" ? "paciente" : c.lastDir === "out" ? "clinica" : null,
              daysSinceLast: c.lastMsgAt ? Math.max(0, daysBetween(new Date(c.lastMsgAt), current)) : null,
              next: c.nextAt ? { inHours: (new Date(c.nextAt).getTime() - current.getTime()) / 3_600_000, confirmed: !!c.nextConfirmed } : null,
              askedPrice: !!c.askedPrice,
              daysSinceVisit: c.lastVisitAt ? daysBetween(c.lastVisitAt, current) : null,
              daysInStage: Math.max(0, daysBetween(c.stageChangedAt, current)),
              canMarket: c.consentMarketing && !c.optedOutAt,
            },
            data.followUpDays,
          )
        : null,
    };
  });

  const f = data.funnel;
  const board: JourneyData = {
    cards,
    funnel: [
      { label: "Chegaram", value: f.total, hint: "novos contatos nos últimos 90 dias" },
      { label: "Conversaram", value: f.conversou, hint: "receberam resposta da clínica" },
      { label: "Marcaram", value: f.marcou, hint: "tiveram ao menos uma consulta marcada" },
      { label: "Compareceram", value: f.compareceu, hint: "foram atendidos na clínica" },
    ],
    lostReasons: data.lost,
    lossGroups: data.lossGroups,
    team: data.team,
    userId: ctx.user.id,
    canEdit: ctx.can("jornada.editar"),
    canSchedule: ctx.can("agenda.editar"),
    truncated,
  };

  return <JourneyBoard data={board} />;
}
