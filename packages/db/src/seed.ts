/**
 * Dados iniciais.
 *
 *   pnpm db:seed           -> catálogo (módulos, funcionalidades, planos) + administrador
 *   pnpm db:seed -- --demo -> também cria leads, clínicas e equipe FICTÍCIOS para testes
 *
 * Pode rodar várias vezes: o que já existe não é duplicado.
 * Os preços são valores iniciais de exemplo e podem ser alterados no backoffice.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { ModuleId, StaffRole } from "@ecosaude/core";
import { explainDbError } from "./diagnose";
import * as schema from "./schema";
import * as crmSchema from "./schema-crm";
import { seedCrmDemo } from "./seed-crm";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool, { schema });
const demo = process.argv.includes("--demo");

/* --------------------------------- Catálogo -------------------------------- */

const catalog: {
  id: ModuleId;
  name: string;
  description: string;
  submodules: [key: string, name: string][];
  plans: { name: string; price: number; maxUsers: number | null; description: string; features: string[] | "all" }[];
}[] = [
  {
    id: "crm",
    name: "CRM",
    description: "Relacionamento com pacientes",
    submodules: [
      ["crm.inbox", "Caixa de entrada omnichannel"],
      ["crm.funnel", "Funil de captação"],
      ["crm.confirmations", "Confirmação de consultas"],
      ["crm.waitlist", "Lista de espera inteligente"],
      ["crm.campaigns", "Campanhas de retorno"],
      ["crm.nps", "Pesquisa de satisfação"],
      ["crm.noshow_risk", "Risco de falta"],
    ],
    plans: [
      { name: "Essencial", price: 24900, maxUsers: 3, description: "Para começar a organizar o atendimento.", features: ["crm.inbox", "crm.funnel", "crm.confirmations"] },
      { name: "Profissional", price: 54900, maxUsers: 10, description: "Automação de agenda e retorno.", features: ["crm.inbox", "crm.funnel", "crm.confirmations", "crm.waitlist", "crm.campaigns", "crm.nps"] },
      { name: "Corporativo", price: 129000, maxUsers: null, description: "Todas as funcionalidades, sem limite de usuários.", features: "all" },
    ],
  },
  {
    id: "erp",
    name: "ERP",
    description: "Gestão da clínica",
    submodules: [
      ["erp.cashflow", "Financeiro e caixa"],
      ["erp.tiss", "Faturamento TISS"],
      ["erp.stock", "Estoque e compras"],
      ["erp.payouts", "Repasse médico"],
      ["erp.invoices", "Notas fiscais"],
    ],
    plans: [
      { name: "Gestão", price: 29900, maxUsers: 5, description: "Financeiro e estoque.", features: ["erp.cashflow", "erp.stock"] },
      { name: "Completo", price: 69900, maxUsers: null, description: "Inclui convênios, repasse e notas.", features: "all" },
    ],
  },
  {
    id: "pep",
    name: "Prontuário",
    description: "Prontuário eletrônico",
    submodules: [
      ["pep.evolution", "Evolução por especialidade"],
      ["pep.prescriptions", "Prescrição e atestados"],
      ["pep.exams", "Solicitação de exames"],
      ["pep.attachments", "Anexos e imagens"],
      ["pep.signature", "Assinatura digital"],
    ],
    plans: [
      { name: "Essencial", price: 19900, maxUsers: 5, description: "Registro clínico completo.", features: ["pep.evolution", "pep.prescriptions", "pep.exams"] },
      { name: "Completo", price: 44900, maxUsers: null, description: "Com anexos e assinatura digital.", features: "all" },
    ],
  },
  {
    id: "bi",
    name: "BI",
    description: "Indicadores e análises",
    submodules: [
      ["bi.dashboards", "Painéis por perfil"],
      ["bi.occupancy", "Ocupação de agenda"],
      ["bi.revenue_origin", "Receita por origem"],
      ["bi.nl_queries", "Perguntas em linguagem natural"],
    ],
    plans: [
      { name: "Painéis", price: 14900, maxUsers: null, description: "Painéis prontos.", features: ["bi.dashboards", "bi.occupancy"] },
      { name: "Avançado", price: 34900, maxUsers: null, description: "Com análises de receita e perguntas livres.", features: "all" },
    ],
  },
];

