"use server";

import { contactSchema } from "@ecosaude/core/crm/validation";
import {
  ACCESS_MODES,
  documentContentSchema,
  emergencyNoticeText,
  normalizeCidCode,
  parseVitals,
  shouldNoticeTriage,
  templateFieldsSchema,
  triageRecipients,
  urgentTriageNoticeText,
  VITALS,
  validateAnswers,
  type Answers,
  type Diagnosis,
  type DocumentContent,
  type TemplateField,
} from "@ecosaude/core/pep";
import { formatTime } from "@ecosaude/core/crm";
import { flattenErrors } from "@ecosaude/core/validation";
import { eq, inArray, schema, sql, withTenant, type Tx } from "@ecosaude/db";
import { TRIAGE_PRIORITIES, type Allergy, type MedicationInUse, type Problem, type TriagePriority } from "@ecosaude/db/schema-pep";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorizePep, type PepContext } from "@/lib/auth/dal";
import { field, formValues, NOT_ALLOWED, toActionError, UserError, type ActionState } from "@/lib/server";
import { findDuplicatesFor } from "@/modules/crm/duplicates";
import { logEvent } from "@/modules/crm/journey";
import { accessFor, audit } from "./access";
import { runCrm } from "@/modules/crm/run";
import { changeAppointmentStatus } from "@/modules/crm/scheduling";
import { createNotices, emergencyNoticeRecipients, sendEmergencyEmails } from "@/modules/notices";
import { addAddendum, finalizeEncounter, issueDocument, loadEncounter, revokeDocument, saveDraft, startEncounter, type EncounterRecord } from "./records";

/**
 * Ações do Tropi Prontuário. Toda ação confere, nesta ordem:
 *  1. login, módulo contratado e permissão (authorizePep)
 *  2. sigilo: a pessoa pode abrir o prontuário deste paciente (accessFor)
 *  3. autoria: só o profissional do atendimento edita, finaliza e emite documentos dele
 */

const pep = (ctx: PepContext) => <T>(fn: (tx: Tx) => Promise<T>) => withTenant(ctx.user.clinicId, fn);

async function assertAccess(tx: Tx, ctx: PepContext, contactId: string) {
  const { access } = await accessFor(tx, ctx, contactId);
  if (access === "negado") throw new UserError("Você não tem acesso ao prontuário deste paciente.");
  if (access === "emergencia") throw new UserError("Este prontuário pede acesso de emergência (com justificativa). Abra o prontuário do paciente para solicitar.");
}

/** O atendimento é desta pessoa? (profissional da agenda ligado ao usuário) */
function assertAuthor(ctx: PepContext, e: EncounterRecord) {
  if (e.professional.userId !== ctx.user.id) throw new UserError(`Este atendimento é de ${e.professional.name}. Só quem atende registra e assina; você pode incluir um adendo depois da finalização.`);
}

async function encounterFor(tx: Tx, ctx: PepContext, id: string) {
  const e = await loadEncounter(tx, id);
  if (!e) throw new UserError("Atendimento não encontrado.");
  await assertAccess(tx, ctx, e.contactId);
  return e;
}

function refresh(e: { id: string; contactId: string }) {
  revalidatePath(`/prontuario/atendimentos/${e.id}`);
  revalidatePath(`/prontuario/pacientes/${e.contactId}`);
  revalidatePath("/prontuario");
}

/* ------------------------------- Atendimento ------------------------------- */

export async function startEncounterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NOT_ALLOWED;
  const contactId = field(form, "contactId");
  const appointmentId = field(form, "appointmentId") || null;
  const templateId = field(form, "templateId") || null;
  if (!z.uuid().safeParse(contactId).success) return { ok: false, message: "Paciente inválido." };
  let id: string;
  try {
    id = await pep(ctx)(async (tx) => {
      await assertAccess(tx, ctx, contactId);
      return startEncounter(tx, ctx, { contactId, appointmentId, templateId });
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/prontuario");
  revalidatePath("/crm/agenda");
  redirect(`/prontuario/atendimentos/${id}`);
}

const draftSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  vitals: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  diagnoses: z
    .array(z.object({ code: z.string(), name: z.string().max(300), principal: z.boolean().optional() }))
    .max(12),
  conduct: z.string().max(20000).nullable(),
  returnDays: z.number().int().min(1).max(730).nullable(),
  returnNote: z.string().max(300).nullable(),
});
export type DraftPayload = z.infer<typeof draftSchema>;

