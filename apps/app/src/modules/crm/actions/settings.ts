"use server";

import { temporaryPassword } from "@ecosaude/auth/crypto";
import { hasRealCredentials } from "@ecosaude/channels";
import { CHANNEL_MODES, CHANNELS, CRM_FEATURES, isBrTimeZone, timeZoneLabel } from "@ecosaude/core/crm";
import { clinicStaffSchema, quickReplySchema, returnProtocolSchema } from "@ecosaude/core/crm/validation";
import { flattenErrors } from "@ecosaude/core/validation";
import { and, db, eq, forgetClinicTimeZone, ne, schema, sql } from "@ecosaude/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCrm } from "@/lib/auth/dal";
import { revokeOpenResets } from "@/lib/auth/recovery-core";
import { destroyUserSessions } from "@/lib/auth/session";
import { field, formValues, isScheduleConflict, isUniqueViolation, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { mineQuickReplies } from "../ai/quick-replies";
import { logEvent } from "../journey";
import { assertAdminRemains, assertCanAssign, roleById } from "../permissions";
import { runCrm } from "../run";

/**
 * AJUSTES DA CLÍNICA: respostas rápidas, protocolos de retorno, equipe e canais.
 * Tudo roda isolado na clínica de quem está logado (RLS no banco).
 */

/* ----------------------------- Respostas rápidas ---------------------------- */

export async function saveQuickReplyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.respostas");
  if (!ctx) return NOT_ALLOWED;
  const parsed = quickReplySchema.safeParse({
    id: field(form, "id"),
    shortcut: field(form, "shortcut").replace(/^\//, ""),
    title: field(form, "title"),
    body: field(form, "body"),
    approvedTemplate: form.get("approvedTemplate") === "on",
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { id, ...d } = parsed.data;
  try {
    await runCrm(ctx, async (tx, scope) => {
      // Atalho repetido confundiria o menu "/"
      const [dup] = await tx
        .select({ id: schema.quickReplies.id })
        .from(schema.quickReplies)
        .where(and(eq(schema.quickReplies.shortcut, d.shortcut), id ? ne(schema.quickReplies.id, id) : undefined));
      if (dup) throw new UserError(`O atalho /${d.shortcut} já existe.`);
      if (id) await tx.update(schema.quickReplies).set(d).where(eq(schema.quickReplies.id, id));
      else await tx.insert(schema.quickReplies).values(d);
      // Veio de uma sugestão da IA: marca como aceita (não sugere de novo)
      const sid = z.uuid().safeParse(field(form, "suggestionId"));
      if (!id && sid.success) {
        await tx
          .update(schema.quickReplySuggestions)
          .set({ status: "aceita", decidedBy: scope.actorId, decidedAt: new Date() })
          .where(and(eq(schema.quickReplySuggestions.id, sid.data), eq(schema.quickReplySuggestions.status, "pendente")));
        await logEvent(tx, { actorId: scope.actorId, type: "quick_reply_suggestion", data: { atalho: d.shortcut, decisao: "aceita" } });
      }
    });
  } catch (error) {
    return { ...toActionError(error), values: formValues(form) };
  }
  revalidatePath("/configuracoes/respostas");
  return { ok: true, message: id ? "Resposta atualizada." : "Resposta criada." };
}

export async function deleteQuickReplyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.respostas");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  await runCrm(ctx, (tx) => tx.delete(schema.quickReplies).where(eq(schema.quickReplies.id, id.data)));
  revalidatePath("/configuracoes/respostas");
  return { ok: true, message: "Resposta excluída." };
}

/** Sugestão de resposta rápida descartada: não volta a aparecer. */
export async function dismissQuickReplySuggestionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.respostas");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  await runCrm(ctx, async (tx, scope) => {
    const [s] = await tx
      .update(schema.quickReplySuggestions)
      .set({ status: "descartada", decidedBy: scope.actorId, decidedAt: new Date() })
      .where(and(eq(schema.quickReplySuggestions.id, id.data), eq(schema.quickReplySuggestions.status, "pendente")))
      .returning({ shortcut: schema.quickReplySuggestions.shortcut });
    if (s) await logEvent(tx, { actorId: scope.actorId, type: "quick_reply_suggestion", data: { atalho: s.shortcut, decisao: "descartada" } });
  });
  revalidatePath("/configuracoes/respostas");
  return { ok: true, message: "Sugestão descartada." };
}

