import "server-only";
import { hashToken } from "@ecosaude/auth/crypto";
import { CLINIC_ROLE_LABEL, effectivePermissions, type ClinicPermission, type ClinicRole, type CrmFeature } from "@ecosaude/core/crm";
import { and, db, eq, getClinicEntitlements, gte, schema, sql, type ClinicEntitlements } from "@ecosaude/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { rememberRequestTimeZone } from "../clinic-tz";
import { readSessionToken } from "./session";

/**
 * Camada de acesso (DAL): toda página e toda action passa por aqui.
 * - quem é o usuário e de qual clínica (pela sessão)
 * - se concluiu as etapas de segurança (senha definitiva, 2FA quando ativa)
 * - se o perfil tem a permissão
 * - se a clínica contratou o módulo e a funcionalidade
 */

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  /** Nível de referência do perfil (gestor, recepção, profissional) */
  role: ClinicRole;
  /** Nome do perfil (cargo), ex.: "Coordenação clínica" */
  roleName: string;
  /** Permissões efetivas: perfil + liberadas − bloqueadas (lidas a cada requisição) */
  permissions: ClinicPermission[];
  /**
   * Profissional de saúde (registro em conselho no próprio acesso ou num profissional da agenda
   * ligado a ele). Só assim lê e registra conteúdo clínico (sigilo profissional, LGPD art. 11).
   */
  healthProfessional: boolean;
  /** Unidades em que a pessoa trabalha (vazio = todas): agenda, Hoje e Consultório mostram só elas */
  unitIds: string[];
  clinicId: string;
  clinicName: string;
  /** Fuso horário da clínica (IANA, ex.: "America/Manaus") */
  clinicTimeZone: string;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  twoFactorPassed: boolean;
  sessionId: string;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;

  // Perfil da pessoa: o escolhido (role_id) ou, sem escolha, o perfil do sistema do mesmo nível
  const roleMatch = sql`r.clinic_id = ${schema.clinicUsers.clinicId} and (r.id = ${schema.clinicUsers.roleId} or (${schema.clinicUsers.roleId} is null and r.system_key = ${schema.clinicUsers.role}))`;
  const [row] = await db
    .select({
      session: schema.clinicSessions,
      user: schema.clinicUsers,
      clinic: schema.clinics,
      rolePermissions: sql<string[] | null>`(select r.permissions from clinic_roles r where ${roleMatch} limit 1)`,
      roleName: sql<string | null>`(select r.name from clinic_roles r where ${roleMatch} limit 1)`,
      healthProfessional: sql<boolean>`((${schema.clinicUsers.healthCouncil} is not null and ${schema.clinicUsers.healthCouncilNumber} is not null)
        or exists (select 1 from professionals p where p.user_id = ${schema.clinicUsers.id} and p.active and p.council is not null and p.council_number is not null))`,
    })
    .from(schema.clinicSessions)
    .innerJoin(schema.clinicUsers, eq(schema.clinicSessions.userId, schema.clinicUsers.id))
    .innerJoin(schema.clinics, eq(schema.clinicUsers.clinicId, schema.clinics.id))
    .where(and(eq(schema.clinicSessions.id, hashToken(token)), gte(schema.clinicSessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.user.active) return null;
  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.user.role,
    roleName: row.roleName ?? CLINIC_ROLE_LABEL[row.user.role],
    permissions: effectivePermissions({
      rolePermissions: row.rolePermissions,
      baseRole: row.user.role,
      grants: row.user.permissionGrants,
      revokes: row.user.permissionRevokes,
      healthProfessional: row.healthProfessional === true,
    }),
    healthProfessional: row.healthProfessional === true,
    unitIds: row.user.unitIds ?? [],
    clinicId: row.clinic.id,
    clinicName: row.clinic.tradeName,
    clinicTimeZone: row.clinic.timeZone,
    totpEnabled: row.user.totpEnabled,
    mustChangePassword: row.user.mustChangePassword,
    twoFactorPassed: row.session.twoFactorPassed,
    sessionId: row.session.id,
  };
});

export type PendingStep = "two-factor" | "change-password" | null;

export function pendingStep(user: CurrentUser): PendingStep {
  if (user.totpEnabled && !user.twoFactorPassed) return "two-factor";
  if (user.mustChangePassword) return "change-password";
  return null;
}

const stepRoute: Record<Exclude<PendingStep, null>, string> = {
  "two-factor": "/login/verificacao",
  "change-password": "/primeiro-acesso",
};

export function routeForStep(step: Exclude<PendingStep, null>): string {
  return stepRoute[step];
}

/**
 * Entra no fuso da clínica do usuário para o resto desta requisição.
 * Fica nos pontos chamados por CADA tela/ação (e não em getCurrentUser, que é
 * memorizado por requisição: layout e página rodam em caminhos paralelos).
 */
