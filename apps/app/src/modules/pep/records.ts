import "server-only";
import { addDaysIso, clinicTimeZone, formatAddress, todayIso } from "@ecosaude/core/crm";
import { ageYears, BUILT_IN_TEMPLATES, DOCUMENT_KIND_LABEL, type Answers, type Diagnosis, type DocumentContent, type Vitals } from "@ecosaude/core/pep";
import { contentHash, verificationCode } from "@ecosaude/core/pep/server";
import { and, asc, desc, eq, inArray, isNull, schema, sql, type Tx } from "@ecosaude/db";
import type { DocumentHeader } from "@ecosaude/db/schema-pep";
import { randomBytes } from "node:crypto";
import type { PepContext } from "@/lib/auth/dal";
import { UserError } from "@/lib/server";
import { logEvent } from "@/modules/crm/journey";
import { placeFor } from "@/modules/crm/units";
import { audit, loadPepSettings, professionalOfUser } from "./access";

/**
 * REGRAS DO ATENDIMENTO CLÍNICO (servidor). Cada função recebe a transação já isolada
 * na clínica (withTenant); as server actions cuidam de permissão e sigilo antes.
 */

/* --------------------------------- Modelos --------------------------------- */

/** Garante que a clínica tem os modelos prontos do Tropi (uma vez; a clínica pode editar a cópia) */
export async function ensureBuiltInTemplates(tx: Tx): Promise<void> {
  const existing = await tx.select({ key: schema.pepTemplates.systemKey }).from(schema.pepTemplates).where(sql`${schema.pepTemplates.systemKey} is not null`);
  const have = new Set(existing.map((e) => e.key));
  const missing = BUILT_IN_TEMPLATES.filter((t) => !have.has(t.key));
  if (missing.length) await tx.insert(schema.pepTemplates).values(missing.map((t) => ({ specialty: t.specialty, name: t.name, fields: t.fields, systemKey: t.key }))).onConflictDoNothing();
}

export async function activeTemplates(tx: Tx) {
  await ensureBuiltInTemplates(tx);
  return tx.select().from(schema.pepTemplates).where(eq(schema.pepTemplates.active, true)).orderBy(asc(schema.pepTemplates.specialty), asc(schema.pepTemplates.name));
}

/* ------------------------------ Paciente (ficha) ------------------------------ */

export async function loadPatient(tx: Tx, contactId: string) {
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) });
  if (!contact) return null;
  const [profile] = await tx.select().from(schema.pepPatientProfiles).where(eq(schema.pepPatientProfiles.contactId, contactId));
  // Dados apagados a pedido do titular (LGPD): a identificação vem da cópia guardada no prontuário
  const snap = contact.anonymizedAt ? profile?.identitySnapshot : null;
  const identity = {
    name: snap?.name ?? contact.name,
    birthDate: snap?.birthDate ?? contact.birthDate,
    sex: (snap?.sex ?? contact.sex) as "F" | "M" | null,
    cpf: snap?.cpf ?? contact.cpf,
  };
  return {
    contact,
    identity,
    age: ageYears(identity.birthDate),
    anonymized: !!contact.anonymizedAt,
    profile: {
      allergies: profile?.allergies ?? [],
      noKnownAllergies: profile?.noKnownAllergies ?? false,
      medications: profile?.medications ?? [],
      problems: profile?.problems ?? [],
      history: profile?.history ?? null,
      version: profile?.version ?? 0,
      updatedAt: profile?.updatedAt ?? null,
    },
  };
}
export type PatientRecord = NonNullable<Awaited<ReturnType<typeof loadPatient>>>;

