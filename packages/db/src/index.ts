/**
 * Conexão com o PostgreSQL + utilitários de dados compartilhados.
 *
 * Uso nos apps:
 *   import { db, schema, eq } from "@ecosaude/db";
 *   const lista = await db.select().from(schema.leads);
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { SUBSCRIPTION_ENABLED_STATUSES, type ModuleId } from "@ecosaude/core";
import { DEFAULT_CLINIC_TIMEZONE, isBrTimeZone, setTimeZoneResolver } from "@ecosaude/core/crm";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ensureEnv } from "./env";
import * as baseSchema from "./schema";
import migrationJournal from "../migrations/meta/_journal.json";
import * as crmSchema from "./schema-crm";

export { ensureEnv };

/** Todas as tabelas e relações (plataforma + CRM) num objeto só. */
export const schema = { ...baseSchema, ...crmSchema };
// Reexporta os operadores mais usados para os apps não dependerem do drizzle diretamente
export { and, asc, avg, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql, sum } from "drizzle-orm";
export type { SQL } from "drizzle-orm";

export type Database = NodePgDatabase<typeof schema>;
/** Tipo de uma transação, para funções que aceitam db OU transação. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Em desenvolvimento o Next.js recarrega os módulos a cada alteração.
 * Guardamos o pool em globalThis para não abrir uma conexão nova a cada recarga
 * (o que esgotaria o limite de conexões do PostgreSQL).
 */
const globalForDb = globalThis as unknown as { __ecosaudePool?: Pool };

function createPool(): Pool {
  ensureEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não definida. Copie .env.example para .env e preencha.");
  }
  return new Pool({
    connectionString: url,
    // Em serverless (Vercel) cada instância deve abrir poucas conexões.
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: 20_000,
  });
}

/** Cria a conexão só quando alguém realmente usa o banco (evita erro no build). */
function getPool(): Pool {
  if (!globalForDb.__ecosaudePool) globalForDb.__ecosaudePool = createPool();
  return globalForDb.__ecosaudePool;
}

let _db: Database | undefined;
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    _db ??= drizzle(getPool(), { schema });
    return Reflect.get(_db, prop, _db);
  },
});

/* ------------------------ Acesso isolado por clínica ------------------------ */

/** Papel do PostgreSQL usado pelo app da clínica (criado na migração 0005). */
export const TENANT_ROLE = "ecosaude_tenant";

/**
 * Executa `fn` numa transação "presa" a uma clínica.
 *
 * 1. `app.clinic_id` = clínica da sessão (vale só dentro da transação)
 * 2. `SET LOCAL ROLE ecosaude_tenant`: papel sujeito ao Row-Level Security
 *
 * Resultado: mesmo que uma consulta esqueça o filtro por clínica, o banco
 * devolve só as linhas da clínica certa e recusa gravar em outra.
 * Funciona com pool de conexões, porque tudo é desfeito ao fim da transação.
 */
export async function withTenant<T>(clinicId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(clinicId)) throw new Error("Clínica inválida.");
  return withClinicTimeZone(clinicId, (tz) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.clinic_id', ${clinicId}, true)`);
      // Fuso da clínica também no SQL: "hoje", ::date e to_char() seguem o horário local dela
      await tx.execute(sql`select set_config('TimeZone', ${tz}, true)`);
      await tx.execute(sql.raw(`set local role ${TENANT_ROLE}`));
      return fn(tx);
    }),
  );
}

/* ------------------------- Fuso horário da clínica -------------------------- */

/**
 * FUSO POR CLÍNICA (contexto por requisição)
 *
 * Cada requisição (tela, ação, rotina, webhook) roda "dentro" do fuso da clínica.
 * As funções de data do núcleo (todayIso, formatWhen, horários livres...) leem o fuso
 * daqui sozinhas, então nenhuma chamada precisa lembrar de passar o fuso.
 *
 * Onde o contexto é aberto:
 *  - withTenant (toda transação da clínica);
 *  - (telas, ações e rotas: o app liga o fuso à requisição, ver apps/app/src/lib/clinic-tz.ts);
 *  - rotinas e webhooks (withClinicTimeZone em volta do trabalho de cada clínica).
 * Fora de qualquer contexto (ex.: backoffice): fuso padrão (Brasília).
 */
const tzStore = new AsyncLocalStorage<{ clinicId: string; tz: string }>();
setTimeZoneResolver(() => tzStore.getStore()?.tz);

/** Cache curto: o fuso quase nunca muda (troca em Ajustes vale em até 1 minuto). */
const tzCache = new Map<string, { tz: string; at: number }>();
const TZ_TTL_MS = 60_000;

export async function clinicTimeZoneOf(clinicId: string): Promise<string> {
  const hit = tzCache.get(clinicId);
  if (hit && Date.now() - hit.at < TZ_TTL_MS) return hit.tz;
  const r = await db.execute<{ time_zone: string }>(sql`select time_zone from clinics where id = ${clinicId}`);
  const tz = isBrTimeZone(r.rows[0]?.time_zone) ? r.rows[0]!.time_zone : DEFAULT_CLINIC_TIMEZONE;
  tzCache.set(clinicId, { tz, at: Date.now() });
  return tz;
}

/** Fuso do contexto atual (ou undefined fora de contexto). O app combina com o da renderização. */
export function currentClinicTimeZone(): string | undefined {
  return tzStore.getStore()?.tz;
}

