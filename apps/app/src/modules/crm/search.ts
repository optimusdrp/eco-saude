import "server-only";
import { eq, sql, type SQL } from "@ecosaude/db";

type Column = Parameters<typeof eq>[0];

/**
 * Busca de texto que IGNORA ACENTOS e maiúsculas: "ana lucia" encontra "Ana Lúcia".
 * Importante para evitar cadastro duplicado: quem busca sem acento e não acha
 * acaba cadastrando a pessoa de novo.
 * (translate() é nativo do PostgreSQL: não depende da extensão unaccent.)
 */
const FROM = "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ";
const TO = "aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc";

export function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** coluna contém o termo (sem acento, sem diferenciar maiúsculas) */
export function containsText(column: Column, term: string): SQL {
  const escaped = plain(term).replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`translate(lower(coalesce(${column}, '')), ${FROM}, ${TO}) like ${`%${escaped}%`}`;
}