export interface DraftResult {
  ok: boolean;
  message?: string;
  version?: number;
  errors?: Record<string, string>;
  savedAt?: string;
}

/** Normaliza o que veio da tela contra o modelo congelado no atendimento */
async function cleanDraft(tx: Tx, e: EncounterRecord, payload: DraftPayload, final: boolean) {
  const { answers, errors } = validateAnswers(e.templateFields, payload.answers as Answers, { final });
  const v = parseVitals(payload.vitals);
  Object.assign(errors, v.errors);
  // CIDs: só códigos que existem na tabela oficial
  const codes = [...new Set(payload.diagnoses.map((d) => normalizeCidCode(d.code)))];
  const valid = codes.length ? await tx.select({ code: schema.cid10.code, name: schema.cid10.name }).from(schema.cid10).where(inArray(schema.cid10.code, codes)) : [];
  const diagnoses: Diagnosis[] = valid.map((c, i) => ({ code: c.code, name: c.name, principal: payload.diagnoses.find((d) => normalizeCidCode(d.code) === c.code)?.principal ?? i === 0 }));
  if (codes.length !== valid.length) errors.diagnoses = "Algum CID não foi encontrado na tabela CID-10.";
  return {
    data: { answers, vitals: v.vitals, diagnoses, conduct: payload.conduct?.trim() || null, returnDays: payload.returnDays, returnNote: payload.returnNote?.trim() || null },
    errors,
  };
}

/** Salvamento automático do rascunho (chamado pela tela a cada pausa na digitação) */
export async function saveDraftAction(id: string, version: number, payload: DraftPayload): Promise<DraftResult> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return { ok: false, message: NOT_ALLOWED.message };
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  try {
    return await pep(ctx)(async (tx) => {
      const e = await encounterFor(tx, ctx, id);
      assertAuthor(ctx, e);
      const { data, errors } = await cleanDraft(tx, e, parsed.data, false);
      const next = await saveDraft(tx, id, version, data);
      return { ok: true, version: next, errors, savedAt: new Date().toISOString() };
    });
  } catch (e) {
    const r = toActionError(e);
    return { ok: false, message: r.message };
  }
}

export async function finalizeEncounterAction(id: string, version: number, payload: DraftPayload): Promise<DraftResult> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return { ok: false, message: NOT_ALLOWED.message };
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  let contactId = "";
  try {
    const result = await pep(ctx)(async (tx): Promise<DraftResult> => {
      const e = await encounterFor(tx, ctx, id);
      contactId = e.contactId;
      assertAuthor(ctx, e);
      const { data, errors } = await cleanDraft(tx, e, parsed.data, true);
      if (Object.keys(errors).length) return { ok: false, message: "Revise os campos marcados antes de finalizar.", errors };
      const hasContent = Object.keys(data.answers).length || data.conduct || data.diagnoses.length;
      if (!hasContent) return { ok: false, message: "O atendimento está vazio. Registre ao menos a anamnese, a conduta ou um diagnóstico." };
      const v = await saveDraft(tx, id, version, data);
      await finalizeEncounter(tx, ctx, { ...e, ...data, version: v });
      return { ok: true };
    });
    if (!result.ok) return result;
  } catch (e) {
    return { ok: false, message: toActionError(e).message };
  }
  refresh({ id, contactId });
  revalidatePath("/crm/agenda");
  revalidatePath("/crm/tarefas");
  return { ok: true, message: "Atendimento finalizado." };
}