/** Linha do tempo clínica: atendimentos (com adendos) e documentos, do mais recente ao mais antigo */
export async function loadTimeline(tx: Tx, contactId: string) {
  const encounters = await tx
    .select({
      e: schema.pepEncounters,
      professional: schema.professionals.name,
      specialty: schema.professionals.specialty,
    })
    .from(schema.pepEncounters)
    .innerJoin(schema.professionals, eq(schema.professionals.id, schema.pepEncounters.professionalId))
    .where(eq(schema.pepEncounters.contactId, contactId))
    .orderBy(desc(schema.pepEncounters.startedAt));
  const ids = encounters.map((r) => r.e.id);
  const addenda = ids.length ? await tx.select().from(schema.pepAddenda).where(inArray(schema.pepAddenda.encounterId, ids)).orderBy(asc(schema.pepAddenda.createdAt)) : [];
  const documents = await tx
    .select({ d: schema.pepDocuments })
    .from(schema.pepDocuments)
    .where(eq(schema.pepDocuments.contactId, contactId))
    .orderBy(desc(schema.pepDocuments.issuedAt));
  return {
    encounters: encounters.map((r) => ({ ...r.e, professional: r.professional, specialty: r.specialty, addenda: addenda.filter((a) => a.encounterId === r.e.id) })),
    documents: documents.map((r) => r.d),
  };
}

/* ------------------------------- Atendimento ------------------------------- */

/**
 * Abre o atendimento. Vindo da agenda, reaproveita o atendimento já aberto daquela consulta
 * (clicar duas vezes não cria dois). O profissional é o ligado ao usuário; se o usuário não
 * é profissional, usa o da consulta.
 */
export async function startEncounter(tx: Tx, ctx: PepContext, input: { contactId: string; appointmentId?: string | null; templateId?: string | null }): Promise<string> {
  if (input.appointmentId) {
    const [existing] = await tx.select({ id: schema.pepEncounters.id }).from(schema.pepEncounters).where(eq(schema.pepEncounters.appointmentId, input.appointmentId));
    if (existing) return existing.id;
  }
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, input.contactId), columns: { id: true, anonymizedAt: true } });
  if (!contact) throw new UserError("Paciente não encontrado.");
  if (contact.anonymizedAt) throw new UserError("Os dados deste paciente foram apagados a pedido dele (LGPD). O prontuário antigo continua disponível para consulta, mas não recebe novos atendimentos.");

  let appointment: typeof schema.appointments.$inferSelect | undefined;
  if (input.appointmentId) {
    appointment = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId) });
    if (!appointment || appointment.contactId !== input.contactId) throw new UserError("Consulta não encontrada.");
    if (appointment.status === "cancelado") throw new UserError("Esta consulta foi cancelada.");
  }
  // O atendimento é SEMPRE de quem atende: o profissional da agenda ligado ao usuário (o registro
  // no conselho dele vai nos documentos). Ninguém abre atendimento em nome de outro profissional.
  const pro = await professionalOfUser(tx, ctx.user.id);
  if (!pro) throw new UserError("Seu acesso não está ligado a um profissional da agenda. Peça à gestão: Ajustes > Clínica > Profissionais > Acesso. Para registrar só a pré-consulta, use a triagem.");
  const professionalId = pro.id;
  // Unidade: a da consulta; atendimento avulso, a do horário da semana do profissional agora
  const unitId = appointment?.unitId ?? (await placeFor(tx, pro, new Date(), new Date(Date.now() + pro.slotMinutes * 60_000))).unitId;

  // Triagem feita antes (enfermagem): os sinais vitais já entram no atendimento
  const [triage] = appointment ? await tx.select({ vitals: schema.pepTriages.vitals }).from(schema.pepTriages).where(eq(schema.pepTriages.appointmentId, appointment.id)) : [];

  const templates = await activeTemplates(tx);
  // Modelo: o escolhido; senão "retorno" se o paciente já tem atendimento, senão "primeira consulta"
  let template = templates.find((t) => t.id === input.templateId);
  if (!template) {
    const [prev] = await tx.select({ id: schema.pepEncounters.id }).from(schema.pepEncounters).where(eq(schema.pepEncounters.contactId, input.contactId)).limit(1);
    template = templates.find((t) => t.systemKey === (prev ? "clinica_geral_retorno" : "clinica_geral_primeira")) ?? templates[0];
  }
  const [row] = await tx
    .insert(schema.pepEncounters)
    .values({
      contactId: input.contactId,
      professionalId,
      appointmentId: appointment?.id ?? null,
      unitId,
      templateId: template?.id ?? null,
      templateName: template?.name ?? null,
      templateFields: template?.fields ?? [],
      vitals: triage?.vitals ?? {},
      createdBy: ctx.user.id,
    })
    .returning({ id: schema.pepEncounters.id });

  // Paciente chegou (se a recepção ainda não marcou)
  if (appointment && (appointment.status === "agendado" || appointment.status === "confirmado")) {
    await tx
      .update(schema.appointments)
      .set({ status: "compareceu", arrivedAt: appointment.arrivedAt ?? new Date(), version: sql`${schema.appointments.version} + 1` })
      .where(eq(schema.appointments.id, appointment.id));
  }
  return row!.id;
}

