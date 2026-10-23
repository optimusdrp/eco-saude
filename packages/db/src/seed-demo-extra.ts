/**
 * DADOS FICTÍCIOS COMPLETOS DA "CLÍNICA EXEMPLO" (rodam com: pnpm db:seed -- --demo)
 *
 * Complementa o seed-crm.ts para que TODAS as telas tenham o que mostrar. Cada bloco é
 * ADITIVO e IDEMPOTENTE: confere se já existe antes de criar. Por isso dá para rodar de novo
 * numa base que já tem a Clínica Exemplo (ele só acrescenta o que falta) e, num dia novo,
 * ele monta de novo o "dia de hoje" do Consultório.
 *
 * Blocos:
 *  1. Equipe extra: Dr. Caio com acesso (profissional ligado) e uma enfermeira com perfil próprio.
 *  2. Histórico de 8 meses: ~30 pacientes, centenas de consultas (compareceu, faltou, cancelou)
 *     com chegada e fim registrados, pesquisa de satisfação. Alimenta Duração das consultas,
 *     risco de falta aprendido (150+ consultas), Retornos, Jornada e Pacientes.
 *  3. Relacionamento e gestão: leads, motivos de perda, pedidos LGPD, automações próprias,
 *     mensagens personalizadas, recesso de unidade, férias de profissional, tarefas.
 *  4. Prontuário: áreas, formulários, resumo clínico (alergias, medicamentos, problemas),
 *     atendimentos finalizados com hash, documentos com código de verificação (um cancelado),
 *     adendo, atendimento esquecido, acesso de emergência com aviso no sino e registro de acessos.
 *  5. Dia de hoje: Consultório com finalizados, falta, em atendimento, triagem urgente,
 *     chegou e quem ainda vai chegar.
 *
 * Tudo é inventado: nomes, CPFs (válidos só no formato), telefones e histórias clínicas.
 * Valores sorteados usam um gerador com semente fixa: rodar duas vezes gera a mesma base.
 */
import {
  addDaysIso,
  formatAddress,
  ROLE_PRESETS,
  todayIso,
  zonedToUtc,
  type AppointmentStatus,
} from "@ecosaude/core/crm";
import { BUILT_IN_TEMPLATES, ageYears, documentContentSchema, type Answers, type Diagnosis, type DocumentContent, type TemplateField, type Vitals } from "@ecosaude/core/pep";
import { contentHash, verificationCode } from "@ecosaude/core/pep/server";
import bcrypt from "bcryptjs";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import * as base from "./schema";
import * as crm from "./schema-crm";
import * as pep from "./schema-pep";
import { CRM_DEMO_PASSWORD } from "./seed-crm";

const schema = { ...base, ...crm, ...pep };
type Db = NodePgDatabase<typeof schema>;

const MIN = 60_000;
const DAY = 86_400_000;

/* ------------------------------ Sorteio com semente ------------------------------ */

/** Gerador pseudoaleatório (mulberry32): mesma semente, mesma sequência */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  };
}

