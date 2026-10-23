import { Pool } from "pg";
import { assertTestDatabase, E2E } from "./env";

/**
 * Acesso direto ao banco de TESTES: preparar cenários, conferir o que a tela gravou e testar
 * as travas do banco (RLS, restrições). Conecta como dono das tabelas (sem RLS); para testar
 * como o app, use asTenant().
 */
assertTestDatabase(E2E.databaseUrl);
const pool = new Pool({ connectionString: E2E.databaseUrl, max: 2 });

/** Linhas de uma consulta */
export async function rows<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}

/** Primeira coluna da primeira linha (ou null) */
export async function value<T = string>(text: string, params: unknown[] = []): Promise<T | null> {
  const r = await pool.query(text, params);
  const first = r.rows[0];
  return first ? (Object.values(first)[0] as T) : null;
}

export async function exec(text: string, params: unknown[] = []): Promise<void> {
  await pool.query(text, params);
}

/**
 * Executa como o APP DA CLÍNICA (papel ecosaude_tenant + clínica da sessão), dentro de uma
 * transação desfeita no fim. Devolve o erro do banco, se houver (para testar as travas).
 */
export async function asTenant(clinicId: string, text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; error: { code?: string; constraint?: string; message: string } | null }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role ecosaude_tenant");
    await client.query("select set_config('app.clinic_id', $1, true)", [clinicId]);
    const r = await client.query(text, params);
    return { rows: r.rows, error: null };
  } catch (e) {
    const err = e as { code?: string; constraint?: string; message: string };
    return { rows: [], error: { code: err.code, constraint: err.constraint, message: err.message } };
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Espera uma condição no banco (o que a tela gravou chega logo depois do clique) */
export async function waitForValue<T>(read: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last = await read();
  while (!ok(last) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    last = await read();
  }
  return last;
}

/** Dados fixos da demonstração (seed --demo) */
export const demo = {
  clinicId: () => value<string>("select id from clinics where trade_name = 'Clínica Exemplo'"),
  contactId: (name: string) => value<string>("select id from contacts where name = $1", [name]),
  professionalId: (name: string) => value<string>("select id from professionals where name = $1", [name]),
  unitId: (name: string) => value<string>("select id from clinic_units where name = $1", [name]),
};

export async function closeDb() {
  await pool.end();
}
