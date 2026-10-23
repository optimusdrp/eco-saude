import "server-only";
import { clinicTimeZone, effectivePermissions, type ClinicRole } from "@ecosaude/core/crm";
import { emergencyEmail, emergencyRecipients, NOTICE_RETENTION_DAYS, type NoticeText } from "@ecosaude/core/pep";
import { and, db, desc, eq, inArray, isNull, lt, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import type { schema as dbSchema } from "@ecosaude/db";

/** Tipo de aviso (ver USER_NOTICE_KINDS em packages/db/src/schema-crm.ts) */
type UserNoticeKind = (typeof dbSchema.userNotices.$inferSelect)["kind"];
import { appUrl, sendEmail } from "@/lib/email";

/**
 * AVISOS DA EQUIPE (o sino da barra superior)
 *
 * Fluxo: o evento acontece (acesso de emergência, triagem urgente) e é auditado na mesma
 * transação; em seguida `createNotices` grava UM aviso por destinatário. O sino de cada pessoa
 * consulta /api/avisos a cada 20 segundos (só com a aba visível) e mostra os não lidos.
 *
 * Por que não WebSocket/push: o app roda atrás de balanceador e sem servidor de tempo real;
 * 20 s de atraso é aceitável para estes avisos e a consulta é barata (índice por pessoa).
 */

export interface NoticeInput extends NoticeText {
  userId: string;
  kind: UserNoticeKind;
  href: string;
  contactId: string | null;
  refId: string;
  urgent?: boolean;
}

/** Grava os avisos (repetir o mesmo evento não duplica: índice único pessoa + tipo + origem) */
export async function createNotices(tx: Tx, notices: NoticeInput[]): Promise<number> {
  if (!notices.length) return 0;
  const rows = await tx
    .insert(schema.userNotices)
    .values(notices.map((n) => ({ userId: n.userId, kind: n.kind, title: n.title, body: n.body, href: n.href, contactId: n.contactId, refId: n.refId, urgent: n.urgent ?? false })))
    .onConflictDoNothing()
    .returning({ id: schema.userNotices.id });
  return rows.length;
}

/**
 * Pessoas ativas da clínica com as permissões efetivas (perfil + ajustes individuais +
 * perfil de profissional de saúde), calculadas igual ao login (lib/auth/dal.ts).
 */
export async function clinicTeam(tx: Tx): Promise<{ id: string; name: string; email: string; active: boolean; permissions: string[] }[]> {
  const roleMatch = sql`r.clinic_id = ${schema.clinicUsers.clinicId} and (r.id = ${schema.clinicUsers.roleId} or (${schema.clinicUsers.roleId} is null and r.system_key = ${schema.clinicUsers.role}))`;
  const rows = await tx
    .select({
      user: schema.clinicUsers,
      rolePermissions: sql<string[] | null>`(select r.permissions from clinic_roles r where ${roleMatch} limit 1)`,
      healthProfessional: sql<boolean>`((${schema.clinicUsers.healthCouncil} is not null and ${schema.clinicUsers.healthCouncilNumber} is not null)
        or exists (select 1 from professionals p where p.user_id = ${schema.clinicUsers.id} and p.active and p.council is not null and p.council_number is not null))`,
    })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.active, true));
  return rows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    email: r.user.email,
    active: r.user.active,
    permissions: effectivePermissions({
      rolePermissions: r.rolePermissions,
      baseRole: r.user.role as ClinicRole,
      grants: r.user.permissionGrants,
      revokes: r.user.permissionRevokes,
      healthProfessional: r.healthProfessional === true,
    }),
  }));
}

/** Destinatários do aviso de acesso de emergência (gestão do prontuário, menos quem acessou) */
export async function emergencyNoticeRecipients(tx: Tx, actorId: string): Promise<string[]> {
  return emergencyRecipients(await clinicTeam(tx), actorId);
}

/* ------------------------------ Leitura (sino) ------------------------------ */

export interface NoticeView {
  id: string;
  kind: UserNoticeKind;
  title: string;
  body: string;
  href: string;
  urgent: boolean;
  createdAt: string;
  read: boolean;
}

export async function noticesFor(clinicId: string, userId: string, limit = 20): Promise<{ unread: number; items: NoticeView[] }> {
  return withTenant(clinicId, async (tx) => {
    const items = await tx
      .select()
      .from(schema.userNotices)
      .where(eq(schema.userNotices.userId, userId))
      .orderBy(desc(schema.userNotices.createdAt))
      .limit(limit);
    const [c] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.userNotices)
      .where(and(eq(schema.userNotices.userId, userId), isNull(schema.userNotices.readAt)));
    return {
      unread: c?.n ?? 0,
      items: items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, urgent: n.urgent, createdAt: n.createdAt.toISOString(), read: !!n.readAt })),
    };
  });
}