export async function loadEncounter(tx: Tx, id: string) {
  const [row] = await tx
    .select({ e: schema.pepEncounters, professional: schema.professionals })
    .from(schema.pepEncounters)
    .innerJoin(schema.professionals, eq(schema.professionals.id, schema.pepEncounters.professionalId))
    .where(eq(schema.pepEncounters.id, id));
  if (!row) return null;
  const addenda = await tx.select().from(schema.pepAddenda).where(eq(schema.pepAddenda.encounterId, id)).orderBy(asc(schema.pepAddenda.createdAt));
  const documents = await tx.select().from(schema.pepDocuments).where(eq(schema.pepDocuments.encounterId, id)).orderBy(asc(schema.pepDocuments.issuedAt));
  return { ...row.e, professional: row.professional, addenda, documents };
}
export type EncounterRecord = NonNullable<Awaited<ReturnType<typeof loadEncounter>>>;

export interface DraftInput {
  answers: Answers;
  vitals: Vitals;
  diagnoses: Diagnosis[];
  conduct: string | null;
  returnDays: number | null;
  returnNote: string | null;
}

/** Salva o rascunho. `version` evita que duas abas sobrescrevam uma à outra. */
export async function saveDraft(tx: Tx, id: string, version: number, data: DraftInput): Promise<number> {
  const [row] = await tx
    .update(schema.pepEncounters)
    .set({ ...data, version: sql`${schema.pepEncounters.version} + 1` })
    .where(and(eq(schema.pepEncounters.id, id), eq(schema.pepEncounters.version, version), eq(schema.pepEncounters.status, "rascunho")))
    .returning({ version: schema.pepEncounters.version });
  if (row) return row.version;
  const [cur] = await tx.select({ status: schema.pepEncounters.status }).from(schema.pepEncounters).where(eq(schema.pepEncounters.id, id));
  if (!cur) throw new UserError("Atendimento não encontrado.");
  if (cur.status === "finalizado") throw new UserError("Este atendimento já foi finalizado. Para complementar, use um adendo.");
  throw new UserError("Este atendimento foi alterado em outra aba ou aparelho. Recarregue a página para ver a versão mais recente.");
}

/** Conteúdo que o hash protege (o que forma o registro clínico) */
export function encounterHashContent(e: Pick<EncounterRecord, "id" | "contactId" | "professionalId" | "templateFields" | "answers" | "vitals" | "diagnoses" | "conduct" | "returnDays" | "returnNote" | "startedAt">, finishedAt: Date, finishedBy: string) {
  return {
    id: e.id,
    contactId: e.contactId,
    professionalId: e.professionalId,
    fields: e.templateFields,
    answers: e.answers,
    vitals: e.vitals,
    diagnoses: e.diagnoses,
    conduct: e.conduct,
    returnDays: e.returnDays,
    returnNote: e.returnNote,
    startedAt: e.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    finishedBy,
  };
}

/**
 * Finaliza: a partir daqui o registro é imutável (o banco recusa alteração).
 * Integra com o Atendimento (se contratado): consulta vira "compareceu" com fim registrado
 * e o retorno combinado vira tarefa "Agendar retorno" na data certa.
 */
