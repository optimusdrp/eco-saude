import "server-only";
import { recordAccess, type AccessMode } from "@ecosaude/core/pep";
import { and, desc, eq, gt, schema, sql, type Tx } from "@ecosaude/db";
import type { PepAuditAction } from "@ecosaude/db/schema-pep";
import type { PepContext } from "@/lib/auth/dal";
import { clientIp } from "@/lib/server";

/**
 * SIGILO E AUDITORIA DO PRONTUÁRIO
 *
 *  - Ajuste da clínica: "todos" (qualquer profissional com permissão abre) ou "proprios"
 *    (só quem atendeu o paciente; os demais pedem ACESSO DE EMERGÊNCIA com justificativa).
 *  - O acesso de emergência vale por 12 horas para aquela pessoa e aquele paciente, fica no
 *    registro de acessos e aparece para a gestão em Prontuário > Ajustes.
 *  - Toda abertura, finalização, adendo, emissão e impressão é registrada (pep_audit, só INSERT).
 */

export const EMERGENCY_HOURS = 12;

export interface PepSettingsRow {
  accessMode: AccessMode;
  headerNote: string | null;
  defaultReturnDays: number | null;
  /** Avisar a gestão também por e-mail no acesso de emergência (sem dado do paciente) */
  emergencyEmail: boolean;
}

export async function loadPepSettings(tx: Tx): Promise<PepSettingsRow> {
  const [row] = await tx.select().from(schema.pepSettings).limit(1);
  return { accessMode: row?.accessMode ?? "todos", headerNote: row?.headerNote ?? null, defaultReturnDays: row?.defaultReturnDays ?? null, emergencyEmail: row?.emergencyEmail ?? false };
}

/** Profissional ligado ao usuário (Ajustes > Clínica > Profissionais > "acesso") */
export async function professionalOfUser(tx: Tx, userId: string) {
  const [pro] = await tx.select().from(schema.professionals).where(and(eq(schema.professionals.userId, userId), eq(schema.professionals.active, true))).limit(1);
  return pro ?? null;
}

/** O profissional já atendeu (ou tem consulta com) o paciente? */
async function attended(tx: Tx, professionalId: string, contactId: string): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`
    select exists (select 1 from pep_encounters where professional_id = ${professionalId} and contact_id = ${contactId})
        or exists (select 1 from appointments where professional_id = ${professionalId} and contact_id = ${contactId} and status <> 'cancelado') as ok`);
  return r.rows[0]?.ok === true;
}

export type RecordAccess = "liberado" | "emergencia" | "negado";

/** Pode abrir o prontuário deste paciente agora? */
export async function accessFor(tx: Tx, ctx: PepContext, contactId: string): Promise<{ access: RecordAccess; viaEmergency: boolean }> {
  const settings = await loadPepSettings(tx);
  const pro = await professionalOfUser(tx, ctx.user.id);
  const base = recordAccess({
    mode: settings.accessMode,
    canRead: ctx.can("prontuario.ver"),
    canEmergency: ctx.can("prontuario.acesso_emergencia"),
    attended: pro ? await attended(tx, pro.id, contactId) : false,
  });
  if (base !== "emergencia") return { access: base, viaEmergency: false };
  // Já justificou nas últimas horas?
  const [recent] = await tx
    .select({ id: schema.pepAudit.id })
    .from(schema.pepAudit)
    .where(
      and(
        eq(schema.pepAudit.userId, ctx.user.id),
        eq(schema.pepAudit.contactId, contactId),
        eq(schema.pepAudit.action, "emergencia"),
        gt(schema.pepAudit.at, new Date(Date.now() - EMERGENCY_HOURS * 3600_000)),
      ),
    )
    .limit(1);
  return recent ? { access: "liberado", viaEmergency: true } : { access: "emergencia", viaEmergency: false };
}

/** Registra no histórico de acessos (só inclusão: o banco não deixa alterar nem apagar) */
export async function audit(
  tx: Tx,
  ctx: PepContext,
  entry: { action: PepAuditAction; contactId?: string | null; encounterId?: string | null; documentId?: string | null; reason?: string | null },
): Promise<string> {
  const [row] = await tx.insert(schema.pepAudit).values({
    userId: ctx.user.id,
    userName: ctx.user.name,
    contactId: entry.contactId ?? null,
    encounterId: entry.encounterId ?? null,
    documentId: entry.documentId ?? null,
    action: entry.action,
    reason: entry.reason ?? null,
    ip: await clientIp().catch(() => null),
  }).returning({ id: schema.pepAudit.id });
  // O id do registro vira a origem dos avisos (sino) ligados a este evento
  return row!.id;
}

/**
 * Abertura do prontuário: registra uma vez a cada 30 minutos por pessoa e paciente
 * (recarregar a página ou salvar o rascunho não enche o histórico de linhas iguais).
 */
export async function auditOpen(tx: Tx, ctx: PepContext, contactId: string, reason?: string): Promise<void> {
  const [recent] = await tx
    .select({ at: schema.pepAudit.at })
    .from(schema.pepAudit)
    .where(and(eq(schema.pepAudit.userId, ctx.user.id), eq(schema.pepAudit.contactId, contactId), eq(schema.pepAudit.action, "abrir")))
    .orderBy(desc(schema.pepAudit.at))
    .limit(1);
  if (recent && Date.now() - recent.at.getTime() < 30 * 60_000) return;
  await audit(tx, ctx, { action: "abrir", contactId, reason: reason ?? null });
}
