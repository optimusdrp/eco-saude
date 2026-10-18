import "server-only";
import { type Channel, CHANNELS, clinicTimeZone, JOURNEY_STAGES, type JourneyStage } from "@ecosaude/core/crm";
import { and, asc, eq, ilike, isNotNull, isNull, or, schema, sql, type SQL } from "@ecosaude/db";
import { containsText } from "./search";

/**
 * LISTA DE CONTATOS (leads e pacientes) — filtros compartilhados pela página
 * /crm/contatos e pela exportação em CSV, para as duas mostrarem exatamente
 * as mesmas pessoas.
 *
 * Lead x paciente: PACIENTE é quem já compareceu a ao menos uma consulta;
 * LEAD é todo o resto (ainda não foi atendido).
 */

export const SEGMENTS = {
  aniversariantes: { label: "Aniversariantes do mês", hint: "Uma mensagem no aniversário fortalece o vínculo." },
  novos: { label: "Novos (30 dias)", hint: "Chegaram nos últimos 30 dias: responda rápido e tente agendar." },
  com_consulta: { label: "Com consulta marcada", hint: "Têm consulta agendada ou confirmada." },
  sem_contato: { label: "Sem contato há 90 dias", hint: "Ninguém falou com eles há 3 meses ou mais. Bom momento para um retorno." },
  faltosos: { label: "Faltaram 2+ vezes", hint: "Peça confirmação mais cedo para estes contatos." },
  sem_consentimento: { label: "Sem consentimento LGPD", hint: "Não recebem lembretes de retorno. Peça autorização no próximo contato." },
  sairam: { label: "Pediram SAIR", hint: "Não recebem nenhuma mensagem automática." },
} as const;
export type Segment = keyof typeof SEGMENTS;

export const SORTS = {
  interacao: "Última interação",
  nome: "Nome (A a Z)",
  recentes: "Cadastrados por último",
  consulta: "Próxima consulta",
} as const;
export type ContactSort = keyof typeof SORTS;

export const PAGE_SIZES = [30, 60, 100] as const;

export interface ContactFilters {
  q: string;
  tipo: "lead" | "paciente" | null;
  stage: JourneyStage | null;
  channel: Channel | null;
  source: string | null;
  tag: string | null;
  /** id do responsável, ou "-" para "sem responsável" */
  owner: string | null;
  segment: Segment | null;
  sort: ContactSort;
  page: number;
  size: number;
}

export type ContactSearchParams = Partial<Record<"q" | "tipo" | "etapa" | "canal" | "origem" | "etiqueta" | "dono" | "segmento" | "ordem" | "pagina" | "por", string>>;

const UUID = /^[0-9a-f-]{36}$/i;

/** Lê a URL com valores seguros (qualquer coisa estranha vira "sem filtro") */
export function parseContactFilters(sp: ContactSearchParams): ContactFilters {
  const size = Number(sp.por);
  return {
    q: (sp.q ?? "").trim().slice(0, 80),
    tipo: sp.tipo === "lead" || sp.tipo === "paciente" ? sp.tipo : null,
    stage: JOURNEY_STAGES.includes(sp.etapa as JourneyStage) ? (sp.etapa as JourneyStage) : null,
    channel: CHANNELS.includes(sp.canal as Channel) ? (sp.canal as Channel) : null,
    source: sp.origem?.trim().slice(0, 60) || null,
    tag: sp.etiqueta?.trim().slice(0, 40) || null,
    owner: sp.dono === "-" || (sp.dono && UUID.test(sp.dono)) ? sp.dono : null,
    segment: sp.segmento && sp.segmento in SEGMENTS ? (sp.segmento as Segment) : null,
    sort: sp.ordem && sp.ordem in SORTS ? (sp.ordem as ContactSort) : "interacao",
    page: Math.max(1, Math.min(10_000, Number(sp.pagina) || 1)),
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : 30,
  };
}