/** Descarta um rascunho (nunca um finalizado: o banco também recusa) */
export async function discardDraftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  let contactId = "";
  try {
    await pep(ctx)(async (tx) => {
      const e = await encounterFor(tx, ctx, id);
      assertAuthor(ctx, e);
      if (e.status !== "rascunho") throw new UserError("Atendimento finalizado não pode ser descartado.");
      if (e.documents.length) throw new UserError("Este rascunho já tem documentos emitidos. Finalize o atendimento (os documentos fazem parte do registro).");
      contactId = e.contactId;
      await tx.delete(schema.pepEncounters).where(eq(schema.pepEncounters.id, id));
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/prontuario");
  redirect(`/prontuario/pacientes/${contactId}`);
}

export async function addAddendumAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  const text = field(form, "text").trim();
  if (text.length < 3) return { ok: false, errors: { text: "Escreva o adendo." } };
  if (text.length > 10000) return { ok: false, errors: { text: "Texto muito longo." } };
  let e: EncounterRecord | undefined;
  try {
    await pep(ctx)(async (tx) => {
      e = await encounterFor(tx, ctx, id);
      await addAddendum(tx, ctx, e, text);
    });
  } catch (err) {
    return toActionError(err);
  }
  refresh(e!);
  return { ok: true, message: "Adendo registrado." };
}

/* --------------------------------- Documentos -------------------------------- */

export async function issueDocumentAction(encounterId: string, content: DocumentContent): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NOT_ALLOWED;
  const parsed = documentContentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os dados do documento.", errors: flattenErrors(parsed.error) };
  let e: EncounterRecord | undefined;
  let out: { id: string; code: string };
  try {
    out = await pep(ctx)(async (tx) => {
      e = await encounterFor(tx, ctx, encounterId);
      assertAuthor(ctx, e);
      let c = parsed.data;
      if (c.kind === "atestado" && c.includeCid && c.cid) {
        const code = normalizeCidCode(c.cid);
        const [row] = await tx.select({ code: schema.cid10.code }).from(schema.cid10).where(eq(schema.cid10.code, code));
        if (!row) throw new UserError("CID não encontrado.");
        c = { ...c, cid: code };
      }
      if (c.kind === "atestado" && !c.includeCid) c = { ...c, cid: undefined };
      return issueDocument(tx, ctx, e, c);
    });
  } catch (err) {
    return toActionError(err);
  }
  refresh(e!);
  return { ok: true, message: "Documento emitido.", data: out };
}

export async function revokeDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  const reason = field(form, "reason").trim();
  if (reason.length < 5) return { ok: false, errors: { reason: "Diga o motivo (fica registrado)." } };
  let e: EncounterRecord | undefined;
  try {
    await pep(ctx)(async (tx) => {
      const [doc] = await tx.select().from(schema.pepDocuments).where(eq(schema.pepDocuments.id, id));
      if (!doc?.encounterId) throw new UserError("Documento não encontrado.");
      e = await encounterFor(tx, ctx, doc.encounterId);
      assertAuthor(ctx, e);
      await revokeDocument(tx, ctx, id, reason);
    });
  } catch (err) {
    return toActionError(err);
  }
  refresh(e!);
  return { ok: true, message: "Documento cancelado. A verificação pelo código passa a mostrar que ele não vale." };
}

/* ----------------------------- Resumo do paciente ----------------------------- */

const profileSchema = z.object({
  allergies: z.array(z.object({ name: z.string().trim().min(1).max(120), reaction: z.string().trim().max(200).optional(), severity: z.enum(["leve", "moderada", "grave"]).optional() })).max(40),
  noKnownAllergies: z.boolean(),
  medications: z.array(z.object({ name: z.string().trim().min(1).max(160), dose: z.string().trim().max(200).optional() })).max(60),
  problems: z.array(z.object({ name: z.string().trim().min(1).max(200), cid: z.string().max(8).optional(), since: z.string().max(20).optional(), active: z.boolean() })).max(60),
  history: z.string().max(20000).nullable(),
  version: z.number().int().min(0),
});

