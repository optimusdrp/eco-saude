import "server-only";
import { compareContacts, emailKey, normalizeName, phoneKey, soundKey, type DuplicateCandidateInput, type DuplicateMatch, type JourneyStage } from "@ecosaude/core/crm";
import { and, eq, isNull, ne, or, schema, sql, type Tx } from "@ecosaude/db";

/**
 * DUPLICIDADE DE CADASTROS (parte que fala com o banco)
 *
 * 1. findDuplicatesFor: ao CADASTRAR/EDITAR, procura quem já parece ser a mesma pessoa.
 * 2. findDuplicatePairs: varre a clínica e lista pares suspeitos (tela "Possíveis duplicados").
 *
 * A decisão de "parece a mesma pessoa" fica nas regras puras do core
 * (compareContacts); aqui só buscamos candidatos de forma barata.
 */

export interface DuplicateHit extends DuplicateMatch {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  stage: JourneyStage;
}

const ACCENTS_FROM = "áàâãäéèêëíìîïóòôõöúùûüç";
const ACCENTS_TO = "aaaaaeeeeiiiiooooouuuuc";

/** Primeiras letras do primeiro nome (para buscar candidatos parecidos sem varrer tudo). */
function namePrefix(name: string): string | null {
  const first = normalizeName(name).split(" ")[0];
  return first && first.length >= 2 ? first.slice(0, 2) : null;
}

export async function findDuplicatesFor(tx: Tx, input: DuplicateCandidateInput, excludeId?: string): Promise<DuplicateHit[]> {
  const conds = [];
  const pk = phoneKey(input.phone);
  // Últimos 8 dígitos: pega o mesmo número com ou sem DDI/9º dígito; o core confirma depois
  if (pk) conds.push(sql`right(regexp_replace(coalesce(${schema.contacts.phone}, ''), '\\D', '', 'g'), 8) = ${pk.slice(-8)}`);
  const ek = emailKey(input.email);
  if (ek) conds.push(sql`lower(${schema.contacts.email}) = ${ek}`);
  const prefix = namePrefix(input.name);
  if (prefix) conds.push(sql`translate(lower(${schema.contacts.name}), ${ACCENTS_FROM}, ${ACCENTS_TO}) ~ ${`(^|\\s)${prefix}`}`);
  if (conds.length === 0) return [];

  const rows = await tx
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      phone: schema.contacts.phone,
      email: schema.contacts.email,
      birthDate: schema.contacts.birthDate,
      stage: schema.contacts.stage,
    })
    .from(schema.contacts)
    .where(and(or(...conds), isNull(schema.contacts.anonymizedAt), excludeId ? ne(schema.contacts.id, excludeId) : undefined))
    .limit(300);

  // Identidades de WhatsApp com o mesmo número (contato que só escreveu, sem celular no cadastro)
  if (pk) {
    const byIdentity = await tx
      .select({
        id: schema.contacts.id,
        name: schema.contacts.name,
        phone: schema.contactIdentities.externalId,
        email: schema.contacts.email,
        birthDate: schema.contacts.birthDate,
        stage: schema.contacts.stage,
      })
      .from(schema.contactIdentities)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.contactIdentities.contactId))
      .where(and(eq(schema.contactIdentities.channel, "whatsapp"), sql`right(${schema.contactIdentities.externalId}, 8) = ${pk.slice(-8)}`));
    for (const r of byIdentity) if (r.id !== excludeId && !rows.some((x) => x.id === r.id)) rows.push(r);
  }

  const hits: DuplicateHit[] = [];
  for (const r of rows) {
    const match = compareContacts(input, r);
    if (match) hits.push({ ...r, ...match });
  }
  return hits.sort((a, b) => (a.strength === b.strength ? b.nameScore - a.nameScore : a.strength === "forte" ? -1 : 1)).slice(0, 5);
}

/* ----------------------------- Pares suspeitos ------------------------------ */

export interface DuplicatePair {
  a: DuplicateHit;
  b: DuplicateHit;
  strength: "forte" | "media";
  reasons: string[];
}

/**
 * Varre a clínica em "baldes" (mesmo celular, mesmo e-mail, mesmo início de
 * nome) e só compara quem está no mesmo balde. Evita comparar todos com todos.
 */
export async function findDuplicatePairs(tx: Tx, limit = 100): Promise<DuplicatePair[]> {
  const contacts = await tx
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      phone: schema.contacts.phone,
      email: schema.contacts.email,
      birthDate: schema.contacts.birthDate,
      stage: schema.contacts.stage,
    })
    .from(schema.contacts)
    // Fichas anonimizadas (LGPD) não são comparadas: todas se chamam "Paciente anonimizado"
    .where(isNull(schema.contacts.anonymizedAt));
  const dismissed = await tx.select({ a: schema.contactDuplicateDismissals.contactA, b: schema.contactDuplicateDismissals.contactB }).from(schema.contactDuplicateDismissals);
  const skip = new Set(dismissed.map((d) => `${d.a}|${d.b}`));

  const buckets = new Map<string, typeof contacts>();
  const put = (key: string | null, c: (typeof contacts)[number]) => {
    if (!key) return;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  };
  for (const c of contacts) {
    put(phoneKey(c.phone) && `p:${phoneKey(c.phone)}`, c);
    put(emailKey(c.email) && `e:${emailKey(c.email)}`, c);
    const words = normalizeName(c.name).split(" ").filter(Boolean);
    if (words[0]) put(`n:${soundKey(words[0]).slice(0, 4)}`, c);
  }

  const pairs = new Map<string, DuplicatePair>();
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 400) continue; // balde enorme ("Maria") fica para a busca do cadastro
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [x, y] = list[i]!.id < list[j]!.id ? [list[i]!, list[j]!] : [list[j]!, list[i]!];
        const key = `${x.id}|${y.id}`;
        if (pairs.has(key) || skip.has(key)) continue;
        const m = compareContacts(x, y);
        if (!m) continue;
        pairs.set(key, { a: { ...x, ...m }, b: { ...y, ...m }, strength: m.strength, reasons: m.reasons });
      }
    }
  }
  return [...pairs.values()].sort((p, q) => (p.strength === q.strength ? 0 : p.strength === "forte" ? -1 : 1)).slice(0, limit);
}