async function seedCatalog() {
  for (const [order, mod] of catalog.entries()) {
    await db
      .insert(schema.modules)
      .values({ id: mod.id, name: mod.name, description: mod.description, sortOrder: order })
      .onConflictDoNothing();

    for (const [i, [key, name]] of mod.submodules.entries()) {
      await db
        .insert(schema.submodules)
        .values({ moduleId: mod.id, key, name, sortOrder: i })
        .onConflictDoNothing();
    }

    const subs = await db.select().from(schema.submodules).where(eq(schema.submodules.moduleId, mod.id));
    for (const plan of mod.plans) {
      const [created] = await db
        .insert(schema.plans)
        .values({
          moduleId: mod.id,
          name: plan.name,
          description: plan.description,
          priceMonthlyCents: plan.price,
          maxUsers: plan.maxUsers,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) continue; // plano já existia: não mexe no que foi editado no backoffice
      const included = plan.features === "all" ? subs : subs.filter((s) => plan.features.includes(s.key));
      await db.insert(schema.planSubmodules).values(included.map((s) => ({ planId: created.id, submoduleId: s.id })));
    }
  }
  console.log("Catálogo: ok");
}

/* ------------------------------- Equipe ------------------------------------ */

/** Gera uma senha aleatória forte (usada quando nenhuma foi informada). */
function randomPassword(): string {
  return `${randomBytes(9).toString("base64url")}A1`;
}

async function ensureStaff(name: string, email: string, role: StaffRole, password: string) {
  const existing = await db.query.staffUsers.findFirst({
    where: sql`lower(${schema.staffUsers.email}) = lower(${email})`,
  });
  if (existing) return { created: false as const };
  await db.insert(schema.staffUsers).values({
    name,
    email,
    role,
    passwordHash: await bcrypt.hash(password, 12),
    mustChangePassword: true,
  });
  return { created: true as const };
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@ecosaude.local";
  const given = process.env.SEED_ADMIN_PASSWORD;
  const password = given || randomPassword();
  const { created } = await ensureStaff("Administrador", email, "admin", password);
  if (!created) return console.log(`Administrador ${email}: já existia`);
  console.log(`Administrador criado: ${email}`);
  if (!given) console.log(`  Senha temporária (aparece só agora): ${password}`);
  console.log("  Será pedida a troca de senha no primeiro acesso.");
}

/* ----------------------------- Dados de demonstração ----------------------- */

async function seedDemo() {
  const team: [string, string, StaffRole][] = [
    ["Carla Comercial", "comercial@ecosaude.local", "comercial"],
    ["Sérgio Suporte", "suporte@ecosaude.local", "suporte"],
    ["Fábio Financeiro", "financeiro@ecosaude.local", "financeiro"],
  ];
  const demoPassword = "Demo-EcoSaude-2026";
  for (const [name, email, role] of team) await ensureStaff(name, email, role, demoPassword);
  console.log(`Equipe de demonstração: senha "${demoPassword}" (troca obrigatória no 1º acesso)`);

  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(schema.leads)) as [{ total: number }];
  if (total > 0) return console.log("Leads de demonstração: já existiam");

  const comercial = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.role, "comercial") });
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const sample = [
    ["Marina Costa", "Clínica Sorriso Pleno", "4-10", ["crm"], "novo", 0],
    ["Paulo Henrique", "Instituto Cardio Sul", "11-30", ["crm", "pep"], "novo", 1],
    ["Beatriz Lemos", "Dermato Bem-Estar", "1-3", ["crm"], "contato", 3],
    ["Ricardo Alves", "Ortopedia Movimento", "4-10", ["crm", "erp"], "demonstracao", 6],
    ["Juliana Faria", "Centro Pediátrico Aquarela", "11-30", ["crm", "erp", "pep", "bi"], "proposta", 9],
    ["André Souza", "Fisio Vida", "1-3", ["crm"], "perdido", 15],
    ["Letícia Moraes", "Clínica Olhar", "4-10", ["crm", "bi"], "ganho", 20],
  ] as const;

  for (const [name, clinicName, size, interests, stage, ago] of sample) {
    const created = new Date(now - ago * day);
    await db.insert(schema.leads).values({
      name,
      email: `${name.split(" ")[0]!.toLowerCase()}@exemplo.com.br`,
      clinicName,
      size,
      interests: [...interests],
      consentAt: created,
      stage,
      ownerId: stage === "novo" ? null : (comercial?.id ?? null),
      lostReason: stage === "perdido" ? "Optou por manter o sistema atual." : null,
      createdAt: created,
      updatedAt: created,
    });
  }

  // Cliente fictício já convertido, com duas contratações
  const [clinic] = await db
    .insert(schema.clinics)
    .values({ tradeName: "Clínica Olhar", legalName: "Olhar Serviços Médicos Ltda.", city: "Porto Alegre", state: "RS", email: "contato@olhar.exemplo.com.br" })
    .returning();
  await db.update(schema.leads).set({ clinicId: clinic!.id }).where(eq(schema.leads.clinicName, "Clínica Olhar"));

  const crmPro = await db.query.plans.findFirst({ where: and(eq(schema.plans.moduleId, "crm"), eq(schema.plans.name, "Profissional")) });
  const biPaineis = await db.query.plans.findFirst({ where: and(eq(schema.plans.moduleId, "bi"), eq(schema.plans.name, "Painéis")) });
  await db.insert(schema.subscriptions).values([
    { clinicId: clinic!.id, planId: crmPro!.id, moduleId: "crm", status: "ativa", priceMonthlyCents: crmPro!.priceMonthlyCents, startedAt: new Date(now - 18 * day) },
    { clinicId: clinic!.id, planId: biPaineis!.id, moduleId: "bi", status: "teste", priceMonthlyCents: biPaineis!.priceMonthlyCents, trialEndsAt: new Date(now + 4 * day) },
  ]);
  console.log("Leads, clínica e contratações de demonstração: ok");
}

/* ----------------------------------- Main ---------------------------------- */

try {
  await seedCatalog();
  await seedAdmin();
  if (demo) {
    await seedDemo();
    // CRM usa o esquema completo (plataforma + CRM)
    await seedCrmDemo(drizzle(pool, { schema: { ...schema, ...crmSchema } }));
  }
} catch (error) {
  console.error("Falha no seed.\n");
  console.error(explainDbError(error, url));
  process.exitCode = 1;
} finally {
  await pool.end();
}