/** CPF fictício com dígitos verificadores corretos (passa na validação de formato) */
function fakeCpf(r: ReturnType<typeof rng>): string {
  const d = Array.from({ length: 9 }, () => r.int(0, 9));
  for (const len of [9, 10]) {
    const sum = d.slice(0, len).reduce((s, v, i) => s + v * (len + 1 - i), 0);
    const dv = (sum * 10) % 11;
    d.push(dv === 10 ? 0 : dv);
  }
  return d.join("");
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/* -------------------------------- Casos clínicos -------------------------------- */

/**
 * Casos clínicos fictícios por especialidade. Cada paciente do histórico recebe um caso:
 * os atendimentos dele seguem a mesma história (primeira consulta e depois retornos).
 */
interface ClinicalCase {
  key: string;
  first: Answers;
  followUp: Answers;
  diagnoses: Diagnosis[];
  conduct: string;
  returnDays: number | null;
  vitals: () => Vitals;
  allergies?: { name: string; reaction?: string; severity?: "leve" | "moderada" | "grave" }[];
  medications?: { name: string; dose?: string }[];
  /** Receita emitida na primeira consulta (itens) */
  prescription?: { medication: string; instructions: string; quantity?: string; route?: "oral" | "topica" }[];
  exams?: string[];
}

/** Sinais vitais de adulto coerentes: o peso sai da altura com IMC entre 20 e 31 */
const adultVitals = (r: ReturnType<typeof rng>, opts: { hypertensive?: boolean } = {}) => (): Vitals => {
  const altura = r.int(155, 186);
  const peso = Math.round((r.int(200, 310) / 10) * (altura / 100) ** 2);
  return {
    pas: opts.hypertensive ? r.int(138, 162) : r.int(108, 132),
    pad: opts.hypertensive ? r.int(86, 98) : r.int(68, 84),
    fc: r.int(62, 88),
    spo2: r.int(96, 99),
    peso,
    altura,
  };
};

function casesFor(r: ReturnType<typeof rng>): Record<"dermatologia" | "clinica_geral" | "pediatria", ClinicalCase[]> {
  return {
    dermatologia: [
      {
        key: "acne",
        first: { queixa: "Espinhas no rosto há 1 ano", hda: "Lesões inflamatórias na face e no dorso, piora no período pré-menstrual. Já usou sabonete com ácido salicílico sem melhora.", localizacao: "Face e dorso superior", tempo_evolucao: "1 ano", sintomas_pele: ["Dor"], fototipo: "III", protetor: "Às vezes", exame_dermatologico: "Pápulas e pústulas em região malar e mentoniana, comedões abertos na fronte. Sem cicatrizes atróficas." },
        followUp: { evolucao: "Redução de cerca de 60% das lesões inflamatórias. Leve ressecamento no início do tratamento.", adesao: "Sim", resposta: "Melhora parcial", exame_dermatologico: "Raras pápulas em região mentoniana. Pele levemente ressecada." },
        diagnoses: [{ code: "L70.0", name: "Acne vulgar", principal: true }],
        conduct: "Adapaleno 0,1% gel à noite, peróxido de benzoíla 2,5% pela manhã, hidratante oil-free e protetor solar FPS 50 diário.",
        returnDays: 60,
        vitals: adultVitals(r),
        prescription: [
          { medication: "Adapaleno 0,1% gel", instructions: "Aplicar fina camada no rosto à noite, após lavar. Uso contínuo.", quantity: "1 bisnaga", route: "topica" },
          { medication: "Peróxido de benzoíla 2,5% gel", instructions: "Aplicar nas lesões pela manhã.", quantity: "1 bisnaga", route: "topica" },
        ],
      },
      {
        key: "dermatite",
        first: { queixa: "Descamação e coceira no couro cabeludo", hda: "Caspa intensa e vermelhidão nas laterais do nariz há 6 meses, piora no inverno e com estresse.", localizacao: "Couro cabeludo e sulcos nasogenianos", tempo_evolucao: "6 meses", sintomas_pele: ["Prurido", "Descamação"], fototipo: "II", protetor: "Diário", exame_dermatologico: "Eritema e descamação amarelada em couro cabeludo e sulcos nasogenianos." },
        followUp: { evolucao: "Melhora importante da descamação. Coceira só ocasional.", adesao: "Sim", resposta: "Melhora completa", exame_dermatologico: "Sem eritema. Descamação mínima em couro cabeludo." },
        diagnoses: [{ code: "L21.9", name: "Dermatite seborreica não especificada", principal: true }],
        conduct: "Xampu de cetoconazol 2% três vezes por semana. Desonida creme por 5 dias na face nas crises.",
        returnDays: 90,
        vitals: adultVitals(r),
        allergies: [{ name: "Dipirona", reaction: "Urticária", severity: "moderada" }],
        prescription: [{ medication: "Cetoconazol 2% xampu", instructions: "Lavar o couro cabeludo, deixar agir 5 minutos e enxaguar. Três vezes por semana.", quantity: "1 frasco", route: "topica" }],
      },
      {
        key: "nevo",
        first: { queixa: "Pinta que mudou de cor", hda: "Percebeu há 3 meses que uma pinta nas costas escureceu. Sem sangramento.", localizacao: "Dorso", tempo_evolucao: "3 meses", sintomas_pele: ["Crescimento recente"], fototipo: "II", protetor: "Não usa", exame_dermatologico: "Lesão pigmentada de 5 mm em dorso, bordas regulares, duas tonalidades de marrom.", abcde: ["Cores variadas"], dermatoscopia: "Padrão reticular regular, sem estruturas atípicas." },
        followUp: { evolucao: "Retorno para mapeamento. Lesão estável na comparação com a foto anterior.", adesao: "Sim", resposta: "Sem mudança", exame_dermatologico: "Lesão estável, 5 mm." },
        diagnoses: [{ code: "D22.5", name: "Nevo melanocítico do tronco", principal: true }],
        conduct: "Fotodocumentação. Protetor solar diário e autoexame mensal. Mapeamento em 6 meses.",
        returnDays: 180,
        vitals: adultVitals(r),
      },
      {
        key: "melasma",
        first: { queixa: "Manchas escuras no rosto", hda: "Manchas acastanhadas em maçãs do rosto após gestação, pioram no verão.", localizacao: "Região malar e buço", tempo_evolucao: "2 anos", sintomas_pele: [], fototipo: "IV", protetor: "Às vezes", exame_dermatologico: "Máculas acastanhadas simétricas em região malar e lábio superior." },
        followUp: { evolucao: "Clareamento parcial das manchas. Usando protetor solar diariamente.", adesao: "Em parte", resposta: "Melhora parcial", exame_dermatologico: "Máculas mais claras." },
        diagnoses: [{ code: "L81.1", name: "Cloasma", principal: true }],
        conduct: "Protetor solar com cor FPS 50 a cada 3 horas, ácido azelaico 15% à noite. Evitar exposição solar.",
        returnDays: 60,
        vitals: adultVitals(r),
      },
    ],
    clinica_geral: [
      {
        key: "has",
        first: { queixa: "Pressão alta na farmácia", hda: "Aferiu 160/100 em farmácia. Cefaleia occipital ocasional. Pai hipertenso.", antecedentes_familiares: "Pai hipertenso, mãe diabética.", habitos: ["Sedentarismo"], estado_geral: "Bom", exame_fisico: "Bulhas rítmicas normofonéticas. Sem edema." },
        followUp: { evolucao: "Medidas em casa entre 125/80 e 135/85. Sem efeitos colaterais.", adesao: "Sim", exame_fisico: "Sem alterações." },
        diagnoses: [{ code: "I10", name: "Hipertensão essencial (primária)", principal: true }],
        conduct: "Losartana 50 mg/dia. Dieta com pouco sal, caminhada 30 minutos 5 vezes por semana. MAPA e exames de rotina.",
        returnDays: 30,
        vitals: adultVitals(r, { hypertensive: true }),
        medications: [{ name: "Losartana", dose: "50 mg 1x ao dia" }],
        prescription: [{ medication: "Losartana potássica 50 mg", instructions: "1 comprimido pela manhã, uso contínuo.", quantity: "30 comprimidos", route: "oral" }],
        exams: ["Hemograma", "Creatinina", "Potássio", "Glicemia de jejum", "Perfil lipídico", "Urina tipo 1", "ECG"],
      },
      {
        key: "dm2",
        first: { queixa: "Glicemia alterada no exame", hda: "Glicemia de jejum 142 mg/dL em exame da empresa. Sede e vontade de urinar mais.", antecedentes_familiares: "Mãe diabética.", habitos: ["Sedentarismo"], estado_geral: "Bom", exame_fisico: "Acantose em região cervical. Pés sem lesões." },
        followUp: { evolucao: "Hemoglobina glicada caiu de 7,8% para 6,9%. Perdeu 3 kg.", adesao: "Sim", exames_trazidos: "HbA1c 6,9%. Glicemia de jejum 118 mg/dL.", exame_fisico: "Pés sem lesões, sensibilidade preservada." },
        diagnoses: [{ code: "E11.9", name: "Diabetes mellitus tipo 2 sem complicações", principal: true }],
        conduct: "Metformina 500 mg 2x ao dia com as refeições. Orientação alimentar e atividade física.",
        returnDays: 90,
        vitals: adultVitals(r),
        medications: [{ name: "Metformina", dose: "500 mg 2x ao dia" }],
        exams: ["Hemoglobina glicada", "Glicemia de jejum", "Microalbuminúria", "Perfil lipídico"],
      },
      {
        key: "lombalgia",
        first: { queixa: "Dor nas costas", hda: "Dor lombar há 10 dias após carregar peso, sem irradiação para as pernas.", estado_geral: "Bom", exame_fisico: "Dor à palpação de musculatura paravertebral lombar. Lasègue negativo." },
        followUp: { evolucao: "Melhora completa da dor com fisioterapia.", adesao: "Sim", exame_fisico: "Sem dor à palpação." },
        diagnoses: [{ code: "M54.5", name: "Dor lombar baixa", principal: true }],
        conduct: "Calor local, alongamentos e fisioterapia. Analgésico se dor.",
        returnDays: 30,
        vitals: adultVitals(r),
        allergies: [{ name: "Ibuprofeno", reaction: "Falta de ar", severity: "grave" }],
      },
      {
        key: "checkup",
        first: { queixa: "Check-up anual", hda: "Sem queixas. Deseja avaliação de rotina.", estado_geral: "Bom", exame_fisico: "Sem alterações." },
        followUp: { evolucao: "Exames de rotina sem alterações relevantes.", adesao: "Sim", exames_trazidos: "Exames dentro da normalidade.", exame_fisico: "Sem alterações." },
        diagnoses: [{ code: "Z00.0", name: "Exame médico geral", principal: true }],
        conduct: "Manter hábitos saudáveis. Exames de rotina anuais.",
        returnDays: 365,
        vitals: adultVitals(r),
        exams: ["Hemograma", "Glicemia de jejum", "Perfil lipídico", "TSH", "Urina tipo 1"],
      },
    ],
    pediatria: [
      {
        key: "puericultura",
        first: { queixa: "Consulta de rotina", hda: "Sem queixas. Mãe traz para acompanhamento do crescimento.", idade_gestacional: 39, tipo_parto: "Normal", peso_nascer: 3250, aleitamento: "Misto", vacinas: "Em dia (carteira conferida)", dnpm: "Adequado para a idade.", estado_geral: "Bom", perimetro_cefalico: 47 },
        followUp: { evolucao: "Crescendo bem, ganho de peso adequado.", adesao: "Sim", vacinas: "Em dia (carteira conferida)", crescimento: "Peso e altura no percentil 50.", alimentacao: "Alimentação variada." },
        diagnoses: [{ code: "Z00.1", name: "Exame de rotina de saúde da criança", principal: true }],
        conduct: "Manter vacinação em dia. Orientações sobre alimentação e sono.",
        returnDays: 180,
        vitals: () => ({ peso: r.int(12, 22), altura: r.int(85, 115), temp: 36.5 }),
      },
      {
        key: "asma",
        first: { queixa: "Chiado no peito", hda: "Episódios de chiado e tosse noturna, piora com mudança de tempo. Duas idas ao pronto-socorro no último ano.", vacinas: "Em dia (carteira conferida)", estado_geral: "Bom", exame_fisico: "Sibilos expiratórios esparsos." },
        followUp: { evolucao: "Sem crises desde a última consulta. Usando a bombinha corretamente.", adesao: "Sim", exame_fisico: "Murmúrio vesicular sem ruídos adventícios." },
        diagnoses: [{ code: "J45.9", name: "Asma não especificada", principal: true }],
        conduct: "Beclometasona spray com espaçador 2x ao dia. Plano de ação para crises entregue aos pais.",
        returnDays: 60,
        vitals: () => ({ peso: r.int(18, 30), altura: r.int(105, 135), temp: 36.6, spo2: 97 }),
        allergies: [{ name: "Amoxicilina", reaction: "Manchas na pele", severity: "leve" }],
      },
    ],
  };
}

/** Respostas do formulário: as do caso; os demais obrigatórios com um texto neutro */
function fillAnswers(fields: TemplateField[], given: Answers): Answers {
  const out: Answers = {};
  for (const f of fields) {
    if (f.type === "titulo") continue;
    const v = given[f.id];
    if (v !== undefined) {
      // Escolha que não existe no formulário: fica de fora (o formulário pode ter sido editado)
      if (f.type === "escolha" && !f.options?.includes(String(v))) continue;
      if (f.type === "multipla" && Array.isArray(v)) {
        const ok = v.filter((x) => f.options?.includes(x));
        if (ok.length) out[f.id] = ok;
        continue;
      }
      out[f.id] = v;
      continue;
    }
    if (!f.required) continue;
    if (f.type === "texto" || f.type === "texto_longo") out[f.id] = "Sem particularidades.";
    else if (f.type === "escolha" && f.options?.length) out[f.id] = f.options[0]!;
    else if (f.type === "multipla" && f.options?.length) out[f.id] = [f.options[0]!];
    else if (f.type === "escala") out[f.id] = 3;
    else if (f.type === "sim_nao") out[f.id] = false;
    else if (f.type === "numero") out[f.id] = 0;
  }
  return out;
}

/* ------------------------------------ Seed ------------------------------------ */

export async function seedDemoExtras(db: Db): Promise<void> {
  const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.tradeName, "Clínica Exemplo") });
  if (!clinic) return console.log("Complemento da demonstração: Clínica Exemplo não encontrada (rode com --demo)");
  const clinicId = clinic.id;
  const r = rng(20261023);
  const now = Date.now();
  const today = todayIso();
  const at = (dayOffset: number, time: string) => zonedToUtc(addDaysIso(today, dayOffset), time);
  const ago = (minutes: number) => new Date(now - minutes * MIN);

  const users = await db.select().from(schema.clinicUsers).where(eq(schema.clinicUsers.clinicId, clinicId));
  const userBy = (email: string) => users.find((u) => u.email === email);
  const gestor = userBy("gestor@clinicaexemplo.com.br")!;
  const recepcao = userBy("recepcao@clinicaexemplo.com.br")!;
  const beatrizUser = userBy("beatriz@clinicaexemplo.com.br")!;
  const pros = await db.select().from(schema.professionals).where(eq(schema.professionals.clinicId, clinicId));
  const proBy = (name: string) => pros.find((p) => p.name === name)!;
  const beatriz = proBy("Dra. Beatriz Lemos");
  const caio = proBy("Dr. Caio Prado");
  const helena = proBy("Dra. Helena Duarte");
  const units = await db.select().from(schema.clinicUnits).where(eq(schema.clinicUnits.clinicId, clinicId));
  const mainUnit = units.find((u) => u.main) ?? units[0]!;
  const centro = units.find((u) => !u.main) ?? mainUnit;

  /* =============================== 1. Equipe extra =============================== */

  let caioUser = userBy("caio@clinicaexemplo.com.br");
  if (!caioUser) {
    const hash = await bcrypt.hash(CRM_DEMO_PASSWORD, 12);
    // Dr. Caio com acesso próprio, ligado ao profissional da agenda (atende pelo Consultório)
    [caioUser] = await db
      .insert(schema.clinicUsers)
      .values({ clinicId, name: "Dr. Caio Prado", email: "caio@clinicaexemplo.com.br", passwordHash: hash, role: "profissional", healthCouncil: "CRM", healthCouncilNumber: "23456", healthCouncilUf: "RS" })
      .returning();
    await db.update(schema.professionals).set({ userId: caioUser!.id }).where(eq(schema.professionals.id, caio.id));
    // Enfermeira com o perfil "Enfermagem" (modelo de cargo): faz triagem, não lê o prontuário completo
    const preset = ROLE_PRESETS.find((p) => p.id === "enfermagem");
    const [role] = preset
      ? await db.insert(schema.clinicRoles).values({ clinicId, name: preset.name, description: preset.description, base: preset.base, permissions: [...preset.permissions] }).onConflictDoNothing().returning()
      : [];
    await db.insert(schema.clinicUsers).values({
      clinicId,
      name: "Joana Martins",
      email: "enfermagem@clinicaexemplo.com.br",
      passwordHash: hash,
      role: preset?.base ?? "recepcao",
      roleId: role?.id ?? null,
      healthCouncil: "COREN",
      healthCouncilNumber: "456789",
      healthCouncilUf: "RS",
    });
    // Dra. Helena com conselho (pode emitir documentos quando tiver acesso ligado)
    await db.update(schema.professionals).set({ council: "CRM", councilNumber: "34567", councilUf: "RS" }).where(eq(schema.professionals.id, helena.id));
    console.log("  Equipe extra: caio@ e enfermagem@clinicaexemplo.com.br");
  }

  /* ========================= 2. Pacientes e histórico ========================= */

  // Pacientes fictícios do histórico (adultos para Beatriz e Caio; crianças para a pediatra)
  const FIRST_F = ["Mariana", "Patrícia", "Renata", "Camila", "Luciana", "Aline", "Débora", "Vanessa", "Simone", "Cristina", "Larissa", "Tatiane"];
  const FIRST_M = ["Rafael", "Bruno", "Leandro", "Marcelo", "Gustavo", "Felipe", "André", "Rodrigo", "Diego", "Henrique", "Vinícius", "Fábio"];
  const KIDS = ["Theo", "Alice", "Miguel", "Laura", "Davi", "Helena", "Arthur", "Valentina"];
  const LAST = ["Azevedo", "Barros", "Cardoso", "Duarte", "Esteves", "Freitas", "Guimarães", "Huber", "Klein", "Lopes", "Machado", "Nogueira", "Oliveira", "Pereira", "Quadros", "Ramos", "Schmitt", "Teixeira", "Vieira", "Weber"];

  type Patient = { id: string; name: string; specialty: "dermatologia" | "clinica_geral" | "pediatria"; caseKey: string; birthDate: string; sex: "F" | "M" };
  const cases = casesFor(r);

  const existingHistory = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.clinicId, clinicId), lt(schema.appointments.startsAt, new Date(now - 30 * DAY))));
  const patients: Patient[] = [];

  if ((existingHistory[0]?.n ?? 0) < 60) {
    const used = new Set((await db.select({ name: schema.contacts.name }).from(schema.contacts).where(eq(schema.contacts.clinicId, clinicId))).map((c) => c.name));
    const thisMonth = today.slice(5, 7);
    const plan: { specialty: Patient["specialty"]; n: number }[] = [
      { specialty: "dermatologia", n: 22 },
      { specialty: "clinica_geral", n: 24 },
      { specialty: "pediatria", n: 14 },
    ];
    let idx = 0;
    for (const { specialty, n } of plan) {
      for (let i = 0; i < n; i++, idx++) {
        const kid = specialty === "pediatria";
        const sex: "F" | "M" = kid ? (i % 2 ? "M" : "F") : r.chance(0.55) ? "F" : "M";
        const first = kid ? r.pick(KIDS) : sex === "F" ? r.pick(FIRST_F) : r.pick(FIRST_M);
        let name = `${first} ${r.pick(LAST)}`;
        while (used.has(name)) name = `${first} ${r.pick(LAST)} ${r.pick(LAST)}`;
        used.add(name);
        // Dois aniversariantes HOJE e alguns no mês (Hoje e Pacientes > Aniversariantes)
        const year = kid ? r.int(2015, 2023) : r.int(1950, 2002);
        const birth = idx < 2 ? `${year}-${today.slice(5)}` : idx < 6 ? `${year}-${thisMonth}-${String(r.int(1, 28)).padStart(2, "0")}` : `${year}-${String(r.int(1, 12)).padStart(2, "0")}-${String(r.int(1, 28)).padStart(2, "0")}`;
        const phone = `55519${String(92000000 + idx * 7919).slice(0, 8)}`;
        const c = r.pick(cases[specialty]);
        const [row] = await db
          .insert(schema.contacts)
          .values({
            clinicId,
            name,
            phone,
            email: kid ? null : `${first.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.${idx}@exemplo.com.br`,
            birthDate: birth,
            sex,
            cpf: kid ? null : fakeCpf(r),
            stage: "paciente",
            stageChangedAt: new Date(now - r.int(20, 200) * DAY),
            source: r.pick(["indicação", "google", "instagram", "whatsapp", "convênio"]),
            preferredChannel: "whatsapp",
            consentMarketing: r.chance(0.75),
            consentAt: new Date(now - 200 * DAY),
            insurance: r.pick(["Particular", "Saúde Mais", "Vida Plena", "Particular"]),
            ownerId: recepcao.id,
            tags: r.chance(0.2) ? ["convênio"] : [],
            createdAt: new Date(now - 250 * DAY),
          })
          .returning({ id: schema.contacts.id });
        await db.insert(schema.contactIdentities).values({ clinicId, contactId: row!.id, channel: "whatsapp", externalId: phone, displayName: name }).onConflictDoNothing();
        patients.push({ id: row!.id, name, specialty, caseKey: c.key, birthDate: birth, sex });
      }
    }

    // Agenda dos últimos 8 meses: sem sobrepor consultas (o banco recusa) e só nos dias de trabalho
    const proPlan = [
      { pro: beatriz, specialty: "dermatologia" as const, services: ["Consulta", "Retorno", "Limpeza de pele", "Peeling"], days: [1, 2, 3, 4, 5, 6], durationAvg: 34 },
      { pro: caio, specialty: "clinica_geral" as const, services: ["Consulta", "Retorno", "Check-up"], days: [1, 2, 3, 4, 5, 6], durationAvg: 27 },
      { pro: helena, specialty: "pediatria" as const, services: ["Primeira consulta", "Puericultura", "Retorno"], days: [1, 2, 3, 4, 5], durationAvg: 38 },
    ];
    const taken = new Map<string, [number, number][]>();
    for (const a of await db.select({ p: schema.appointments.professionalId, s: schema.appointments.startsAt, e: schema.appointments.endsAt }).from(schema.appointments).where(eq(schema.appointments.clinicId, clinicId))) {
      const list = taken.get(a.p) ?? [];
      list.push([a.s.getTime(), a.e.getTime()]);
      taken.set(a.p, list);
    }
    const free = (proId: string, s: number, e: number) => !(taken.get(proId) ?? []).some(([a, b]) => s < b && a < e);
    const rows: (typeof schema.appointments.$inferInsert)[] = [];
    for (let d = -240; d <= -1; d++) {
      const iso = addDaysIso(today, d);
      const wd = weekday(iso);
      for (const pp of proPlan) {
        if (!pp.days.includes(wd)) continue;
        const perDay = r.chance(0.55) ? r.int(1, 3) : 0;
        for (let k = 0; k < perDay; k++) {
          const slot = pp.pro.slotMinutes;
          const endDay = wd === 6 ? 12 * 60 : 17 * 60;
          const startMin = 8 * 60 + slot * r.int(0, Math.floor((endDay - 8 * 60) / slot) - 1);
          if (startMin >= 12 * 60 && startMin < 13 * 60) continue; // intervalo de almoço
          const startsAt = zonedToUtc(iso, hhmm(startMin));
          const endsAt = new Date(startsAt.getTime() + slot * MIN);
          if (!free(pp.pro.id, startsAt.getTime(), endsAt.getTime())) continue;
          const list = taken.get(pp.pro.id) ?? [];
          list.push([startsAt.getTime(), endsAt.getTime()]);
          taken.set(pp.pro.id, list);
          const pool = patients.filter((p) => p.specialty === pp.specialty);
          // Alguns pacientes faltam mais (o risco aprendido precisa de padrão)
          const patient = r.pick(pool);
          const faltoso = pool.indexOf(patient) % 4 === 0;
          const roll = r.next();
          const status: AppointmentStatus = roll < (faltoso ? 0.3 : 0.08) ? "faltou" : roll < (faltoso ? 0.38 : 0.14) ? "cancelado" : "compareceu";
          const arrivedAt = status === "compareceu" ? new Date(startsAt.getTime() - r.int(-5, 15) * MIN) : null;
          const finishedAt = arrivedAt ? new Date(startsAt.getTime() + (pp.durationAvg + r.int(-8, 12)) * MIN) : null;
          rows.push({
            clinicId,
            contactId: patient.id,
            professionalId: pp.pro.id,
            startsAt,
            endsAt,
            status,
            service: r.pick(pp.services),
            source: r.pick(["recepcao", "recepcao", "conversa"]),
            arrivedAt,
            finishedAt,
            confirmedAt: status !== "cancelado" && r.chance(0.6) ? new Date(startsAt.getTime() - 20 * 60 * MIN) : null,
            cancelledAt: status === "cancelado" ? new Date(startsAt.getTime() - r.int(2, 48) * 60 * MIN) : null,
            cancelReason: status === "cancelado" ? r.pick(["Imprevisto no trabalho", "Viagem", "Remarcou para outro dia"]) : null,
            npsRequestedAt: status === "compareceu" && d > -90 ? new Date(finishedAt!.getTime() + 60 * MIN) : null,
            createdBy: recepcao.id,
            createdAt: new Date(startsAt.getTime() - r.int(2, 20) * DAY),
          });
        }
      }
    }
    for (let i = 0; i < rows.length; i += 200) await db.insert(schema.appointments).values(rows.slice(i, i + 200));

    // Pesquisa de satisfação respondida (maioria satisfeita, algumas notas baixas)
    const npsAppts = await db
      .select({ id: schema.appointments.id, contactId: schema.appointments.contactId, at: schema.appointments.npsRequestedAt })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.clinicId, clinicId), sql`${schema.appointments.npsRequestedAt} is not null`, inArray(schema.appointments.contactId, patients.map((p) => p.id))));
    const nps = npsAppts.filter(() => r.chance(0.55)).map((a) => ({ clinicId, contactId: a.contactId, appointmentId: a.id, score: r.chance(0.75) ? r.int(9, 10) : r.chance(0.6) ? r.int(7, 8) : r.int(2, 6), createdAt: new Date(a.at!.getTime() + 2 * 60 * MIN) }));
    if (nps.length) await db.insert(schema.npsResponses).values(nps);

    // Última visita; quem não vem há mais de 6 meses vai para "Reativar"
    await db.execute(sql`
      update contacts c set last_visit_at = sub.last, last_interaction_at = coalesce(c.last_interaction_at, sub.last)
      from (select contact_id, max(starts_at) as last from appointments where status = 'compareceu' and clinic_id = ${clinicId} group by contact_id) sub
      where c.id = sub.contact_id`);
    await db.execute(sql`
      update contacts set stage = 'reativar', stage_changed_at = now() - interval '5 days'
      where clinic_id = ${clinicId} and stage = 'paciente' and last_visit_at < now() - interval '180 days'
        and not exists (select 1 from appointments a where a.contact_id = contacts.id and a.starts_at > now())`);
    // Consultório e unidade de cada consulta: os da semana do profissional naquele dia
    await placeAppointments(db, clinicId, mainUnit.id);
    console.log(`  Histórico: ${patients.length} pacientes, ${rows.length} consultas em 8 meses, ${nps.length} respostas de satisfação`);
  } else {
    // Base que já tem o histórico: recupera os pacientes (para o prontuário e o dia de hoje)
    const kids = await db.select({ id: schema.contacts.id, name: schema.contacts.name, birthDate: schema.contacts.birthDate, sex: schema.contacts.sex }).from(schema.contacts).where(and(eq(schema.contacts.clinicId, clinicId), eq(schema.contacts.stage, "paciente"), isNull(schema.contacts.anonymizedAt)));
    for (const k of kids) {
      const age = ageYears(k.birthDate);
      const last = await db.select({ p: schema.appointments.professionalId }).from(schema.appointments).where(and(eq(schema.appointments.contactId, k.id), eq(schema.appointments.status, "compareceu"))).limit(1);
      const proId = last[0]?.p;
      const specialty = proId === helena.id || (age !== null && age < 14) ? "pediatria" : proId === caio.id ? "clinica_geral" : "dermatologia";
      patients.push({ id: k.id, name: k.name, specialty, caseKey: r.pick(cases[specialty]).key, birthDate: k.birthDate ?? "1980-01-01", sex: (k.sex as "F" | "M") ?? "F" });
    }
  }

  /* ===================== 3. Relacionamento, LGPD e gestão ===================== */

  const [privacyCount] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.privacyRequests).where(eq(schema.privacyRequests.clinicId, clinicId));
  if (!privacyCount?.n) {
    const year = today.slice(0, 4);
    const pick = (i: number) => patients[i % Math.max(1, patients.length)]?.id ?? null;
    await db.insert(schema.privacyRequests).values([
      // Cópia dos dados pedida há 3 dias (no prazo)
      { clinicId, protocol: `LGPD-${year}-00001`, kind: "acesso", status: "aberta", contactId: pick(3), channel: "whatsapp", requestedAt: ago(3 * 24 * 60), dueAt: new Date(now + 12 * DAY), createdBy: recepcao.id, identityChecked: true },
      // Exclusão ATRASADA (passou do prazo de 15 dias): aparece em vermelho
      { clinicId, protocol: `LGPD-${year}-00002`, kind: "exclusao", status: "aberta", contactId: pick(8), channel: "email", requestedAt: ago(18 * 24 * 60), dueAt: new Date(now - 3 * DAY), createdBy: recepcao.id },
      // Recusada com motivo (prontuário tem guarda obrigatória)
      { clinicId, protocol: `LGPD-${year}-00003`, kind: "exclusao", status: "recusada", contactId: pick(12), channel: "presencial", requestedAt: ago(40 * 24 * 60), dueAt: ago(25 * 24 * 60), createdBy: recepcao.id, decidedBy: gestor.id, decidedAt: ago(30 * 24 * 60), identityChecked: true, refusalReason: "obrigacao_legal" },
    ]);

    // Leads sem consulta (aba Leads de Conversas), dois perdidos com motivo organizado
    const leads = [
      { name: "Priscila Antunes", stage: "novo" as const, source: "instagram", lost: null },
      { name: "Otávio Brandão", stage: "em_conversa" as const, source: "google", lost: null },
      { name: "Sandra Melo", stage: "em_conversa" as const, source: "indicação", lost: null },
      { name: "Igor Fontes", stage: "perdido" as const, source: "google", lost: { category: "preco", quote: "Achei caro, vou ver em outro lugar" } },
      { name: "Mônica Reis", stage: "perdido" as const, source: "instagram", lost: { category: "convenio", quote: "Vocês não atendem o meu convênio?" } },
    ];
    for (const l of leads) {
      const [c] = await db
        .insert(schema.contacts)
        .values({ clinicId, name: l.name, stage: l.stage, source: l.source, stageChangedAt: ago(r.int(1, 20) * 24 * 60), lostReason: l.lost?.quote ?? null, createdAt: ago(r.int(5, 40) * 24 * 60), ownerId: l.stage === "novo" ? null : recepcao.id })
        .returning({ id: schema.contacts.id });
      if (l.lost) await db.insert(schema.lossReasons).values({ clinicId, contactId: c!.id, category: l.lost.category, quote: l.lost.quote, source: "regras", lostAt: ago(r.int(2, 15) * 24 * 60) });
    }
    const juliana = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.clinicId, clinicId), eq(schema.contacts.name, "Juliana Costa")) });
    if (juliana) await db.insert(schema.lossReasons).values({ clinicId, contactId: juliana.id, category: "preco", quote: "Achou o valor alto.", source: "equipe", lostAt: ago(12 * 24 * 60) });

    // Mensagens automáticas personalizadas pela clínica
    await db
      .insert(schema.messageTemplates)
      .values([
        { clinicId, key: "agendamento", body: "Olá, {{primeiro_nome}}! Sua consulta na Clínica Exemplo está marcada para {{data}} às {{hora}} com {{profissional}}{{local}}. Chegue 10 minutos antes, por favor.", updatedBy: gestor.id },
        { clinicId, key: "confirmacao", body: "Oi, {{primeiro_nome}}! Podemos confirmar sua consulta {{data}} às {{hora}} com {{profissional}}{{local}}? Responda 1 para confirmar ou 2 para remarcar.", updatedBy: gestor.id },
      ])
      .onConflictDoNothing();

    // Automações próprias (QUANDO + SE + ENTÃO), com histórico de execuções
    const [rule1, rule2] = await db
      .insert(schema.automationRules)
      .values([
        { clinicId, name: "Urgência: avisar a gestão", trigger: "urgency_flag", actions: [{ type: "create_task", text: "Ver mensagem urgente agora", dueInDays: 0, assignee: gestor.id }], runs: 3, lastRunAt: ago(8), createdBy: gestor.id },
        { clinicId, name: "Nota baixa na pesquisa: ligar para o paciente", trigger: "nps", filter: { minScore: 0, maxScore: 6 }, actions: [{ type: "create_task", text: "Ligar para entender a nota baixa", dueInDays: 1, assignee: "owner" }, { type: "add_tag", tag: "atenção" }], runs: 2, lastRunAt: ago(3 * 24 * 60), createdBy: gestor.id },
        { clinicId, name: "Perdido por preço: oferecer pacote em 30 dias", trigger: "stage_changed", filter: { stage: "perdido" }, conditions: [{ type: "stage_in", value: "perdido" }], actions: [{ type: "send_message", text: "Olá, {{primeiro_nome}}! Temos condições especiais neste mês. Quer que eu veja um horário?", approved: true }], delayMinutes: 30 * 24 * 60, oncePerContact: true, enabled: false, createdBy: gestor.id },
      ])
      .returning();
    await db.insert(schema.automationRuns).values([
      { clinicId, ruleId: rule1!.id, contactId: patients[0]?.id ?? null, event: { texto: "dor no peito" }, runAt: ago(8), status: "feita", result: "Tarefa criada", doneAt: ago(8) },
      { clinicId, ruleId: rule2!.id, contactId: patients[1]?.id ?? null, event: { nota: 5 }, runAt: ago(3 * 24 * 60), status: "feita", result: "Tarefa criada e etiqueta colocada", doneAt: ago(3 * 24 * 60) },
      { clinicId, ruleId: rule2!.id, contactId: patients[2]?.id ?? null, event: { nota: 4 }, runAt: ago(9 * 24 * 60), status: "ignorada", result: "Contato pediu SAIR", doneAt: ago(9 * 24 * 60) },
    ]);

    // Recesso de uma unidade e férias de uma profissional (Ajustes, Agenda e respostas automáticas)
    await db.insert(schema.clinicClosures).values({ clinicId, unitId: centro.id, startsOn: addDaysIso(today, 20), endsOn: addDaysIso(today, 22), reason: "Reforma da recepção", kind: "recesso", createdBy: gestor.id });
    await db.insert(schema.professionalAbsences).values({ clinicId, professionalId: helena.id, startsOn: addDaysIso(today, 30), endsOn: addDaysIso(today, 44), reason: "Férias", createdBy: gestor.id });

    // Tarefas: atrasada, de hoje, concluída e de retorno
    await db.insert(schema.tasks).values([
      { clinicId, contactId: patients[4]?.id ?? null, title: "Enviar resultado de exame por e-mail", dueDate: addDaysIso(today, -2), assigneeId: recepcao.id, createdBy: gestor.id },
      { clinicId, contactId: patients[5]?.id ?? null, title: "Confirmar convênio antes da consulta", dueDate: today, assigneeId: recepcao.id, createdBy: recepcao.id },
      { clinicId, contactId: patients[6]?.id ?? null, title: "Agendar retorno", dueDate: addDaysIso(today, 3), assigneeId: recepcao.id, kind: "retorno", createdBy: beatrizUser.id },
      { clinicId, contactId: null, title: "Conferir estoque de protetor solar da recepção", dueDate: addDaysIso(today, -5), doneAt: ago(4 * 24 * 60), assigneeId: gestor.id, createdBy: gestor.id },
    ]);
    console.log("  Relacionamento e gestão: leads, perdas, LGPD, automações, mensagens, recesso, férias e tarefas");
  }

  /* ================================ 4. Prontuário ================================ */

  // Áreas da clínica e regras (Ajustes > Prontuário)
  await db
    .insert(schema.pepSettings)
    .values({ clinicId, areas: ["medicina"], accessMode: "todos", headerNote: "Atendimento particular e convênios Saúde Mais e Vida Plena", defaultReturnDays: 30, updatedBy: gestor.id })
    .onConflictDoNothing();

  // Formulários prontos das especialidades da clínica
  const wanted = BUILT_IN_TEMPLATES.filter((t) => ["clinica_geral", "dermatologia", "pediatria"].includes(t.specialtyKey));
  const haveTpl = new Set((await db.select({ k: schema.pepTemplates.systemKey }).from(schema.pepTemplates).where(eq(schema.pepTemplates.clinicId, clinicId))).map((t) => t.k));
  const missingTpl = wanted.filter((t) => !haveTpl.has(t.key));
  if (missingTpl.length) await db.insert(schema.pepTemplates).values(missingTpl.map((t) => ({ clinicId, specialty: t.specialty, specialtyKey: t.specialtyKey, kind: t.kind, name: t.name, fields: t.fields, systemKey: t.key })));
  const templates = await db.select().from(schema.pepTemplates).where(eq(schema.pepTemplates.clinicId, clinicId));
  const tpl = (key: string) => templates.find((t) => t.systemKey === key)!;

  // Já tem prontuário de verdade (20+ atendimentos finalizados)? Então não mexe. Poucos atendimentos
  // de testes manuais não impedem a demonstração.
  const [encCount] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pepEncounters).where(and(eq(schema.pepEncounters.clinicId, clinicId), eq(schema.pepEncounters.status, "finalizado")));
  const caseOf = (p: Patient) => cases[p.specialty].find((c) => c.key === p.caseKey) ?? cases[p.specialty][0]!;
  const proOf = { dermatologia: beatriz, clinica_geral: caio, pediatria: helena } as const;
  const userOf = (proId: string) => (proId === beatriz.id ? beatrizUser : proId === caio.id ? caioUser! : null);
  const unitById = new Map(units.map((u) => [u.id, u]));

  if ((encCount?.n ?? 0) < 20 && patients.length) {
    // Resumo clínico (alergias, medicamentos, problemas) de quem tem
    for (const p of patients) {
      const c = caseOf(p);
      await db
        .insert(schema.pepPatientProfiles)
        .values({
          clinicId,
          contactId: p.id,
          allergies: c.allergies ?? [],
          noKnownAllergies: !c.allergies?.length,
          medications: c.medications ?? [],
          problems: c.diagnoses.filter((d) => !d.code.startsWith("Z")).map((d) => ({ name: d.name, cid: d.code, active: true })),
          history: p.specialty === "pediatria" ? "Nascido a termo, sem intercorrências neonatais." : null,
          updatedBy: userOf(proOf[p.specialty].id)?.id ?? null,
        })
        .onConflictDoNothing();
    }

    // Atendimentos finalizados das consultas dos últimos 5 meses (primeira consulta e depois retornos)
    const past = await db
      .select()
      .from(schema.appointments)
      .where(and(eq(schema.appointments.clinicId, clinicId), eq(schema.appointments.status, "compareceu"), gte(schema.appointments.startsAt, new Date(now - 150 * DAY)), lt(schema.appointments.startsAt, at(0, "00:00")), inArray(schema.appointments.contactId, patients.map((p) => p.id))))
      .orderBy(schema.appointments.startsAt);
    // Consultas que já têm atendimento (de testes manuais ou do "dia de hoje") ficam como estão
    const hasEncounter = new Set((await db.select({ a: schema.pepEncounters.appointmentId }).from(schema.pepEncounters).where(eq(schema.pepEncounters.clinicId, clinicId))).map((x) => x.a));
    const seen = new Set<string>();
    let finished = 0;
    let docs = 0;
    const encounterIds: { id: string; contactId: string; hash: string; userId: string | null; proId: string }[] = [];
    for (const a of past) {
      const p = patients.find((x) => x.id === a.contactId)!;
      const pro = pros.find((x) => x.id === a.professionalId)!;
      if (proOf[p.specialty].id !== pro.id || hasEncounter.has(a.id) || r.chance(0.25)) continue;
      const c = caseOf(p);
      const first = !seen.has(`${p.id}:${pro.id}`);
      seen.add(`${p.id}:${pro.id}`);
      const t = tpl(`${p.specialty}_${first ? "primeira" : "retorno"}`);
      const answers = fillAnswers(t.fields, first ? c.first : c.followUp);
      const id = randomUUID();
      const startedAt = new Date((a.arrivedAt ?? a.startsAt).getTime() + 5 * MIN);
      const finishedAt = a.finishedAt ?? new Date(startedAt.getTime() + 25 * MIN);
      const author = userOf(pro.id);
      const record = {
        id,
        contactId: p.id,
        professionalId: pro.id,
        templateFields: t.fields,
        answers,
        vitals: c.vitals(),
        diagnoses: c.diagnoses,
        conduct: first ? c.conduct : "Manter conduta. Orientações reforçadas.",
        returnDays: c.returnDays,
        returnNote: null,
        startedAt,
      };
      // Mesmo cálculo de apps/app/src/modules/pep/records.ts (encounterHashContent)
      const hash = contentHash({ ...record, fields: record.templateFields, templateFields: undefined, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), finishedBy: author?.id ?? "" });
      await db.insert(schema.pepEncounters).values({
        ...record,
        clinicId,
        appointmentId: a.id,
        unitId: a.unitId ?? mainUnit.id,
        templateId: t.id,
        templateName: t.name,
        status: "finalizado",
        finishedAt,
        finishedBy: author?.id ?? null,
        hash,
        createdBy: author?.id ?? null,
        version: 3,
        createdAt: startedAt,
      });
      finished++;
      encounterIds.push({ id, contactId: p.id, hash, userId: author?.id ?? null, proId: pro.id });
      if (author) await db.insert(schema.pepAudit).values([
        { clinicId, userId: author.id, userName: author.name, contactId: p.id, encounterId: id, action: "abrir", at: startedAt },
        { clinicId, userId: author.id, userName: author.name, contactId: p.id, encounterId: id, action: "finalizar", at: finishedAt },
      ]);

      // Documentos da primeira consulta (receita e pedido de exames), com código de verificação
      if (first && author && pro.council && pro.councilNumber) {
        const unit = unitById.get(a.unitId ?? mainUnit.id) ?? mainUnit;
        const contents: DocumentContent[] = [];
        if (c.prescription) contents.push(documentContentSchema.parse({ kind: "receita", items: c.prescription }));
        if (c.exams) contents.push(documentContentSchema.parse({ kind: "pedido_exames", items: c.exams, indication: c.diagnoses[0]?.name }));
        for (const content of contents) {
          const contact = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, p.id) });
          const header = {
            clinic: {
              name: clinic.tradeName,
              document: [clinic.cnpj ? `CNPJ ${clinic.cnpj}` : null, unit.cnes ? `CNES ${unit.cnes}` : null].filter(Boolean).join("  |  ") || null,
              address: formatAddress(unit) || [clinic.city, clinic.state].filter(Boolean).join(" - ") || null,
              phone: unit.phone ?? clinic.phone ?? null,
              note: "Atendimento particular e convênios Saúde Mais e Vida Plena",
            },
            professional: { name: pro.name, specialty: pro.specialty, council: `${pro.council}${pro.councilUf ? `-${pro.councilUf}` : ""} ${pro.councilNumber}` },
            patient: { name: contact!.name, cpf: contact!.cpf ? `${contact!.cpf.slice(0, 3)}.${contact!.cpf.slice(3, 6)}.${contact!.cpf.slice(6, 9)}-${contact!.cpf.slice(9)}` : null, birthDate: contact!.birthDate, age: ageYears(contact!.birthDate, finishedAt) },
          };
          const issuedAt = new Date(finishedAt.getTime() - 3 * MIN);
          // Mesmo cálculo de issueDocument (records.ts): a verificação pública confere este hash
          const docHash = contentHash({ kind: content.kind, content, header, encounterId: id, issuedAt: issuedAt.toISOString(), issuedBy: author.id });
          const [doc] = await db
            .insert(schema.pepDocuments)
            .values({ clinicId, encounterId: id, contactId: p.id, professionalId: pro.id, kind: content.kind, content, header, hash: docHash, verificationCode: verificationCode(docHash, randomUUID()), issuedBy: author.id, issuedAt })
            .returning({ id: schema.pepDocuments.id });
          await db.insert(schema.pepAudit).values({ clinicId, userId: author.id, userName: author.name, contactId: p.id, encounterId: id, documentId: doc!.id, action: "emitir", at: issuedAt });
          docs++;
        }
      }
    }

    // Um documento cancelado (emitido por engano) e um adendo
    const [docToRevoke] = await db.select().from(schema.pepDocuments).where(and(eq(schema.pepDocuments.clinicId, clinicId), eq(schema.pepDocuments.kind, "pedido_exames"))).limit(1);
    if (docToRevoke) {
      await db.update(schema.pepDocuments).set({ revokedAt: new Date(docToRevoke.issuedAt.getTime() + 10 * MIN), revokedBy: docToRevoke.issuedBy, revokeReason: "Exame pedido em duplicidade" }).where(eq(schema.pepDocuments.id, docToRevoke.id));
      await db.insert(schema.pepAudit).values({ clinicId, userId: docToRevoke.issuedBy, userName: "Dr. Caio Prado", contactId: docToRevoke.contactId, documentId: docToRevoke.id, action: "cancelar_documento", reason: "Exame pedido em duplicidade", at: new Date(docToRevoke.issuedAt.getTime() + 10 * MIN) });
    }
    const withAuthor = encounterIds.filter((e) => e.userId);
    const target = withAuthor[Math.floor(withAuthor.length / 2)];
    if (target) {
      const author = users.find((u) => u.id === target.userId) ?? caioUser!;
      const text = "Paciente ligou informando reação leve (vermelhidão) no 3º dia. Orientado a suspender por 2 dias e retomar em dias alternados.";
      const createdAt = ago(20 * 24 * 60);
      await db.insert(schema.pepAddenda).values({ clinicId, encounterId: target.id, text, authorId: author.id, authorName: author.name, hash: contentHash({ encounterId: target.id, encounterHash: target.hash, text, authorId: author.id, at: createdAt.toISOString() }), createdAt });
      await db.insert(schema.pepAudit).values({ clinicId, userId: author.id, userName: author.name, contactId: target.contactId, encounterId: target.id, action: "adendo", at: createdAt });
    }

    // Atendimento ESQUECIDO em rascunho (de outro dia): aparece no Consultório da Beatriz
    // A consulta mais recente da Beatriz (dos últimos 15 dias) que ainda não tem atendimento
    const withEncounter = new Set((await db.select({ a: schema.pepEncounters.appointmentId }).from(schema.pepEncounters).where(eq(schema.pepEncounters.clinicId, clinicId))).map((x) => x.a));
    const stale = past.filter((a) => a.professionalId === beatriz.id && a.startsAt.getTime() > now - 15 * DAY && !withEncounter.has(a.id)).reverse()[0] ?? null;
    if (stale) {
      {
        const t = tpl("dermatologia_retorno");
        await db.insert(schema.pepEncounters).values({ clinicId, contactId: stale.contactId, professionalId: beatriz.id, appointmentId: stale.id, unitId: stale.unitId ?? mainUnit.id, templateId: t.id, templateName: t.name, templateFields: t.fields, answers: { evolucao: "Paciente refere melhora parcial." }, startedAt: stale.arrivedAt ?? stale.startsAt, createdBy: beatrizUser.id });
      }
    }

    // Acesso de emergência (Dr. Caio abriu paciente da dermatologia) com aviso no sino da gestão
    const dermPatient = patients.find((p) => p.specialty === "dermatologia");
    if (dermPatient && caioUser) {
      const [em] = await db
        .insert(schema.pepAudit)
        .values({ clinicId, userId: caioUser.id, userName: caioUser.name, contactId: dermPatient.id, action: "emergencia", reason: "Paciente com reação alérgica na recepção, dermatologista ausente", at: ago(26 * 60) })
        .returning({ id: schema.pepAudit.id });
      await db.insert(schema.userNotices).values({
        clinicId,
        userId: gestor.id,
        kind: "pep_emergencia",
        title: "Acesso de emergência ao prontuário",
        body: `${caioUser.name} abriu o prontuário de ${dermPatient.name}: "Paciente com reação alérgica na recepção, dermatologista ausente"`,
        href: "/configuracoes/prontuario",
        contactId: dermPatient.id,
        refId: em!.id,
        urgent: true,
        createdAt: ago(26 * 60),
      });
      await db.insert(schema.pepAudit).values({ clinicId, userId: gestor.id, userName: gestor.name, contactId: dermPatient.id, action: "exportar", reason: "Paciente pediu cópia, presencial", at: ago(6 * 24 * 60) });
    }
    console.log(`  Prontuário: ${finished} atendimentos finalizados, ${docs} documentos, adendo, rascunho esquecido e acesso de emergência`);
  }

  /* ============================== 5. Dia de hoje ============================== */

  const { start: dayStart, end: dayEnd } = { start: at(0, "00:00"), end: at(1, "00:00") };
  const todays = await db
    .select({ id: schema.appointments.id, p: schema.appointments.professionalId, s: schema.appointments.startsAt, e: schema.appointments.endsAt })
    .from(schema.appointments)
    .where(and(eq(schema.appointments.clinicId, clinicId), gte(schema.appointments.startsAt, dayStart), lt(schema.appointments.startsAt, dayEnd)));
  const beatrizToday = todays.filter((a) => a.p === beatriz.id).length;
  const adults = patients.filter((p) => p.specialty !== "pediatria");
  if (beatrizToday < 4 && adults.length >= 8) {
    // Horários em volta de "agora" (entre 10h30 e 18h30), sem colidir com o que já existe hoje
    const nowParts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(now)).split(":").map(Number) as [number, number];
    const nowMin = nowParts[0] * 60 + nowParts[1];
    const pivot = Math.min(18 * 60 + 30, Math.max(10 * 60 + 30, Math.floor(nowMin / 30) * 30));
    const busy = (proId: string, s: number, e: number) => todays.some((a) => a.p === proId && s < a.e.getTime() && a.s.getTime() < e);
    type Step = { offset: number; flow: "finalizado" | "faltou" | "em_atendimento" | "triado" | "chegou" | "aguardando"; priority?: "urgente" | "prioritario"; complaint?: string };
    const steps: Step[] = [
      { offset: -150, flow: "finalizado" },
      { offset: -120, flow: "finalizado" },
      { offset: -90, flow: "faltou" },
      { offset: -30, flow: "em_atendimento" },
      { offset: 0, flow: "triado", priority: "urgente", complaint: "Inchaço no rosto e coceira após usar creme novo" },
      { offset: 30, flow: "triado", priority: "prioritario", complaint: "Lesão que sangra no couro cabeludo" },
      { offset: 60, flow: "chegou" },
      { offset: 120, flow: "aguardando" },
    ];
    let made = 0;
    for (const [i, s] of steps.entries()) {
      for (const pp of [{ pro: beatriz, user: beatrizUser, specialty: "dermatologia" as const }, { pro: caio, user: caioUser!, specialty: "clinica_geral" as const }]) {
        // Dr. Caio recebe metade dos passos (o Consultório da gestão mostra os dois)
        if (pp.pro.id === caio.id && i % 2) continue;
        let startMin = pivot + s.offset;
        let startsAt = zonedToUtc(today, hhmm(startMin));
        let endsAt = new Date(startsAt.getTime() + pp.pro.slotMinutes * MIN);
        let guard = 0;
        while (busy(pp.pro.id, startsAt.getTime(), endsAt.getTime()) && guard++ < 6) {
          startMin += 15;
          startsAt = zonedToUtc(today, hhmm(startMin));
          endsAt = new Date(startsAt.getTime() + pp.pro.slotMinutes * MIN);
        }
        if (startMin >= 21 * 60 || busy(pp.pro.id, startsAt.getTime(), endsAt.getTime())) continue;
        todays.push({ id: "", p: pp.pro.id, s: startsAt, e: endsAt });
        const pool = patients.filter((p) => p.specialty === pp.specialty);
        const patient = pool[(i + (pp.pro.id === caio.id ? 3 : 0)) % pool.length]!;
        const arrived = ["finalizado", "em_atendimento", "triado", "chegou"].includes(s.flow);
        const arrivedAt = arrived ? new Date(Math.min(now - 2 * MIN, startsAt.getTime() - 10 * MIN)) : null;
        const [appt] = await db
          .insert(schema.appointments)
          .values({
            clinicId,
            contactId: patient.id,
            professionalId: pp.pro.id,
            startsAt,
            endsAt,
            status: s.flow === "faltou" ? "faltou" : arrived ? "compareceu" : i % 2 ? "confirmado" : "agendado",
            service: s.offset < 0 ? "Retorno" : "Consulta",
            source: "recepcao",
            arrivedAt,
            finishedAt: s.flow === "finalizado" ? new Date(startsAt.getTime() + 28 * MIN) : null,
            confirmedAt: !arrived && i % 2 ? ago(18 * 60) : null,
            createdBy: recepcao.id,
            createdAt: ago(7 * 24 * 60),
          })
          .returning();
        made++;
        // Local da semana do profissional (unidade e consultório) antes do atendimento usar a unidade
        await placeAppointments(db, clinicId, mainUnit.id);
        const [placed] = await db.select({ unitId: schema.appointments.unitId }).from(schema.appointments).where(eq(schema.appointments.id, appt!.id));
        // Triagem (enfermagem) com sinais vitais; urgente acende a faixa vermelha e o sino
        if (s.flow === "triado" || s.flow === "em_atendimento" || s.flow === "finalizado") {
          const vit: Vitals = s.priority === "urgente" ? { pas: 152, pad: 96, fc: 112, spo2: 95, temp: 37.2 } : { pas: r.int(110, 130), pad: r.int(70, 84), fc: r.int(64, 86), spo2: 98 };
          const [tr] = await db
            .insert(schema.pepTriages)
            .values({ clinicId, contactId: patient.id, appointmentId: appt!.id, complaint: s.complaint ?? "Retorno de rotina", vitals: vit, priority: s.priority ?? "normal", notes: s.priority === "urgente" ? "Edema palpebral discreto, sem falta de ar." : null, recordedByName: "Joana Martins", createdAt: arrivedAt ?? new Date(now) })
            .returning({ id: schema.pepTriages.id });
          if (s.priority === "urgente") {
            await db
              .insert(schema.userNotices)
              .values({ clinicId, userId: pp.user.id, kind: "triagem_urgente", title: "Triagem urgente", body: `${patient.name}: ${s.complaint}`, href: "/consultorio", contactId: patient.id, refId: tr!.id, urgent: true, createdAt: arrivedAt ?? new Date(now) })
              .onConflictDoNothing();
          }
        }
        // Atendimento: finalizado (com hash) ou em andamento (rascunho)
        if (s.flow === "finalizado" || s.flow === "em_atendimento") {
          const c = caseOf(patient);
          const t = tpl(`${pp.specialty}_retorno`);
          const id = randomUUID();
          const startedAt = new Date((arrivedAt ?? startsAt).getTime() + 5 * MIN);
          const record = { id, contactId: patient.id, professionalId: pp.pro.id, templateFields: t.fields, answers: fillAnswers(t.fields, s.flow === "finalizado" ? c.followUp : { evolucao: "Paciente refere melhora." }), vitals: c.vitals(), diagnoses: s.flow === "finalizado" ? c.diagnoses : [], conduct: s.flow === "finalizado" ? "Manter conduta." : null, returnDays: s.flow === "finalizado" ? c.returnDays : null, returnNote: null, startedAt };
          const finishedAt = s.flow === "finalizado" ? new Date(startsAt.getTime() + 28 * MIN) : null;
          const hash = finishedAt ? contentHash({ ...record, fields: record.templateFields, templateFields: undefined, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), finishedBy: pp.user.id }) : null;
          await db.insert(schema.pepEncounters).values({ ...record, clinicId, appointmentId: appt!.id, unitId: placed?.unitId ?? mainUnit.id, templateId: t.id, templateName: t.name, status: finishedAt ? "finalizado" : "rascunho", finishedAt, finishedBy: finishedAt ? pp.user.id : null, hash, createdBy: pp.user.id });
        }
      }
    }
    await placeAppointments(db, clinicId, mainUnit.id);
    console.log(`  Dia de hoje: ${made} consultas no Consultório (finalizados, falta, em atendimento, triagem urgente, chegou e a chegar)`);
  } else {
    console.log("  Dia de hoje: já montado");
  }
}