/** Marca como lidos (só os da própria pessoa). Sem ids: todos. */
export async function markNoticesRead(clinicId: string, userId: string, ids?: string[]): Promise<void> {
  await withTenant(clinicId, (tx) =>
    tx
      .update(schema.userNotices)
      .set({ readAt: new Date() })
      .where(and(eq(schema.userNotices.userId, userId), isNull(schema.userNotices.readAt), ids?.length ? inArray(schema.userNotices.id, ids) : undefined)),
  );
}

/** Quem foi avisado de cada evento e quando leu (para o registro de acessos em Prontuário > Ajustes) */
export async function noticeReceipts(tx: Tx, refIds: string[]): Promise<Map<string, { name: string; readAt: Date | null }[]>> {
  const out = new Map<string, { name: string; readAt: Date | null }[]>();
  if (!refIds.length) return out;
  const rows = await tx
    .select({ refId: schema.userNotices.refId, name: schema.clinicUsers.name, readAt: schema.userNotices.readAt })
    .from(schema.userNotices)
    .innerJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.userNotices.userId))
    .where(inArray(schema.userNotices.refId, refIds));
  for (const r of rows) out.set(r.refId, [...(out.get(r.refId) ?? []), { name: r.name, readAt: r.readAt }]);
  return out;
}

/* ------------------------------ E-mail opcional ------------------------------ */

/**
 * Envia o e-mail do acesso de emergência (se a clínica ligou em Prontuário > Ajustes).
 * Roda DEPOIS da transação (after()), para não atrasar quem pediu o acesso.
 * Sem dado do paciente no e-mail (regra em core/pep/notices.ts). Falha de e-mail não
 * desfaz nada: o aviso no sino já existe.
 */
export async function sendEmergencyEmails(clinicId: string, auditId: string): Promise<void> {
  const base = appUrl();
  if (!base) return;
  // 1) Lê o que enviar (transação curta, sem rede no meio)
  const job = await withTenant(clinicId, async (tx) => {
    const [settings] = await tx.select({ email: schema.pepSettings.emergencyEmail }).from(schema.pepSettings).limit(1);
    if (!settings?.email) return null;
    const [clinic] = await tx.select({ name: schema.clinics.tradeName, tz: schema.clinics.timeZone }).from(schema.clinics).where(eq(schema.clinics.id, clinicId));
    const pending = await tx
      .select({ id: schema.userNotices.id, email: schema.clinicUsers.email, at: schema.userNotices.createdAt })
      .from(schema.userNotices)
      .innerJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.userNotices.userId))
      .where(and(eq(schema.userNotices.refId, auditId), eq(schema.userNotices.kind, "pep_emergencia"), isNull(schema.userNotices.emailedAt)));
    return { clinic, pending };
  });
  if (!job?.pending.length) return;
  // 2) Envia, um por pessoa
  const sent: string[] = [];
  for (const n of job.pending) {
    const when = new Intl.DateTimeFormat("pt-BR", { timeZone: job.clinic?.tz || clinicTimeZone(), day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      .format(n.at)
      .replace(",", " às");
    const mail = emergencyEmail({ clinicName: job.clinic?.name ?? "clínica", when, link: `${base}/prontuario/ajustes` });
    const r = await sendEmail({ to: n.email, subject: mail.subject, html: mail.html, text: mail.text, tag: "pep-emergencia" });
    if (r.ok) sent.push(n.id);
    else console.error("[aviso emergência] e-mail não enviado:", r.errors.join("; "));
  }
  // 3) Marca os enviados (não reenviar)
  if (sent.length) await withTenant(clinicId, (tx) => tx.update(schema.userNotices).set({ emailedAt: new Date() }).where(inArray(schema.userNotices.id, sent)));
}

/* --------------------------------- Limpeza --------------------------------- */

/** Rotina: apaga avisos com mais de 90 dias, de todas as clínicas (como dono das tabelas). */
export async function purgeOldNotices(): Promise<number> {
  const cutoff = new Date(Date.now() - NOTICE_RETENTION_DAYS * 86_400_000);
  const rows = await db.delete(schema.userNotices).where(lt(schema.userNotices.createdAt, cutoff)).returning({ id: schema.userNotices.id });
  return rows.length;
}
