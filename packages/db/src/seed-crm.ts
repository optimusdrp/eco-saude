/**
 * Dados FICTÍCIOS de demonstração do CRM (rodam com: pnpm db:seed -- --demo).
 *
 * Cria a "Clínica Exemplo" com plano CRM Corporativo e situações reais para
 * testar cada funcionalidade:
 *  - conversas esperando resposta (uma com o relógio já estourado)
 *  - mensagem com sinal de urgência
 *  - conversa fora da janela de 24h do WhatsApp
 *  - consulta de hoje com risco alto de falta
 *  - lista de espera, protocolos de retorno, pesquisa de satisfação pendente
 * E uma segunda clínica (Clínica Olhar) para testar o isolamento entre clínicas.
 *
 * Todos os horários são relativos ao momento em que o seed roda.
 */
import {
  addDaysIso,
  detectIntent,
  detectUrgency,
  todayIso,
  zonedToUtc,
  type AppointmentStatus,
  type Channel,
  type JourneyStage,
} from "@ecosaude/core/crm";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as base from "./schema";
import * as crm from "./schema-crm";

const schema = { ...base, ...crm };
type Db = NodePgDatabase<typeof schema>;

export const CRM_DEMO_PASSWORD = "Demo-EcoSaude-2026";
const MIN = 60_000;
const DAY = 86_400_000;