export async function saveProfileAction(contactId: string, payload: z.infer<typeof profileSchema>): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NOT_ALLOWED;
  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os dados." };
  const d = parsed.data;
  if (d.noKnownAllergies && d.allergies.length) return { ok: false, message: "Marque \"nega alergias\" só quando não houver nenhuma alergia na lista." };
  try {
    await pep(ctx)(async (tx) => {
      await assertAccess(tx, ctx, contactId);
      const values = {
        allergies: d.allergies as Allergy[],
        noKnownAllergies: d.noKnownAllergies,
        medications: d.medications as MedicationInUse[],
        problems: d.problems as Problem[],
        history: d.history?.trim() || null,
        updatedBy: ctx.user.id,
      };
      const [cur] = await tx.select({ version: schema.pepPatientProfiles.version }).from(schema.pepPatientProfiles).where(eq(schema.pepPatientProfiles.contactId, contactId));
      if (!cur) await tx.insert(schema.pepPatientProfiles).values({ contactId, ...values });
      else {
        if (cur.version !== d.version) throw new UserError("O resumo foi alterado por outra pessoa. Recarregue a página e refaça a alteração.");
        await tx
          .update(schema.pepPatientProfiles)
          .set({ ...values, version: cur.version + 1 })
          .where(eq(schema.pepPatientProfiles.contactId, contactId));
      }
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/prontuario/pacientes/${contactId}`);
  revalidatePath("/prontuario/atendimentos/[id]", "page");
  return { ok: true, message: "Resumo atualizado." };
}

/* ---------------------------- Acesso de emergência ---------------------------- */

export async function emergencyAccessAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.acesso_emergencia");
  if (!ctx) return NOT_ALLOWED;
  const contactId = field(form, "contactId");
  const reason = field(form, "reason").trim();
  if (reason.length < 10) return { ok: false, errors: { reason: "Explique o motivo (mínimo 10 caracteres). Fica registrado e a gestão é avisada." }, values: formValues(form) };
  if (!z.uuid().safeParse(contactId).success) return { ok: false, message: "Paciente inválido." };
  try {
    const auditId = await pep(ctx)(async (tx) => {
      const { access } = await accessFor(tx, ctx, contactId);
      if (access === "negado") throw new UserError("Você não tem acesso a prontuários.");
      const id = await audit(tx, ctx, { action: "emergencia", contactId, reason });
      // Aviso ativo, na mesma transação: a gestão do prontuário fica sabendo na hora (sino).
      // Se o aviso falhar, o acesso também não acontece (nada de acesso de emergência "silencioso").
      const [patient] = await tx.select({ name: schema.contacts.name }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
      const text = emergencyNoticeText({ actorName: ctx.user.name, patientName: patient?.name ?? "paciente", reason });
      const recipients = await emergencyNoticeRecipients(tx, ctx.user.id);
      await createNotices(tx, recipients.map((userId) => ({ ...text, userId, kind: "pep_emergencia", href: "/prontuario/ajustes", contactId, refId: id, urgent: true })));
      return id;
    });
    // E-mail opcional (sem dado do paciente), depois de responder a quem pediu o acesso
    after(() => sendEmergencyEmails(ctx.user.clinicId, auditId).catch((e) => console.error("[aviso emergência]", e)));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/prontuario/pacientes/${contactId}`);
  return { ok: true };
}

/* ------------------------------ Cópia do prontuário ------------------------------ */

/** Registra a entrega da cópia (o PDF sai pela rota /api/prontuario/pacientes/<id>/copia) */
export async function exportRecordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.exportar");
  if (!ctx) return NOT_ALLOWED;
  const contactId = field(form, "contactId");
  const reason = field(form, "reason").trim();
  if (reason.length < 5) return { ok: false, errors: { reason: "Informe o pedido (ex.: \"pedido do paciente em 21/10, protocolo 123\")." } };
  try {
    await pep(ctx)((tx) => audit(tx, ctx, { action: "exportar", contactId, reason }));
  } catch (err) {
    return toActionError(err);
  }
  return { ok: true, data: { url: `/api/prontuario/pacientes/${contactId}/copia` } };
}

/* -------------------------------- Novo paciente -------------------------------- */

/** Cadastro rápido pelo Prontuário (clínicas que não têm o Atendimento usam esta tela) */
export async function createPatientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NOT_ALLOWED;
  const parsed = contactSchema.safeParse({
    name: field(form, "name"),
    phone: field(form, "phone"),
    email: field(form, "email"),
    birthDate: field(form, "birthDate"),
    sex: field(form, "sex"),
    cpf: field(form, "cpf"),
    tags: "",
    consentMarketing: false,
  });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;
  let id: string;
  try {
    id = await pep(ctx)(async (tx) => {
      const dups = await findDuplicatesFor(tx, { name: d.name, phone: d.phone, email: d.email, birthDate: d.birthDate });
      if (dups.length && form.get("allowDuplicate") !== "on")
        throw new UserError(`Já existe um cadastro parecido: ${dups[0]!.name} (${dups[0]!.reasons.join(", ")}). Busque pelo nome ou confirme que é outra pessoa.`);
      const [c] = await tx
        .insert(schema.contacts)
        .values({ name: d.name, phone: d.phone ?? null, email: d.email ?? null, birthDate: d.birthDate ?? null, sex: d.sex ?? null, cpf: d.cpf ?? null, stage: "paciente", source: "prontuário", ownerId: ctx.user.id })
        .returning({ id: schema.contacts.id });
      if (ctx.hasCrm) await logEvent(tx, { contactId: c!.id, actorId: ctx.user.id, type: "contact_created", data: { origem: "prontuário" } });
      return c!.id;
    });
  } catch (err) {
    const r = toActionError(err);
    return { ...r, values: formValues(form), data: { duplicate: true } };
  }
  redirect(`/prontuario/pacientes/${id}`);
}