/** "Procurar agora": busca as repetições sem esperar a semana. */
export async function mineQuickRepliesAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.respostas");
  if (!ctx) return NOT_ALLOWED;
  try {
    const r = await mineQuickReplies(ctx.user.clinicId, { force: true, actorId: ctx.user.id });
    if (!r) return { ok: false, message: "“Respostas rápidas sugeridas” está desligada em Ajustes > Inteligência artificial." };
    revalidatePath("/configuracoes/respostas");
    if (!r.found) return { ok: true, message: "Nenhuma repetição nova. A equipe ainda não repetiu textos o suficiente (ou já viraram atalho)." };
    // Conta o que virou sugestão de fato (a IA pode descartar texto pessoal, ex.: "seu exame ficou pronto")
    const dropped = r.found - r.saved;
    const head = r.saved ? `${r.saved} ${r.saved === 1 ? "texto repetido virou sugestão" : "textos repetidos viraram sugestão"}` : "Nenhuma sugestão nova";
    const tail = dropped > 0 ? `; ${dropped} ${dropped === 1 ? "foi deixado de fora por ser específico de um paciente" : "foram deixados de fora por serem específicos de um paciente"}` : "";
    return { ok: true, message: `${head}${tail}${r.source === "regras" && r.reason ? ` (sem IA: ${r.reason})` : ""}.` };
  } catch (error) {
    console.error("[respostas sugeridas]", error);
    return { ok: false, message: "Não foi possível procurar agora." };
  }
}

/* ---------------------------- Protocolos de retorno -------------------------- */