export async function seedCrmDemo(db: Db): Promise<void> {
  const existing = await db.query.clinics.findFirst({ where: eq(schema.clinics.tradeName, "Clínica Exemplo") });
  if (existing) {
    console.log("CRM de demonstração: já existia");
    return;
  }

  const now = Date.now();
  const today = todayIso();
  const at = (dayOffset: number, time: string) => zonedToUtc(addDaysIso(today, dayOffset), time);
  const ago = (minutes: number) => new Date(now - minutes * MIN);
  const hash = await bcrypt.hash(CRM_DEMO_PASSWORD, 12);

  /* ------------------------------ Clínica e plano ------------------------------ */

  const [clinic] = await db
    .insert(schema.clinics)
    .values({ tradeName: "Clínica Exemplo", legalName: "Clínica Exemplo Saúde Ltda.", city: "Porto Alegre", state: "RS", email: "contato@clinicaexemplo.com.br" })
    .returning();
  const clinicId = clinic!.id;

  const crmPlan = await db.query.plans.findFirst({ where: and(eq(schema.plans.moduleId, "crm"), eq(schema.plans.name, "Corporativo")) });
  if (crmPlan) {
    await db.insert(schema.subscriptions).values({
      clinicId,
      planId: crmPlan.id,
      moduleId: "crm",
      status: "ativa",
      priceMonthlyCents: crmPlan.priceMonthlyCents,
      startedAt: new Date(now - 40 * DAY),
    });
  }
  // Prontuário em teste: mostra a integração Agenda -> atendimento -> retorno
  const pepPlan = await db.query.plans.findFirst({ where: and(eq(schema.plans.moduleId, "pep"), eq(schema.plans.name, "Completo")) });
  if (pepPlan) {
    await db.insert(schema.subscriptions).values({ clinicId, planId: pepPlan.id, moduleId: "pep", status: "teste", priceMonthlyCents: pepPlan.priceMonthlyCents, trialEndsAt: new Date(now + 14 * DAY) });
  }

  /* --------------------------------- Equipe ---------------------------------- */

  const users = await db
    .insert(schema.clinicUsers)
    .values([
      { clinicId, name: "Marta Ribeiro", email: "gestor@clinicaexemplo.com.br", passwordHash: hash, role: "gestor" },
      { clinicId, name: "Paula Nogueira", email: "recepcao@clinicaexemplo.com.br", passwordHash: hash, role: "recepcao" },
      { clinicId, name: "Dra. Beatriz Lemos", email: "beatriz@clinicaexemplo.com.br", passwordHash: hash, role: "profissional" },
    ])
    .returning();
  const [gestor, recepcao, beatrizUser] = users as [typeof users[number], typeof users[number], typeof users[number]];

  const pros = await db
    .insert(schema.professionals)
    .values([
      { clinicId, name: "Dra. Beatriz Lemos", specialty: "Dermatologia", color: "crm", userId: beatrizUser.id, workDays: [1, 2, 3, 4, 5, 6], council: "CRM", councilNumber: "12345", councilUf: "RS" },
      { clinicId, name: "Dr. Caio Prado", specialty: "Clínica geral", color: "pep", workDays: [1, 2, 3, 4, 5, 6], council: "CRM", councilNumber: "23456", councilUf: "RS" },
      { clinicId, name: "Dra. Helena Duarte", specialty: "Pediatria", color: "bi", workDays: [1, 2, 3, 4, 5], slotMinutes: 40, workStart: "08:00", workEnd: "17:20" },
    ])
    .returning();
  const [beatriz, caio, helena] = pros as [typeof pros[number], typeof pros[number], typeof pros[number]];

  /* ------------------------- Unidades e consultórios ------------------------- */
  // A principal é criada sozinha (gatilho da migração 0032); aqui ganha endereço e uma segunda unidade
  const [moinhos] = await db
    .update(schema.clinicUnits)
    .set({
      name: "Unidade Moinhos",
      address: "Rua Padre Chagas, 300, sala 501",
      district: "Moinhos de Vento",
      city: "Porto Alegre",
      state: "RS",
      zip: "90570080",
      phone: "5133330000",
      cnes: "1234567",
      // Horário da clínica (a principal): seg a sex 8h às 18h e sábado de manhã. O Centro herda.
      openingHours: { ...Object.fromEntries(["1", "2", "3", "4", "5"].map((k) => [k, { periods: [{ start: "08:00", end: "18:00" }] }])), "6": { periods: [{ start: "08:00", end: "12:00" }] } },
    })
    .where(and(eq(schema.clinicUnits.clinicId, clinicId), eq(schema.clinicUnits.main, true)))
    .returning();
  const [centro] = await db
    .insert(schema.clinicUnits)
    .values({ clinicId, name: "Unidade Centro", address: "Rua dos Andradas, 1200, conj. 304", district: "Centro Histórico", city: "Porto Alegre", state: "RS", zip: "90020008", phone: "5133331111", cnes: "7654321", sortOrder: 1 })
    .returning();
  const rooms = await db
    .insert(schema.clinicRooms)
    .values([
      { clinicId, unitId: moinhos!.id, name: "Consultório 1", kind: "consultorio" as const, sortOrder: 1 },
      { clinicId, unitId: moinhos!.id, name: "Consultório 2", kind: "consultorio" as const, sortOrder: 2 },
      { clinicId, unitId: moinhos!.id, name: "Sala de procedimentos", kind: "procedimento" as const, sortOrder: 3 },
      { clinicId, unitId: moinhos!.id, name: "Triagem", kind: "triagem" as const, sortOrder: 4 },
      { clinicId, unitId: centro!.id, name: "Sala 1", kind: "consultorio" as const, sortOrder: 1 },
      { clinicId, unitId: centro!.id, name: "Sala 2", kind: "consultorio" as const, sortOrder: 2 },
    ])
    .returning();
  const room = (unitId: string, name: string) => rooms.find((r) => r.unitId === unitId && r.name === name)!.id;
  const day = (periods: { start: string; end: string; unitId?: string; roomId?: string }[]) => ({ periods });
  const twoShifts = (unitId: string | undefined, roomId: string, end = "18:00") => day([
    { start: "08:00", end: "12:00", ...(unitId ? { unitId } : {}), roomId },
    { start: "13:00", end, ...(unitId ? { unitId } : {}), roomId },
  ]);
  // Beatriz: seg a sex no Moinhos (Consultório 1), sábado de manhã no Centro (Sala 1)
  const c1 = room(moinhos!.id, "Consultório 1");
  const c2 = room(moinhos!.id, "Consultório 2");
  const s1 = room(centro!.id, "Sala 1");
  const s2 = room(centro!.id, "Sala 2");
  const weeks: [string, Record<string, ReturnType<typeof day>>][] = [
    [beatriz.id, { "1": twoShifts(undefined, c1), "2": twoShifts(undefined, c1), "3": twoShifts(undefined, c1), "4": twoShifts(undefined, c1), "5": twoShifts(undefined, c1), "6": day([{ start: "08:00", end: "12:00", unitId: centro!.id, roomId: s1 }]) }],
    [caio.id, { "1": twoShifts(undefined, c2), "2": twoShifts(undefined, c2), "3": twoShifts(undefined, c2), "4": twoShifts(undefined, c2), "5": twoShifts(undefined, c2), "6": twoShifts(undefined, c2) }],
    [helena.id, { "1": twoShifts(centro!.id, s2, "17:20"), "2": twoShifts(centro!.id, s2, "17:20"), "3": twoShifts(centro!.id, s2, "17:20"), "4": twoShifts(centro!.id, s2, "17:20"), "5": twoShifts(centro!.id, s2, "17:20") }],
  ];
  for (const [id, week] of weeks) await db.update(schema.professionals).set({ weeklySchedule: week }).where(eq(schema.professionals.id, id));

  /* -------------------------------- Contatos --------------------------------- */

  interface ContactSeed {
    key: string;
    name: string;
    phone?: string;
    stage: JourneyStage;
    channel: Channel;
    externalId: string;
    source: string;
    tags?: string[];
    consent?: boolean;
    lostReason?: string;
    stageDaysAgo?: number;
  }

  const people: ContactSeed[] = [
    { key: "ana", name: "Ana Lúcia Reis", phone: "5551991110001", stage: "agendado", channel: "whatsapp", externalId: "5551991110001", source: "indicação", consent: true },
    { key: "caio", name: "Caio Moura", phone: "5551991110002", stage: "agendado", channel: "whatsapp", externalId: "5551991110002", source: "google", tags: ["convênio"], consent: true },
    { key: "helena", name: "Helena Prates", stage: "agendado", channel: "instagram", externalId: "helena.prates", source: "instagram", consent: true },
    { key: "jorge", name: "Jorge Batista", stage: "agendado", channel: "telegram", externalId: "jorgebatista", source: "indicação" },
    { key: "marcos", name: "Marcos Teles", phone: "5551991110005", stage: "em_conversa", channel: "whatsapp", externalId: "5551991110005", source: "whatsapp", consent: true },
    { key: "livia", name: "Lívia Andrade", stage: "em_conversa", channel: "facebook", externalId: "livia.andrade", source: "facebook", consent: true },
    { key: "rui", name: "Rui Fagundes", phone: "5551991110007", stage: "em_conversa", channel: "whatsapp", externalId: "5551991110007", source: "google", consent: true },
    { key: "fernanda", name: "Fernanda Lima", phone: "5551991110008", stage: "novo", channel: "whatsapp", externalId: "5551991110008", source: "whatsapp", stageDaysAgo: 0 },
    { key: "roberto", name: "Roberto Nunes", stage: "novo", channel: "instagram", externalId: "roberto.nunes", source: "instagram", stageDaysAgo: 0 },
    { key: "sonia", name: "Sônia Dias", phone: "5551991110010", stage: "agendado", channel: "whatsapp", externalId: "5551991110010", source: "indicação", consent: true },
    { key: "paulo", name: "Paulo Lima", stage: "em_conversa", channel: "telegram", externalId: "paulolima", source: "telegram" },
    { key: "gabriela", name: "Gabriela Rocha", phone: "5551991110012", stage: "paciente", channel: "whatsapp", externalId: "5551991110012", source: "google", consent: true, stageDaysAgo: 210 },
    { key: "tiago", name: "Tiago Mendes", phone: "5551991110013", stage: "paciente", channel: "whatsapp", externalId: "5551991110013", source: "indicação", consent: true, stageDaysAgo: 34 },
    { key: "juliana", name: "Juliana Costa", stage: "perdido", channel: "instagram", externalId: "juliana.costa", source: "instagram", lostReason: "Achou o valor alto.", stageDaysAgo: 12 },
    { key: "bia", name: "Beatriz Souza", phone: "5551991110015", stage: "em_conversa", channel: "whatsapp", externalId: "5551991110015", source: "whatsapp", stageDaysAgo: 2 },
    { key: "eduardo", name: "Eduardo Pires", phone: "5551991110016", stage: "paciente", channel: "whatsapp", externalId: "5551991110016", source: "google", consent: true, stageDaysAgo: 1 },
    { key: "carla", name: "Carla Mendonça", phone: "5551991110017", stage: "em_conversa", channel: "whatsapp", externalId: "5551991110017", source: "site", stageDaysAgo: 5 },
    // Duplicado de propósito: a mesma Gabriela escreveu pelo Instagram e virou outro contato.
    // Aparece em Pacientes > Possíveis duplicados para testar a unificação.
    { key: "gabriela_ig", name: "Gabriela Rocha", stage: "novo", channel: "instagram", externalId: "gabi.rocha", source: "instagram", stageDaysAgo: 1 },
  ];

  const contactId: Record<string, string> = {};
  for (const p of people) {
    const [c] = await db
      .insert(schema.contacts)
      .values({
        clinicId,
        name: p.name,
        phone: p.phone ?? null,
        stage: p.stage,
        stageChangedAt: new Date(now - (p.stageDaysAgo ?? 3) * DAY),
        source: p.source,
        tags: p.tags ?? [],
        preferredChannel: p.channel,
        consentMarketing: p.consent ?? false,
        consentAt: p.consent ? new Date(now - 60 * DAY) : null,
        lostReason: p.lostReason ?? null,
        ownerId: p.stage === "novo" ? null : recepcao.id,
        createdAt: new Date(now - 90 * DAY),
      })
      .returning({ id: schema.contacts.id });
    contactId[p.key] = c!.id;
    await db.insert(schema.contactIdentities).values({
      clinicId,
      contactId: c!.id,
      channel: p.channel,
      externalId: p.externalId,
      displayName: p.name,
    });
  }

  /* -------------------------------- Conversas -------------------------------- */

  type Msg = [direction: "in" | "out", text: string, minutesAgo: number];

  async function conversation(key: string, channel: Channel, msgs: Msg[], unread = 0) {
    const last = msgs[msgs.length - 1]!;
    const lastIn = [...msgs].reverse().find((m) => m[0] === "in");
    // Paciente espera resposta desde a primeira mensagem dele depois da última resposta da clínica
    let waitingSince: Date | null = null;
    if (last[0] === "in") {
      const lastOut = msgs.map((m) => m[0]).lastIndexOf("out");
      waitingSince = ago(msgs[lastOut + 1]![2]);
    }
    const urgency = lastIn ? detectUrgency(lastIn[1]) : null;
    const [conv] = await db
      .insert(schema.conversations)
      .values({
        clinicId,
        contactId: contactId[key]!,
        channel,
        status: last[0] === "in" ? "aberta" : "aguardando_paciente",
        unreadCount: unread,
        lastMessageAt: ago(last[2]),
        lastMessagePreview: last[1].slice(0, 120),
        lastInboundAt: lastIn ? ago(lastIn[2]) : null,
        awaitingReplySince: waitingSince,
        intent: lastIn ? detectIntent(lastIn[1]) : null,
        urgent: urgency?.urgent ?? false,
        urgentKind: urgency?.kind ?? null,
        assigneeId: last[0] === "out" ? recepcao.id : null,
      })
      .returning({ id: schema.conversations.id });
    await db.insert(schema.messages).values(
      msgs.map(([direction, body, minutesAgo], i) => ({
        clinicId,
        conversationId: conv!.id,
        channel,
        direction,
        body,
        status: direction === "in" ? ("recebida" as const) : ("lida" as const),
        authorId: direction === "out" ? recepcao.id : null,
        externalId: direction === "in" ? `seed-${key}-${i}` : null,
        createdAt: ago(minutesAgo),
        sentAt: direction === "out" ? ago(minutesAgo) : null,
      })),
    );
    await db.update(schema.contacts).set({ lastInteractionAt: ago(last[2]) }).where(eq(schema.contacts.id, contactId[key]!));
  }

  await conversation("fernanda", "whatsapp", [["in", "Oi! Queria marcar uma consulta com dermatologista, tem horário essa semana?", 4]], 1);
  await conversation("roberto", "instagram", [["in", "Boa tarde. Quanto custa a consulta particular com o clínico geral?", 22]], 1);
  await conversation("paulo", "telegram", [
    ["in", "Bom dia, sou paciente do Dr. Caio", 40],
    ["out", "Bom dia, Paulo! Como podemos ajudar?", 35],
    ["in", "Estou com dor no peito desde cedo e um pouco de falta de ar. Consigo encaixe hoje?", 8],
  ], 2);
  await conversation("sonia", "whatsapp", [
    ["out", "Olá, Sônia! Sua consulta com a Dra. Beatriz está marcada. Até lá!", 3 * 24 * 60],
    ["in", "Oi, preciso remarcar minha consulta, surgiu um compromisso no trabalho", 95],
  ], 1);
  await conversation("bia", "whatsapp", [
    ["in", "Vocês atendem pelo convênio Saúde Mais?", 31 * 60],
    ["out", "Olá, Beatriz! Atendemos sim. Quer que eu veja um horário?", 30 * 60],
    ["in", "Vou ver minha agenda e te falo", 30 * 60 - 5],
  ]);
  await conversation("ana", "whatsapp", [
    ["out", "Olá, Ana! Sua consulta é hoje às 15:00 com a Dra. Beatriz.", 26 * 60],
  ]);
  await conversation("caio", "whatsapp", [
    ["out", "Olá, Caio! Confirmando sua consulta de hoje às 10:00. Responda 1 para confirmar.", 20 * 60],
    ["in", "1", 19 * 60],
    ["out", "Perfeito, Caio! Está confirmado.", 19 * 60 - 2],
  ]);
  await conversation("helena", "instagram", [
    ["in", "Oi, consigo agendar com a pediatra para minha filha?", 3 * 24 * 60],
    ["out", "Olá, Helena! Temos amanhã às 09:00 com a Dra. Helena. Pode ser?", 3 * 24 * 60 - 20],
    ["in", "Pode sim, obrigada!", 3 * 24 * 60 - 25],
    ["out", "Agendado! Até amanhã.", 3 * 24 * 60 - 30],
  ]);
  await conversation("jorge", "telegram", [
    ["in", "Preciso de um retorno com o Dr. Caio", 5 * 24 * 60],
    ["out", "Claro, Jorge! Marcamos para amanhã às 14:00.", 5 * 24 * 60 - 10],
  ]);
  await conversation("eduardo", "whatsapp", [
    ["out", "Olá, Eduardo! Obrigado pela visita. De 0 a 10, quanto você recomendaria a Clínica Exemplo a um amigo?", 20 * 60],
  ]);
  await conversation("carla", "whatsapp", [
    ["in", "Vi o site de vocês, fazem peeling?", 5 * 24 * 60],
    ["out", "Olá, Carla! Fazemos sim, com a Dra. Beatriz. Quer agendar uma avaliação?", 5 * 24 * 60 - 30],
  ]);
  await conversation("marcos", "whatsapp", [
    ["in", "Tem horário com a Dra. Beatriz de manhã? Pode ser em cima da hora", 2 * 24 * 60],
    ["out", "No momento a agenda está cheia, Marcos. Coloquei você na lista de espera e aviso se abrir um horário!", 2 * 24 * 60 - 15],
  ]);
  await conversation("livia", "facebook", [
    ["in", "Quero consulta com qualquer médico disponível", 3 * 24 * 60],
    ["out", "Anotado, Lívia! Você está na lista de espera.", 3 * 24 * 60 - 10],
  ]);
  await conversation("rui", "whatsapp", [
    ["in", "Se abrir horário à tarde com a Dra. Beatriz me avisem", 4 * 24 * 60],
    ["out", "Combinado, Rui!", 4 * 24 * 60 - 5],
  ]);

  /* ---------------------------------- Agenda --------------------------------- */

  interface ApptSeed {
    key: string;
    pro: { id: string; slotMinutes: number };
    day: number;
    time: string;
    status: AppointmentStatus;
    service?: string;
    createdDaysBefore?: number;
    confirmationRequested?: boolean;
    nps?: boolean;
  }

  const appts: ApptSeed[] = [
    // Histórico (alimenta risco de falta e "última visita")
    { key: "ana", pro: beatriz, day: -120, time: "10:00", status: "faltou", service: "Consulta" },
    { key: "ana", pro: beatriz, day: -90, time: "10:00", status: "compareceu", service: "Consulta" },
    { key: "ana", pro: beatriz, day: -45, time: "15:00", status: "faltou", service: "Retorno" },
    { key: "caio", pro: caio, day: -300, time: "09:00", status: "compareceu", service: "Consulta" },
    { key: "caio", pro: caio, day: -200, time: "09:00", status: "compareceu", service: "Retorno" },
    { key: "caio", pro: caio, day: -100, time: "09:00", status: "compareceu", service: "Consulta" },
    { key: "caio", pro: caio, day: -60, time: "09:00", status: "compareceu", service: "Retorno" },
    { key: "jorge", pro: caio, day: -70, time: "16:00", status: "compareceu", service: "Consulta" },
    { key: "gabriela", pro: beatriz, day: -210, time: "11:00", status: "compareceu", service: "Limpeza de pele" },
    { key: "tiago", pro: caio, day: -34, time: "14:00", status: "compareceu", service: "Consulta" },
    { key: "eduardo", pro: caio, day: -1, time: "10:00", status: "compareceu", service: "Consulta", nps: true },
    // Hoje
    { key: "caio", pro: caio, day: 0, time: "10:00", status: "confirmado", service: "Retorno", confirmationRequested: true },
    { key: "ana", pro: beatriz, day: 0, time: "15:00", status: "agendado", service: "Retorno", createdDaysBefore: 30 },
    // Amanhã e próximos dias
    { key: "helena", pro: helena, day: 1, time: "09:20", status: "agendado", service: "Primeira consulta", createdDaysBefore: 3 },
    { key: "jorge", pro: caio, day: 1, time: "14:00", status: "agendado", service: "Retorno", createdDaysBefore: 5 },
    { key: "sonia", pro: beatriz, day: 3, time: "09:00", status: "agendado", service: "Consulta", createdDaysBefore: 3 },
  ];

  for (const a of appts) {
    const startsAt = at(a.day, a.time);
    const endsAt = new Date(startsAt.getTime() + a.pro.slotMinutes * MIN);
    const created = new Date(startsAt.getTime() - (a.createdDaysBefore ?? 7) * DAY);
    await db.insert(schema.appointments).values({
      clinicId,
      contactId: contactId[a.key]!,
      professionalId: a.pro.id,
      startsAt,
      endsAt,
      status: a.status,
      service: a.service ?? null,
      source: "recepcao",
      confirmationRequestedAt: a.confirmationRequested ? ago(20 * 60) : null,
      confirmedAt: a.status === "confirmado" ? ago(19 * 60) : null,
      npsRequestedAt: a.nps ? ago(20 * 60) : null,
      createdBy: recepcao.id,
      createdAt: created < new Date(now) ? created : new Date(now),
    });
  }

  // Última visita de quem compareceu
  await db.execute(sql`
    update contacts c set last_visit_at = sub.last
    from (select contact_id, max(starts_at) as last from appointments
          where status = 'compareceu' and clinic_id = ${clinicId} group by contact_id) sub
    where c.id = sub.contact_id`);

  /* ----------------------------- Lista de espera ----------------------------- */

  await db.insert(schema.waitlistEntries).values([
    { clinicId, contactId: contactId.marcos!, professionalId: beatriz.id, period: "manha", notes: "Pode vir em cima da hora", createdAt: ago(2 * 24 * 60) },
    { clinicId, contactId: contactId.livia!, professionalId: null, period: "qualquer", createdAt: ago(3 * 24 * 60) },
    { clinicId, contactId: contactId.rui!, professionalId: beatriz.id, period: "tarde", createdAt: ago(4 * 24 * 60) },
  ]);

  /* ------------------------- Rotina e relacionamento ------------------------- */

  await db.insert(schema.quickReplies).values([
    { clinicId, shortcut: "ola", title: "Saudação", body: "Olá, {{primeiro_nome}}! Aqui é da {{clinica}}. Como podemos ajudar?" },
    { clinicId, shortcut: "endereco", title: "Endereço", body: "Estamos na Av. Exemplo, 1000, sala 501, Porto Alegre. Há estacionamento conveniado no prédio." },
    { clinicId, shortcut: "valores", title: "Valores", body: "A consulta particular custa R$ 280,00. Atendemos também os convênios Saúde Mais e Vida Plena." },
    { clinicId, shortcut: "confirmar", title: "Pedido de confirmação", body: "Olá, {{primeiro_nome}}! Confirmando sua consulta {{data}} às {{hora}} com {{profissional}}. Responda 1 para confirmar ou 2 para remarcar.", approvedTemplate: true },
    { clinicId, shortcut: "retomar", title: "Retomar contato", body: "Olá, {{primeiro_nome}}! Ainda podemos ajudar com o seu agendamento na {{clinica}}?", approvedTemplate: true },
    { clinicId, shortcut: "remarcar", title: "Consulta remarcada", body: "Olá, {{primeiro_nome}}! Sua consulta foi remarcada para {{data}} às {{hora}} com {{profissional}}. Se não puder, é só responder aqui.", approvedTemplate: true },
  ]);
  // Preferências do CRM: confirmação automática ligada, a partir das 10h, consultas de amanhã
  await db.insert(schema.crmSettings).values({ clinicId, autoConfirm: true, confirmHour: 10, confirmDaysBefore: 1 }).onConflictDoNothing();

  await db.insert(schema.returnProtocols).values([
    { clinicId, name: "Revisão semestral", serviceMatch: null, daysAfter: 180, message: "Olá, {{primeiro_nome}}! Já faz 6 meses da sua última consulta na {{clinica}}. Que tal agendar sua revisão?" },
    { clinicId, name: "Retorno de 30 dias", serviceMatch: "Consulta", daysAfter: 30, message: "Olá, {{primeiro_nome}}! Está na hora do seu retorno de 30 dias. Quer que a gente reserve um horário?" },
  ]);

  await db.insert(schema.tasks).values([
    { clinicId, contactId: contactId.juliana!, title: "Ligar para Juliana com proposta de pacote", dueDate: today, assigneeId: recepcao.id, createdBy: gestor.id },
    { clinicId, contactId: contactId.helena!, title: "Enviar orientações para a primeira consulta da filha", dueDate: today, assigneeId: recepcao.id, createdBy: gestor.id },
    { clinicId, contactId: null, title: "Revisar respostas rápidas com a equipe", dueDate: addDaysIso(today, 2), assigneeId: gestor.id, createdBy: gestor.id },
  ]);

  await db.insert(schema.channelConnections).values([
    { clinicId, channel: "whatsapp", mode: "simulacao", displayName: "+55 51 3333-0000" },
    { clinicId, channel: "telegram", mode: "simulacao", displayName: "@ClinicaExemploBot" },
    { clinicId, channel: "instagram", mode: "simulacao", displayName: "@clinicaexemplo" },
    { clinicId, channel: "facebook", mode: "simulacao", displayName: "Clínica Exemplo" },
  ]);

  await db.insert(schema.crmEvents).values([
    { clinicId, contactId: contactId.juliana!, actorId: recepcao.id, type: "stage_changed", data: { de: "em_conversa", para: "perdido", motivo: "Achou o valor alto." }, createdAt: ago(12 * 24 * 60) },
    { clinicId, contactId: contactId.gabriela!, actorId: gestor.id, type: "note", data: { body: "Prefere horários no fim da tarde." }, createdAt: ago(200 * 24 * 60) },
  ]);

  /* --------------------------- Segunda clínica (isolamento) --------------------------- */

  const olhar = await db.query.clinics.findFirst({ where: eq(schema.clinics.tradeName, "Clínica Olhar") });
  if (olhar) {
    await db.insert(schema.clinicUsers).values({
      clinicId: olhar.id,
      name: "Otávio Gestor",
      email: "gestor@olhar.exemplo.com.br",
      passwordHash: hash,
      role: "gestor",
    });
    await db.insert(schema.professionals).values({ clinicId: olhar.id, name: "Dr. Renato Vidal", specialty: "Oftalmologia", color: "bi" });
    const [c] = await db
      .insert(schema.contacts)
      .values({ clinicId: olhar.id, name: "Paciente Exclusivo Olhar", phone: "5551977770000", stage: "novo", source: "whatsapp", preferredChannel: "whatsapp" })
      .returning({ id: schema.contacts.id });
    await db.insert(schema.contactIdentities).values({ clinicId: olhar.id, contactId: c!.id, channel: "whatsapp", externalId: "5551977770000" });
    await db.insert(schema.channelConnections).values({ clinicId: olhar.id, channel: "whatsapp", mode: "simulacao", displayName: "+55 51 3222-0000" });
  }

  // Consultas de demonstração no local certo: o da semana de cada profissional
  await db.execute(sql`
    update appointments a set
      unit_id = coalesce((p.weekly_schedule -> extract(dow from a.starts_at at time zone 'America/Sao_Paulo')::int::text -> 'periods' -> 0 ->> 'unitId')::uuid, ${moinhos!.id}::uuid),
      room_id = (p.weekly_schedule -> extract(dow from a.starts_at at time zone 'America/Sao_Paulo')::int::text -> 'periods' -> 0 ->> 'roomId')::uuid
    from professionals p
    where p.id = a.professional_id and a.clinic_id = ${clinicId}`);
  console.log("CRM de demonstração: ok");
  console.log(`  Clínica Exemplo: gestor@ / recepcao@ / beatriz@clinicaexemplo.com.br, senha "${CRM_DEMO_PASSWORD}"`);
  console.log(`  Clínica Olhar:   gestor@olhar.exemplo.com.br, senha "${CRM_DEMO_PASSWORD}"`);
}