/* ---------------------------------- Modelos ---------------------------------- */

const templateSchema = z.object({
  id: z.uuid().nullable(),
  specialty: z.string().trim().min(2, "Especialidade").max(80),
  name: z.string().trim().min(2, "Nome do modelo").max(80),
  fields: templateFieldsSchema,
});

export async function saveTemplateAction(payload: { id: string | null; specialty: string; name: string; fields: TemplateField[] }): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.modelos");
  if (!ctx) return NOT_ALLOWED;
  const parsed = templateSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira o modelo.", errors: flattenErrors(parsed.error) };
  const d = parsed.data;
  let id = d.id;
  try {
    await pep(ctx)(async (tx) => {
      // Atendimentos antigos guardam a cópia dos campos: editar o modelo não muda o passado
      if (d.id) {
        const [row] = await tx.update(schema.pepTemplates).set({ specialty: d.specialty, name: d.name, fields: d.fields }).where(eq(schema.pepTemplates.id, d.id)).returning({ id: schema.pepTemplates.id });
        if (!row) throw new UserError("Modelo não encontrado.");
      } else {
        const [row] = await tx.insert(schema.pepTemplates).values({ specialty: d.specialty, name: d.name, fields: d.fields, createdBy: ctx.user.id }).returning({ id: schema.pepTemplates.id });
        id = row!.id;
      }
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/prontuario/modelos");
  return { ok: true, message: "Modelo salvo.", data: { id } };
}

export async function toggleTemplateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.modelos");
  if (!ctx) return NOT_ALLOWED;
  const id = field(form, "id");
  const active = field(form, "active") === "1";
  await pep(ctx)((tx) => tx.update(schema.pepTemplates).set({ active }).where(eq(schema.pepTemplates.id, id)));
  revalidatePath("/prontuario/modelos");
  return { ok: true, message: active ? "Modelo ativado." : "Modelo desativado (atendimentos antigos continuam iguais)." };
}

/* ---------------------------------- Ajustes ---------------------------------- */

export async function savePepSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.modelos");
  if (!ctx) return NOT_ALLOWED;
  const parsed = z
    .object({
      accessMode: z.enum(ACCESS_MODES),
      headerNote: z.string().trim().max(200),
      defaultReturnDays: z.union([z.literal(""), z.coerce.number().int().min(1, "De 1 a 730 dias").max(730, "De 1 a 730 dias")]),
    })
    .safeParse({ accessMode: field(form, "accessMode"), headerNote: field(form, "headerNote"), defaultReturnDays: field(form, "defaultReturnDays") });
  if (!parsed.success) return { ok: false, errors: flattenErrors(parsed.error), values: formValues(form) };
  const d = parsed.data;
  const values = {
    accessMode: d.accessMode,
    headerNote: d.headerNote || null,
    defaultReturnDays: d.defaultReturnDays === "" ? null : d.defaultReturnDays,
    // Caixa marcada = "on"; desmarcada = campo ausente
    emergencyEmail: field(form, "emergencyEmail") === "on",
    updatedBy: ctx.user.id,
  };
  await pep(ctx)((tx) => tx.insert(schema.pepSettings).values(values).onConflictDoUpdate({ target: schema.pepSettings.clinicId, set: values }));
  revalidatePath("/prontuario/ajustes");
  return { ok: true, message: "Ajustes salvos." };
}

/* --------------------------- Chegada pelo Consultório --------------------------- */