export async function saveReturnProtocolAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("retornos.protocolos", CRM_FEATURES.campaigns);
  if (!ctx) return NOT_ALLOWED;
  const parsed = returnProtocolSchema.safeParse({
    id: field(form, "id"),
    name: field(form, "name"),
    serviceMatch: field(form, "serviceMatch"),
    daysAfter: field(form, "daysAfter"),
    message: field(form, "message"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { id, ...d } = parsed.data;
  const values = { ...d, serviceMatch: d.serviceMatch ?? null };
  await runCrm(ctx, (tx) => (id ? tx.update(schema.returnProtocols).set(values).where(eq(schema.returnProtocols.id, id)) : tx.insert(schema.returnProtocols).values(values)));
  revalidatePath("/crm/retornos");
  return { ok: true, message: id ? "Protocolo atualizado." : "Protocolo criado." };
}

/* ----------------------------------- Equipe ---------------------------------- */

/**
 * O gestor cadastra a equipe. A pessoa recebe uma SENHA TEMPORÁRIA (mostrada
 * uma única vez) e é obrigada a trocá-la no primeiro acesso.
 */
export async function createClinicUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.equipe");
  if (!ctx) return NOT_ALLOWED;
  const parsed = clinicStaffSchema.safeParse({ name: field(form, "name"), email: field(form, "email").toLowerCase(), roleId: field(form, "roleId") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const password = temporaryPassword();
  try {
    await runCrm(ctx, async (tx, scope) => {
      const role = await roleById(tx, parsed.data.roleId);
      assertCanAssign(ctx.user.permissions, role);
      await tx.insert(schema.clinicUsers).values({
        name: parsed.data.name,
        email: parsed.data.email,
        role: role.base,
        roleId: role.id,
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      });
      await logEvent(tx, { actorId: scope.actorId, type: "user_created", data: { email: parsed.data.email, perfil: role.base, perfilNome: role.name } });
    });
  } catch (error) {
    // O e-mail é único em todas as clínicas (o login descobre a clínica pelo e-mail)
    if (isUniqueViolation(error)) return { ok: false, errors: { email: "Este e-mail já tem acesso ao EcoSaúde. Use outro." }, values: formValues(form) };
    return { ...toActionError(error), values: formValues(form) };
  }
  revalidatePath("/configuracoes/equipe");
  return { ok: true, message: `Acesso criado para ${parsed.data.name}.`, secret: password };
}

export async function resetClinicUserPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.equipe");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  if (id.data === ctx.user.id) return { ok: false, message: "Para a sua própria senha, use Minha conta." };
  const password = temporaryPassword();
  const found = await runCrm(ctx, async (tx, scope) => {
    // RLS: só encontra usuários da própria clínica
    const rows = await tx
      .update(schema.clinicUsers)
      .set({ passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, failedLogins: 0, lockedUntil: null })
      .where(eq(schema.clinicUsers.id, id.data))
      .returning({ id: schema.clinicUsers.id });
    if (rows.length) await logEvent(tx, { actorId: scope.actorId, type: "user_password_reset", data: { userId: id.data } });
    return rows.length > 0;
  });
  if (!found) return { ok: false, message: "Usuário não encontrado." };
  // Derruba as sessões abertas dessa pessoa e cancela links de "esqueci a senha" pendentes
  // (essas tabelas ficam fora do papel da clínica)
  await destroyUserSessions(id.data);
  await revokeOpenResets(id.data);
  revalidatePath("/configuracoes/equipe");
  return { ok: true, message: "Nova senha temporária gerada.", secret: password };
}

export async function toggleClinicUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.equipe");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  if (id.data === ctx.user.id) return { ok: false, message: "Você não pode desativar o próprio acesso." };
  const active = field(form, "active") === "true";
  try {
    await runCrm(ctx, async (tx, scope) => {
      const rows = await tx.update(schema.clinicUsers).set({ active }).where(eq(schema.clinicUsers.id, id.data)).returning({ id: schema.clinicUsers.id });
      if (rows.length === 0) throw new UserError("Usuário não encontrado.");
      // Nunca deixar a clínica sem ninguém que administre a equipe e as permissões
      if (!active) await assertAdminRemains(tx);
      await logEvent(tx, { actorId: scope.actorId, type: active ? "user_enabled" : "user_disabled", data: { userId: id.data } });
    });
  } catch (error) {
    return toActionError(error);
  }
  if (!active) {
    await destroyUserSessions(id.data);
    await revokeOpenResets(id.data);
  }
  revalidatePath("/configuracoes/equipe");
  return { ok: true, message: active ? "Acesso reativado." : "Acesso desativado." };
}

/* ----------------------------------- Canais ---------------------------------- */

const channelSchema = z.object({
  channel: z.enum(CHANNELS),
  mode: z.enum(CHANNEL_MODES),
  active: z.boolean(),
  displayName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  externalAccountId: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
});

/**
 * Configura um canal. O modo REAL só é aceito quando o servidor tem a
 * credencial do canal e a clínica informou o identificador da conta
 * (número, página, bot). Sem isso, continua em simulação.
 */
export async function saveChannelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.canais");
  if (!ctx) return NOT_ALLOWED;
  const parsed = channelSchema.safeParse({
    channel: field(form, "channel"),
    mode: field(form, "mode"),
    active: form.get("active") === "on",
    displayName: field(form, "displayName"),
    externalAccountId: field(form, "externalAccountId"),
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;
  if (d.mode === "real") {
    if (!hasRealCredentials(d.channel)) return { ok: false, message: "O servidor ainda não tem a credencial deste canal. Veja o passo a passo abaixo." };
    if (!d.externalAccountId) return { ok: false, errors: { externalAccountId: "Informe o identificador da conta para o modo real." } };
  }
  try {
    await runCrm(ctx, async (tx, scope) => {
      await tx
        .insert(schema.channelConnections)
        .values(d)
        .onConflictDoUpdate({ target: [schema.channelConnections.clinicId, schema.channelConnections.channel], set: { ...d, updatedAt: new Date() } });
      await logEvent(tx, { actorId: scope.actorId, type: "channel_updated", data: { canal: d.channel, modo: d.mode, ativo: d.active } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, errors: { externalAccountId: "Esta conta já está ligada a outra clínica." } };
    return toActionError(error);
  }
  revalidatePath("/configuracoes/canais");
  revalidatePath("/", "layout");
  return { ok: true, message: "Canal salvo." };
}

/** Editar nome e perfil de alguém da equipe (a clínica nunca fica sem administração). */
export async function updateClinicUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.equipe");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({ id: z.uuid(), name: z.string().trim().min(2, "Informe o nome.").max(120), roleId: z.uuid({ error: "Escolha o perfil." }) })
    .safeParse({ id: field(form, "id"), name: field(form, "name"), roleId: field(form, "roleId") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;
  try {
    await runCrm(ctx, async (tx, scope) => {
      const target = await tx.query.clinicUsers.findFirst({ where: eq(schema.clinicUsers.id, d.id), columns: { roleId: true } });
      if (!target) throw new UserError("Usuário não encontrado.");
      const role = await roleById(tx, d.roleId);
      const changingRole = target.roleId !== role.id;
      if (changingRole && d.id === ctx.user.id) throw new UserError("Você não pode mudar o próprio perfil. Peça a outra pessoa da gestão.");
      if (changingRole) assertCanAssign(ctx.user.permissions, role);
      await tx.update(schema.clinicUsers).set({ name: d.name, roleId: role.id, role: role.base }).where(eq(schema.clinicUsers.id, d.id));
      await assertAdminRemains(tx);
      await logEvent(tx, { actorId: scope.actorId, type: "user_updated", data: { userId: d.id, perfil: role.base, perfilNome: role.name } });
    });
  } catch (error) {
    return { ...toActionError(error), values: formValues(form) };
  }
  // As permissões são lidas a cada requisição: valem já na próxima tela aberta pela pessoa
  revalidatePath("/configuracoes/equipe");
  return { ok: true, message: "Dados atualizados." };
}

/**
 * Perdeu o celular da verificação em duas etapas? O gestor desliga a 2FA da
 * pessoa, que entra só com a senha e pode ativar de novo em Minha conta.
 */
export async function resetClinicUserTwoFactorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.equipe");
  if (!ctx) return NOT_ALLOWED;
  const id = z.uuid().safeParse(field(form, "id"));
  if (!id.success) return { ok: false, message: "Inválido." };
  if (id.data === ctx.user.id) return { ok: false, message: "Para a sua própria conta, use Minha conta." };
  const found = await runCrm(ctx, async (tx, scope) => {
    const rows = await tx
      .update(schema.clinicUsers)
      .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null })
      .where(eq(schema.clinicUsers.id, id.data))
      .returning({ id: schema.clinicUsers.id });
    if (rows.length) await logEvent(tx, { actorId: scope.actorId, type: "user_2fa_reset", data: { userId: id.data } });
    return rows.length > 0;
  });
  if (!found) return { ok: false, message: "Usuário não encontrado." };
  await destroyUserSessions(id.data);
  revalidatePath("/configuracoes/equipe");
  return { ok: true, message: "Verificação em duas etapas desligada. A pessoa entra só com a senha e pode ativar de novo." };
}

/* ------------------------------ Dados da clínica ----------------------------- */

const clinicProfileSchema = z.object({
  tradeName: z.string().trim().min(2, "Informe o nome da clínica.").max(120),
  phone: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Telefone com DDD, ex.: (51) 3333-4444.")
    .transform((v) => v || null),
  email: z.union([z.email("E-mail inválido."), z.literal("")]).transform((v) => v || null),
  city: z
    .string()
    .trim()
    .max(80)
    .transform((v) => v || null),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "Use a sigla, ex.: RS.")
    .transform((v) => v || null),
  timeZone: z.string().refine(isBrTimeZone, "Escolha o fuso horário da clínica."),
  /** Ao trocar o fuso: consultas futuras mantêm o horário de relógio (14:00 continua 14:00) */
  keepWallClock: z.boolean(),
});

/**
 * Nome, telefone, e-mail e cidade da clínica (aparecem nas mensagens: {{clinica}}).
 * Razão social e CNPJ ficam com o suporte (contrato). A tabela de clínicas é da
 * plataforma (fora do isolamento por clínica): o filtro pelo id da sessão é
 * obrigatório e a mudança fica registrada na trilha da clínica.
 */
export async function updateClinicProfileAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizeCrm("config.clinica");
  if (!ctx) return NOT_ALLOWED;
  const parsed = clinicProfileSchema.safeParse({
    tradeName: field(form, "tradeName") ?? "",
    phone: field(form, "phone") ?? "",
    email: field(form, "email") ?? "",
    city: field(form, "city") ?? "",
    state: field(form, "state") ?? "",
    timeZone: field(form, "timeZone") ?? "",
    keepWallClock: field(form, "keepWallClock") === "on",
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const { keepWallClock, ...data } = parsed.data;
  const clinicId = ctx.user.clinicId;
  const oldTz = ctx.user.clinicTimeZone;
  const tzChanged = data.timeZone !== oldTz;

  // Uma transação só: dados da clínica + (se pedido) consultas futuras no novo fuso.
  // Por que mexer nas consultas: até hoje elas foram marcadas pensando no fuso antigo.
  // Ex.: clínica em Manaus que usava Brasília marcou "14:00" (= 14h de Brasília).
  // Mantendo o relógio, ela continua às 14:00, agora 14h de Manaus.
  let moved: number;
  try {
    moved = await db.transaction(async (tx) => {
      await tx.update(schema.clinics).set(data).where(eq(schema.clinics.id, clinicId));
      if (!tzChanged || !keepWallClock) return 0;
      const r = await tx.execute(sql`
      update appointments
         set starts_at = (starts_at at time zone ${oldTz}) at time zone ${data.timeZone},
             ends_at = (ends_at at time zone ${oldTz}) at time zone ${data.timeZone}
       where clinic_id = ${clinicId}
         and starts_at > now()
         and status in ('agendado', 'confirmado')`);
      return r.rowCount ?? 0;
    });
  } catch (error) {
    // Raríssimo: uma consulta ajustada encostaria numa consulta em andamento do mesmo profissional
    if (isScheduleConflict(error))
      return {
        ok: false,
        message: "Não deu para manter o horário de todas as consultas: uma delas bateria com outra já em andamento. Nada foi alterado. Desmarque o ajuste das consultas ou fale com o suporte.",
      };
    throw error;
  }
  // O novo fuso vale já nesta e nas próximas requisições
  forgetClinicTimeZone(clinicId);
  // Registro na trilha da clínica (aparece em Ajustes > Segurança e atividade)
  await runCrm(ctx, (tx, scope) =>
    logEvent(tx, {
      actorId: scope.actorId,
      type: "clinic.profile_updated",
      data: { nome: data.tradeName, ...(tzChanged ? { fusoAntes: oldTz, fusoDepois: data.timeZone, consultasAjustadas: moved } : {}) },
    }),
  );
  revalidatePath("/", "layout");
  if (!tzChanged) return { ok: true, message: "Dados da clínica salvos." };
  return {
    ok: true,
    message: `Fuso trocado para ${timeZoneLabel(data.timeZone)}.${keepWallClock ? ` ${moved} ${moved === 1 ? "consulta futura manteve" : "consultas futuras mantiveram"} o horário de relógio.` : " As consultas já marcadas mantêm o mesmo instante."}`,
  };
}