/** Esquece o fuso guardado (chamar depois de trocar o fuso em Ajustes). */
export function forgetClinicTimeZone(clinicId: string): void {
  tzCache.delete(clinicId);
}

/** Roda `fn` no fuso da clínica. Se já estiver no contexto dessa clínica, só roda. */
export async function withClinicTimeZone<T>(clinicId: string, fn: (tz: string) => Promise<T>): Promise<T> {
  const cur = tzStore.getStore();
  if (cur?.clinicId === clinicId) return fn(cur.tz);
  const tz = await clinicTimeZoneOf(clinicId);
  return tzStore.run({ clinicId, tz }, () => fn(tz));
}

/*
 * Importante: NÃO existe "entrar no fuso para o resto da requisição" (enterWith).
 * Testado no Next.js: além de não voltar para quem chamou, deixa um contexto antigo
 * "grudado" que outra requisição pode herdar (vazamento entre clínicas). O contexto
 * daqui só é aberto por run(), com começo e fim: transações e rotinas. Telas, ações e
 * rotas de API usam o fuso ligado à requisição (apps/app/src/lib/clinic-tz.ts).
 */

/**
 * Executa várias consultas, UMA DE CADA VEZ, e devolve os resultados na ordem.
 *
 * Por que não Promise.all dentro de withTenant? A transação usa UMA única
 * conexão. Disparar várias consultas ao mesmo tempo nessa conexão não deixa
 * nada mais rápido (o PostgreSQL atende uma por vez na mesma conexão) e o
 * driver pg avisa: "Calling client.query() when the client is already
 * executing a query is deprecated" (vira erro no pg@9).
 *
 * Uso (cada item é uma FUNÇÃO que cria a consulta, para ela só começar na sua vez):
 *   const [a, b] = await inSequence([() => tx.select()..., () => tx.query.x.findMany(...)]);
 *
 * Fora de transação (usando `db`, que é um pool), Promise.all continua correto.
 */
export async function inSequence<const T extends readonly (() => unknown)[]>(tasks: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

/* -------------------------- Banco atualizado? ------------------------------ */

/**
 * Migrações que existem no código mas ainda NÃO foram aplicadas no banco.
 *
 * Por quê: ao atualizar o projeto e esquecer o "pnpm db:migrate", o código
 * passa a usar colunas que o banco ainda não tem e a tela quebra com
 * "column ... does not exist". Os apps chamam esta função e, se houver
 * pendências, mostram uma página explicando o que fazer.
 *
 * Depois que o banco está em dia, o resultado fica guardado na memória do
 * processo (nenhuma consulta extra a cada página).
 */
let schemaUpToDate = false;

export async function pendingMigrations(): Promise<string[]> {
  if (schemaUpToDate) return [];
  let applied = 0;
  try {
    const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    applied = result.rows[0]?.n ?? 0;
  } catch {
    applied = 0; // tabela de controle ainda não existe: nenhuma migração aplicada
  }
  const pending = migrationJournal.entries.slice(applied).map((e) => e.tag);
  if (pending.length === 0) schemaUpToDate = true;
  return pending;
}

/* ------------------------------- Auditoria -------------------------------- */

export interface AuditEntry {
  actor: { id: string; email: string } | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Registra uma ação na trilha de auditoria.
 * Passe a MESMA transação da alteração: se a alteração falhar, o registro
 * também não é gravado, e vice-versa (nunca fica um sem o outro).
 */
export async function writeAudit(tx: Tx | Database, entry: AuditEntry): Promise<void> {
  await tx.insert(schema.auditLog).values({
    actorId: entry.actor?.id ?? null,
    actorEmail: entry.actor?.email ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
    ip: entry.ip ?? null,
  });
}

/* ------------------------- Funcionalidades efetivas ------------------------ */

export interface ClinicEntitlements {
  /** Módulos liberados (contratação em teste ou ativa). */
  modules: ModuleId[];
  /** Chaves das funcionalidades liberadas, ex.: "crm.waitlist". */
  features: string[];
}

/**
 * Calcula o que uma clínica pode usar AGORA:
 *   funcionalidades do plano + exceções liberadas - exceções bloqueadas,
 *   somente para contratações em teste (dentro do prazo) ou ativas.
 *
 * É esta função que os sistemas (CRM, ERP...) vão consultar no futuro
 * para decidir o que mostrar para a clínica.
 */
export async function getClinicEntitlements(clinicId: string, now = new Date()): Promise<ClinicEntitlements> {
  const subs = await db.query.subscriptions.findMany({
    where: (s, { eq, and, inArray }) => and(eq(s.clinicId, clinicId), inArray(s.status, [...SUBSCRIPTION_ENABLED_STATUSES])),
    with: {
      plan: { with: { submodules: { with: { submodule: true } } } },
      overrides: { with: { submodule: true } },
    },
  });

  const modules = new Set<ModuleId>();
  const features = new Set<string>();

  for (const sub of subs) {
    // Teste vencido não libera nada, mesmo que o status ainda não tenha sido atualizado
    if (sub.status === "teste" && sub.trialEndsAt && sub.trialEndsAt < now) continue;
    modules.add(sub.moduleId);
    for (const ps of sub.plan.submodules) features.add(ps.submodule.key);
    for (const o of sub.overrides) {
      if (o.enabled) features.add(o.submodule.key);
      else features.delete(o.submodule.key);
    }
  }

  return { modules: [...modules], features: [...features].sort() };
}