const c = schema.contacts;
// Subconsultas por contato. "contacts"."id" por extenso: dentro do select o
// drizzle omite o nome da tabela e "id" apontaria para a tabela da subconsulta.
export const contactExtras = {
  nextAt: sql<Date | null>`(select min(a.starts_at) from appointments a where a.contact_id = "contacts"."id" and a.starts_at > now() and a.status in ('agendado','confirmado'))`,
  noShows: sql<number>`(select count(*)::int from appointments a where a.contact_id = "contacts"."id" and a.status = 'faltou')`,
  visits: sql<number>`(select count(*)::int from appointments a where a.contact_id = "contacts"."id" and a.status = 'compareceu')`,
  conversationId: sql<string | null>`(select cv.id from conversations cv where cv.contact_id = "contacts"."id" order by cv.last_message_at desc nulls last limit 1)`,
};
const isPatient = sql`exists (select 1 from appointments a where a.contact_id = "contacts"."id" and a.status = 'compareceu')`;

/** Condição SQL dos filtros (sem paginação) */
export function contactWhere(f: ContactFilters): SQL | undefined {
  // Fichas anonimizadas (LGPD) não aparecem na lista nem na planilha
  const where: SQL[] = [isNull(c.anonymizedAt)];
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    const conds = [containsText(c.name, f.q), containsText(c.email, f.q)];
    if (digits.length >= 4) conds.push(ilike(c.phone, `%${digits}%`));
    where.push(or(...conds)!);
  }
  if (f.tipo === "paciente") where.push(isPatient);
  if (f.tipo === "lead") where.push(sql`not ${isPatient}`);
  if (f.stage) where.push(eq(c.stage, f.stage));
  if (f.channel) where.push(eq(c.preferredChannel, f.channel));
  if (f.source) where.push(eq(c.source, f.source));
  if (f.tag) where.push(sql`${f.tag} = any(${c.tags})`);
  if (f.owner === "-") where.push(isNull(c.ownerId));
  else if (f.owner) where.push(eq(c.ownerId, f.owner));
  switch (f.segment) {
    case "aniversariantes":
      where.push(sql`extract(month from ${c.birthDate}) = extract(month from now() at time zone ${clinicTimeZone()})`);
      break;
    case "novos":
      where.push(sql`${c.createdAt} > now() - interval '30 days'`);
      break;
    case "com_consulta":
      where.push(sql`${contactExtras.nextAt} is not null`);
      break;
    case "sem_contato":
      where.push(sql`coalesce(${c.lastInteractionAt}, ${c.createdAt}) < now() - interval '90 days'`);
      break;
    case "faltosos":
      where.push(sql`${contactExtras.noShows} >= 2`);
      break;
    case "sem_consentimento":
      where.push(and(eq(c.consentMarketing, false), isNull(c.optedOutAt))!);
      break;
    case "sairam":
      where.push(isNotNull(c.optedOutAt));
      break;
  }
  return where.length ? and(...where) : undefined;
}

/** Ordem da lista (aniversariantes: pelo dia do mês) */
export function contactOrder(f: ContactFilters): SQL[] {
  if (f.segment === "aniversariantes") return [sql`extract(day from ${c.birthDate})`, asc(c.name)];
  switch (f.sort) {
    case "nome":
      return [asc(c.name)];
    case "recentes":
      return [sql`${c.createdAt} desc`];
    case "consulta":
      return [sql`${contactExtras.nextAt} asc nulls last`, asc(c.name)];
    default:
      return [sql`${c.lastInteractionAt} desc nulls last`, asc(c.name)];
  }
}

/** Campos de cada linha */
export const contactColumns = {
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  stage: c.stage,
  tags: c.tags,
  channel: c.preferredChannel,
  source: c.source,
  ownerId: c.ownerId,
  birthDate: c.birthDate,
  optedOutAt: c.optedOutAt,
  consentMarketing: c.consentMarketing,
  lastInteractionAt: c.lastInteractionAt,
  lastVisitAt: c.lastVisitAt,
  createdAt: c.createdAt,
  ...contactExtras,
};