export async function finalizeEncounter(tx: Tx, ctx: PepContext, e: EncounterRecord): Promise<void> {
  const finishedAt = new Date();
  const hash = contentHash(encounterHashContent(e, finishedAt, ctx.user.id));
  const [row] = await tx
    .update(schema.pepEncounters)
    .set({ status: "finalizado", finishedAt, finishedBy: ctx.user.id, hash, version: sql`${schema.pepEncounters.version} + 1` })
    .where(and(eq(schema.pepEncounters.id, e.id), eq(schema.pepEncounters.status, "rascunho"), eq(schema.pepEncounters.version, e.version)))
    .returning({ id: schema.pepEncounters.id });
  if (!row) throw new UserError("O atendimento mudou desde que você abriu (outra aba?). Recarregue a página e finalize de novo.");
  await audit(tx, ctx, { action: "finalizar", contactId: e.contactId, encounterId: e.id });

  // Lista de problemas: CIDs do atendimento entram no resumo do paciente (sem repetir)
  if (e.diagnoses.length) await mergeProblems(tx, ctx, e.contactId, e.diagnoses);

  if (e.appointmentId) {
    await tx
      .update(schema.appointments)
      .set({ status: "compareceu", finishedAt: sql`coalesce(${schema.appointments.finishedAt}, now())`, version: sql`${schema.appointments.version} + 1` })
      .where(and(eq(schema.appointments.id, e.appointmentId), inArray(schema.appointments.status, ["agendado", "confirmado", "compareceu"])));
  }
  await tx.update(schema.contacts).set({ lastVisitAt: finishedAt }).where(eq(schema.contacts.id, e.contactId));

  if (ctx.hasCrm) {
    // Linha do tempo do CRM: só o fato, sem conteúdo clínico (a recepção não precisa ver o diagnóstico)
    await logEvent(tx, { contactId: e.contactId, actorId: ctx.user.id, type: "pep_encounter_finished", data: { profissional: e.professional.name } });
    if (e.returnDays) {
      const returnDate = addDaysIso(todayIso(finishedAt, clinicTimeZone()), e.returnDays);
      // A tarefa vence uma semana antes (tempo de achar horário), nunca antes de hoje
      const due = addDaysIso(todayIso(finishedAt, clinicTimeZone()), Math.max(0, e.returnDays - 7));
      await tx.insert(schema.tasks).values({
        contactId: e.contactId,
        title: `Agendar retorno com ${e.professional.name} para ${returnDate.split("-").reverse().join("/")}${e.returnNote ? ` (${e.returnNote.slice(0, 80)})` : ""}`,
        dueDate: due,
        kind: "retorno",
        createdBy: ctx.user.id,
      });
    }
  }
}

async function mergeProblems(tx: Tx, ctx: PepContext, contactId: string, diagnoses: Diagnosis[]) {
  const [p] = await tx.select().from(schema.pepPatientProfiles).where(eq(schema.pepPatientProfiles.contactId, contactId));
  const problems = [...(p?.problems ?? [])];
  for (const d of diagnoses) if (!problems.some((x) => x.cid === d.code)) problems.push({ name: d.name, cid: d.code, since: todayIso(new Date(), clinicTimeZone()), active: true });
  if (p) await tx.update(schema.pepPatientProfiles).set({ problems, updatedBy: ctx.user.id, version: sql`${schema.pepPatientProfiles.version} + 1` }).where(eq(schema.pepPatientProfiles.contactId, contactId));
  else await tx.insert(schema.pepPatientProfiles).values({ contactId, problems, updatedBy: ctx.user.id });
}

export async function addAddendum(tx: Tx, ctx: PepContext, e: EncounterRecord, text: string): Promise<void> {
  if (e.status !== "finalizado") throw new UserError("Adendo é para atendimento finalizado. No rascunho, edite direto.");
  const createdAt = new Date();
  const hash = contentHash({ encounterId: e.id, encounterHash: e.hash, text, authorId: ctx.user.id, at: createdAt.toISOString() });
  const [row] = await tx.insert(schema.pepAddenda).values({ encounterId: e.id, text, authorId: ctx.user.id, authorName: ctx.user.name, hash, createdAt }).returning({ id: schema.pepAddenda.id });
  await audit(tx, ctx, { action: "adendo", contactId: e.contactId, encounterId: e.id, documentId: null, reason: `adendo ${row!.id}` });
}

/* --------------------------------- Documentos -------------------------------- */

function formatCpf(cpf: string | null | undefined) {
  return cpf && /^\d{11}$/.test(cpf) ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : null;
}