function enterUserTimeZone(user: CurrentUser): void {
  // Liga o fuso ao objeto da requisição (ações, rotas e componentes). Transações abrem o próprio contexto.
  rememberRequestTimeZone(user.clinicTimeZone);
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  enterUserTimeZone(user);
  const step = pendingStep(user);
  if (step) redirect(stepRoute[step]);
  return user;
}

/** Módulos e funcionalidades que a clínica pode usar agora (calculado uma vez por requisição). */
export const getEntitlements = cache((clinicId: string): Promise<ClinicEntitlements> => getClinicEntitlements(clinicId));

export interface CrmContext {
  user: CurrentUser;
  entitlements: ClinicEntitlements;
  has: (feature: CrmFeature) => boolean;
  can: (permission: ClinicPermission) => boolean;
}

/**
 * Para páginas do Tropi: exige login, módulo CRM contratado e (opcional) uma permissão.
 * Sem o módulo, mostra a página explicando que ele não está ativo.
 */
export async function requireCrm(permission?: ClinicPermission): Promise<CrmContext> {
  const user = await requireUser();
  if (permission && !user.permissions.includes(permission)) redirect("/sem-permissao");
  const entitlements = await getEntitlements(user.clinicId);
  if (!entitlements.modules.includes("crm")) redirect("/modulos/crm");
  enterUserTimeZone(user);
  return {
    user,
    entitlements,
    has: (f) => entitlements.features.includes(f),
    can: (p) => user.permissions.includes(p),
  };
}

/**
 * Ajustes comuns da clínica (dados, profissionais): valem para quem tem o Atendimento
 * OU o Prontuário (o prontuário também cadastra os profissionais e o conselho deles).
 */
export async function requireClinic(permission: ClinicPermission): Promise<CrmContext> {
  const user = await requireUser();
  if (!user.permissions.includes(permission)) redirect("/sem-permissao");
  const entitlements = await getEntitlements(user.clinicId);
  if (!entitlements.modules.includes("crm") && !entitlements.modules.includes("pep")) redirect("/modulos/crm");
  return { user, entitlements, has: (f) => entitlements.features.includes(f), can: (p) => user.permissions.includes(p) };
}

export async function authorizeClinic(permission: ClinicPermission): Promise<CrmContext | null> {
  const user = await getCurrentUser();
  if (!user || pendingStep(user) || !user.permissions.includes(permission)) return null;
  const entitlements = await getEntitlements(user.clinicId);
  if (!entitlements.modules.includes("crm") && !entitlements.modules.includes("pep")) return null;
  enterUserTimeZone(user);
  return { user, entitlements, has: (f) => entitlements.features.includes(f), can: (p) => user.permissions.includes(p) };
}

/**
 * Para server actions: devolve o contexto ou null (sem redirecionar),
 * conferindo login, módulo, permissão e, se pedido, a funcionalidade do plano.
 */
export async function authorizeCrm(permission: ClinicPermission, feature?: CrmFeature): Promise<CrmContext | null> {
  const user = await getCurrentUser();
  if (!user || pendingStep(user) || !user.permissions.includes(permission)) return null;
  const entitlements = await getEntitlements(user.clinicId);
  if (!entitlements.modules.includes("crm")) return null;
  if (feature && !entitlements.features.includes(feature)) return null;
  enterUserTimeZone(user);
  return {
    user,
    entitlements,
    has: (f) => entitlements.features.includes(f),
    can: (p) => user.permissions.includes(p),
  };
}

/* -------------------------------- Prontuário -------------------------------- */

export interface PepContext {
  user: CurrentUser;
  entitlements: ClinicEntitlements;
  /** O Atendimento também está contratado (agenda, retorno, mensagens) */
  hasCrm: boolean;
  has: (feature: string) => boolean;
  can: (permission: ClinicPermission) => boolean;
}

function pepContext(user: CurrentUser, entitlements: ClinicEntitlements): PepContext {
  return {
    user,
    entitlements,
    hasCrm: entitlements.modules.includes("crm"),
    has: (f) => entitlements.features.includes(f),
    can: (p) => user.permissions.includes(p),
  };
}

/** Para páginas do Tropi Prontuário: login, módulo "pep" contratado e (opcional) permissão. */
export async function requirePep(permission?: ClinicPermission): Promise<PepContext> {
  const user = await requireUser();
  if (permission && !user.permissions.includes(permission)) redirect("/sem-permissao");
  const entitlements = await getEntitlements(user.clinicId);
  if (!entitlements.modules.includes("pep")) redirect("/modulos/pep");
  enterUserTimeZone(user);
  return pepContext(user, entitlements);
}

/** Para server actions e rotas do Prontuário: contexto ou null (sem redirecionar). */
export async function authorizePep(permission: ClinicPermission): Promise<PepContext | null> {
  const user = await getCurrentUser();
  if (!user || pendingStep(user) || !user.permissions.includes(permission)) return null;
  const entitlements = await getEntitlements(user.clinicId);
  if (!entitlements.modules.includes("pep")) return null;
  enterUserTimeZone(user);
  return pepContext(user, entitlements);
}