/**
 * Unidade e consultório de cada consulta sem consultório: os da semana do profissional naquele dia.
 * (O banco já põe a unidade principal ao criar; aqui entra o local certo da semana.)
 */
async function placeAppointments(db: Db, clinicId: string, mainUnitId: string) {
  await db.execute(sql`
    update appointments a set
      unit_id = coalesce((p.weekly_schedule -> extract(dow from a.starts_at at time zone 'America/Sao_Paulo')::int::text -> 'periods' -> 0 ->> 'unitId')::uuid, ${mainUnitId}::uuid),
      room_id = (p.weekly_schedule -> extract(dow from a.starts_at at time zone 'America/Sao_Paulo')::int::text -> 'periods' -> 0 ->> 'roomId')::uuid
    from professionals p
    where p.id = a.professional_id and a.clinic_id = ${clinicId} and a.room_id is null
      and p.weekly_schedule -> extract(dow from a.starts_at at time zone 'America/Sao_Paulo')::int::text -> 'periods' -> 0 ->> 'roomId' is not null`);
}

/**
 * Roda o complemento numa conexão própria (usado pelos testes de ponta a ponta para recolocar o
 * prontuário de demonstração depois que outros testes limparam os dados clínicos).
 */
export async function runDemoExtras(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 2 });
  try {
    await seedDemoExtras(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