/**
 * "Chegou" (e "Desfazer chegada") no Consultório, para clínicas sem recepção.
 *
 * Mesmo efeito e mesmas travas da agenda (changeAppointmentStatus): status "compareceu",
 * hora de chegada, só a partir de 30 min antes do horário, controle de edição simultânea,
 * linha do tempo e automações (ex.: pesquisa de satisfação, se a clínica tem o Atendimento).
 *
 * Permissão: ver o Consultório + "Marcar e remarcar consultas" (agenda.editar), a mesma
 * que a agenda exige para marcar comparecimento. Funciona também em clínica só com Prontuário.
 */
export async function consultorioArrivalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.consultorio");
  if (!ctx) return NOT_ALLOWED;
  if (!ctx.can("agenda.editar")) return { ok: false, message: "Seu perfil não marca chegada (permissão \"Marcar e remarcar consultas\")." };
  const parsed = z
    .object({ id: z.uuid(), version: z.coerce.number().int().min(0), undo: z.enum(["0", "1"]) })
    .safeParse({ id: field(form, "id"), version: field(form, "version"), undo: field(form, "undo") || "0" });
  if (!parsed.success) return { ok: false, message: "Consulta inválida." };
  const { id, version } = parsed.data;
  const undo = parsed.data.undo === "1";

  // Confere a consulta antes de mudar: unidade da pessoa e, ao desfazer, nada clínico começado
  const check = async (tx: Tx) => {
    const [appt] = await tx
      .select({ unitId: schema.appointments.unitId, triage: schema.pepTriages.id, encounter: schema.pepEncounters.id, anonymizedAt: schema.contacts.anonymizedAt })
      .from(schema.appointments)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.appointments.contactId))
      .leftJoin(schema.pepTriages, eq(schema.pepTriages.appointmentId, schema.appointments.id))
      .leftJoin(schema.pepEncounters, eq(schema.pepEncounters.appointmentId, schema.appointments.id))
      .where(eq(schema.appointments.id, id));
    if (!appt) throw new UserError("Consulta não encontrada.");
    // Pessoa restrita a unidades: só marca chegada nas unidades dela (como na agenda e no Consultório)
    if (ctx.user.unitIds.length && (!appt.unitId || !ctx.user.unitIds.includes(appt.unitId))) throw new UserError("Esta consulta é de uma unidade fora do seu acesso.");
    if (appt.anonymizedAt) throw new UserError("Os dados deste paciente foram apagados a pedido dele (LGPD).");
    if (undo && (appt.triage || appt.encounter)) throw new UserError("A triagem ou o atendimento já começou: a chegada não pode ser desfeita por aqui.");
  };
  const input = { id, version, status: undo ? ("agendado" as const) : ("compareceu" as const) };

  try {
    if (ctx.hasCrm) {
      // Com o Atendimento: mesma execução da agenda (automações da clínica e envio da fila)
      await runCrm(ctx, async (tx, scope) => {
        await check(tx);
        return changeAppointmentStatus(tx, scope, input);
      }, { dispatch: true });
    } else {
      // Só Prontuário: sem automações de mensagens (has() devolve falso para os recursos do Atendimento)
      await pep(ctx)(async (tx) => {
        await check(tx);
        return changeAppointmentStatus(tx, { clinicId: ctx.user.clinicId, clinicName: ctx.user.clinicName, actorId: ctx.user.id, has: () => false }, input);
      });
    }
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/consultorio");
  revalidatePath("/crm/agenda");
  revalidatePath("/hoje");
  return { ok: true, message: undo ? "Chegada desfeita." : "Chegada registrada." };
}

/* ---------------------------------- Triagem ---------------------------------- */

/**
 * Pré-consulta (enfermagem, técnico ou o próprio profissional): queixa, sinais vitais e
 * prioridade. Uma por consulta (salvar de novo corrige). Fazer a triagem marca a chegada.
 * Depois que o atendimento é finalizado, a triagem não muda mais (faz parte do registro).
 */