function councilLine(p: { council: string | null; councilNumber: string | null; councilUf: string | null }) {
  return p.council && p.councilNumber ? `${p.council}${p.councilUf ? `-${p.councilUf}` : ""} ${p.councilNumber}` : null;
}

/** Emite o documento: congela cabeçalho e conteúdo, calcula hash e o código de verificação */
export async function issueDocument(tx: Tx, ctx: PepContext, e: EncounterRecord, content: DocumentContent): Promise<{ id: string; code: string }> {
  const patient = await loadPatient(tx, e.contactId);
  if (!patient) throw new UserError("Paciente não encontrado.");
  if (content.kind === "atestado" && content.includeCid && !content.cid) throw new UserError("Escolha o CID que vai no atestado (ou desmarque a opção).");
  const [clinic] = await tx.select().from(schema.clinics).where(eq(schema.clinics.id, ctx.user.clinicId));
  const settings = await loadPepSettings(tx);
  const pro = e.professional;
  if (!pro.council || !pro.councilNumber)
    throw new UserError(`Cadastre o registro no conselho de ${pro.name} (Ajustes > Clínica > Profissionais) antes de emitir documentos: ele é obrigatório na receita e no atestado.`);
  // Endereço, telefone e CNES da UNIDADE onde o atendimento aconteceu (cada endereço tem o seu CNES)
  const [unit] = e.unitId ? await tx.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.id, e.unitId)) : [];
  const unitAddress = unit ? formatAddress(unit) : "";
  const header: DocumentHeader = {
    clinic: {
      name: clinic?.tradeName ?? ctx.user.clinicName,
      document: [clinic?.cnpj ? `CNPJ ${clinic.cnpj}` : null, unit?.cnes ? `CNES ${unit.cnes}` : null].filter(Boolean).join("  |  ") || null,
      address: unitAddress || [unit?.city ?? clinic?.city, unit?.state ?? clinic?.state].filter(Boolean).join(" - ") || null,
      phone: unit?.phone ?? clinic?.phone ?? null,
      note: settings.headerNote,
    },
    professional: { name: pro.name, specialty: pro.specialty, council: councilLine(pro) },
    patient: { name: patient.identity.name, cpf: formatCpf(patient.identity.cpf), birthDate: patient.identity.birthDate, age: patient.age },
  };
  const issuedAt = new Date();
  const hash = contentHash({ kind: content.kind, content, header, encounterId: e.id, issuedAt: issuedAt.toISOString(), issuedBy: ctx.user.id });
  // Código único entre TODAS as clínicas (índice único): se repetir (raríssimo), tenta outro sal
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = verificationCode(hash, randomBytes(8).toString("hex"));
    const [row] = await tx
      .insert(schema.pepDocuments)
      .values({ encounterId: e.id, contactId: e.contactId, professionalId: pro.id, kind: content.kind, content, header, hash, verificationCode: code, issuedBy: ctx.user.id, issuedAt })
      .onConflictDoNothing({ target: schema.pepDocuments.verificationCode })
      .returning({ id: schema.pepDocuments.id });
    if (!row) continue;
    await audit(tx, ctx, { action: "emitir", contactId: e.contactId, encounterId: e.id, documentId: row.id, reason: DOCUMENT_KIND_LABEL[content.kind] });
    return { id: row.id, code };
  }
  throw new Error("Não foi possível gerar um código de verificação único.");
}

export async function revokeDocument(tx: Tx, ctx: PepContext, documentId: string, reason: string): Promise<void> {
  const [row] = await tx
    .update(schema.pepDocuments)
    .set({ revokedAt: new Date(), revokedBy: ctx.user.id, revokeReason: reason })
    .where(and(eq(schema.pepDocuments.id, documentId), isNull(schema.pepDocuments.revokedAt)))
    .returning({ contactId: schema.pepDocuments.contactId, encounterId: schema.pepDocuments.encounterId });
  if (!row) throw new UserError("Documento não encontrado ou já cancelado.");
  await audit(tx, ctx, { action: "cancelar_documento", contactId: row.contactId, encounterId: row.encounterId, documentId, reason });
}