export async function saveTriageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await authorizePep("prontuario.triagem");
  if (!ctx) return NOT_ALLOWED;
  const appointmentId = field(form, "appointmentId");
  const priority = field(form, "priority") || "normal";
  if (!z.uuid().safeParse(appointmentId).success) return { ok: false, message: "Consulta inválida." };
  if (!TRIAGE_PRIORITIES.includes(priority as never)) return { ok: false, message: "Prioridade inválida." };
  const raw = Object.fromEntries(VITALS.map((v) => [v.id, field(form, `v_${v.id}`)]));
  const { vitals, errors } = parseVitals(raw);
  const complaint = field(form, "complaint").trim().slice(0, 500) || null;
  const notes = field(form, "notes").trim().slice(0, 2000) || null;
  if (Object.keys(errors).length) return { ok: false, errors, message: "Confira os sinais vitais marcados.", values: formValues(form) };
  if (!complaint && !Object.keys(vitals).length) return { ok: false, message: "Registre a queixa ou ao menos um sinal vital.", values: formValues(form) };
  try {
    await pep(ctx)(async (tx) => {
      const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
      if (!appt || appt.status === "cancelado" || appt.status === "faltou") throw new UserError("Consulta não encontrada, cancelada ou com falta registrada.");
      const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, appt.contactId), columns: { anonymizedAt: true } });
      if (contact?.anonymizedAt) throw new UserError("Os dados deste paciente foram apagados a pedido dele (LGPD).");
      const [enc] = await tx.select({ status: schema.pepEncounters.status }).from(schema.pepEncounters).where(eq(schema.pepEncounters.appointmentId, appointmentId));
      if (enc?.status === "finalizado") throw new UserError("O atendimento desta consulta já foi finalizado: a triagem faz parte do registro e não muda mais.");
      // Prioridade anterior (para avisar só quando PASSA a ser urgente)
      const [before] = await tx.select({ priority: schema.pepTriages.priority }).from(schema.pepTriages).where(eq(schema.pepTriages.appointmentId, appointmentId));
      const values = { contactId: appt.contactId, appointmentId, complaint, vitals, priority: priority as TriagePriority, notes, recordedBy: ctx.user.id, recordedByName: ctx.user.name };
      await tx.insert(schema.pepTriages).values(values).onConflictDoUpdate({ target: schema.pepTriages.appointmentId, targetWhere: sql`${schema.pepTriages.appointmentId} is not null`, set: values });
      // Atendimento já aberto (rascunho) e sem sinais vitais: recebe os da triagem
      if (enc?.status === "rascunho" && Object.keys(vitals).length)
        await tx.execute(sql`update pep_encounters set vitals = ${JSON.stringify(vitals)}::jsonb where appointment_id = ${appointmentId} and status = 'rascunho' and vitals = '{}'::jsonb`);
      // Triagem = paciente chegou
      if (appt.status === "agendado" || appt.status === "confirmado")
        await tx.update(schema.appointments).set({ status: "compareceu", arrivedAt: appt.arrivedAt ?? new Date(), version: sql`${schema.appointments.version} + 1` }).where(eq(schema.appointments.id, appointmentId));
      const auditId = await audit(tx, ctx, { action: "triagem", contactId: appt.contactId, reason: priority === "normal" ? null : `prioridade ${priority}` });
      // Triagem urgente: aviso ativo para o profissional da consulta (sino + destaque no Consultório)
      if (shouldNoticeTriage(before?.priority, priority)) {
        const [pro] = await tx
          .select({ userId: schema.clinicUsers.id, active: schema.clinicUsers.active, patient: schema.contacts.name })
          .from(schema.professionals)
          .innerJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.professionals.userId))
          .innerJoin(schema.contacts, eq(schema.contacts.id, appt.contactId))
          .where(eq(schema.professionals.id, appt.professionalId));
        const recipients = triageRecipients(pro ? { id: pro.userId, active: pro.active } : null, ctx.user.id);
        const text = urgentTriageNoticeText({ patientName: pro?.patient ?? "Paciente", time: formatTime(appt.startsAt), complaint, recordedByName: ctx.user.name });
        await createNotices(tx, recipients.map((userId) => ({ ...text, userId, kind: "triagem_urgente", href: "/consultorio", contactId: appt.contactId, refId: auditId, urgent: true })));
      }
    });
  } catch (err) {
    return { ...toActionError(err), values: formValues(form) };
  }
  revalidatePath("/consultorio");
  revalidatePath("/crm/agenda");
  return { ok: true, message: "Triagem registrada." };
}
