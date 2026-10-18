import { CHANNEL_LABEL, clinicTimeZone, JOURNEY_STAGE_LABEL, todayIso } from "@ecosaude/core/crm";
import { eq, inArray, schema, withTenant } from "@ecosaude/db";
import { NextResponse } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { now } from "@/lib/clock";
import { contactColumns, contactOrder, contactWhere, parseContactFilters, type ContactSearchParams } from "@/modules/crm/contacts-list";
import { logEvent } from "@/modules/crm/journey";

/** Limite de linhas por exportação (base grande: exporte por partes, com filtros) */
const MAX = 5000;

/**
 * GET /api/contatos/exportar?<mesmos filtros da tela>  ou  ?ids=a,b,c
 *
 * Planilha CSV (abre no Excel/Google Planilhas) com os contatos filtrados.
 * LGPD: é uma cópia de dados pessoais. Por isso:
 *  - só quem tem a permissão "contatos.exportar" (Perfis e permissões);
 *  - cada exportação fica registrada (quem, quando, quantos, com quais filtros);
 *  - a planilha sai sem dados de saúde (só cadastro e relacionamento).
 */
export async function GET(req: Request) {
  const ctx = await apiContext("contatos.exportar");
  if (isResponse(ctx)) return ctx;
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams) as ContactSearchParams & { ids?: string };
  const ids = (sp.ids ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, MAX);
  const f = parseContactFilters(sp);

  const rows = await withTenant(ctx.user.clinicId, async (tx) => {
    const rows = await tx
      .select({ ...contactColumns, ownerName: schema.clinicUsers.name })
      .from(schema.contacts)
      .leftJoin(schema.clinicUsers, eq(schema.clinicUsers.id, schema.contacts.ownerId))
      .where(ids.length ? inArray(schema.contacts.id, ids) : contactWhere(f))
      .orderBy(...contactOrder(f))
      .limit(MAX);
    await logEvent(tx, { contactId: null, actorId: ctx.user.id, type: "contacts_export", data: { linhas: rows.length, filtros: ids.length ? { selecionados: ids.length } : sp } });
    return rows;
  });

  const current = now();
  const date = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: clinicTimeZone() }) : "");
  const header = [
    "Nome",
    "Celular",
    "E-mail",
    "Tipo",
    "Etapa",
    "Canal preferido",
    "Origem",
    "Etiquetas",
    "Responsável",
    "Nascimento",
    "Consultas atendidas",
    "Faltas",
    "Próxima consulta",
    "Última interação",
    "Cadastrado em",
    "Consentimento LGPD",
    "Pediu SAIR",
  ];
  const lines = rows.map((r) => [
    r.name,
    r.phone ?? "",
    r.email ?? "",
    r.visits > 0 ? "Paciente" : "Lead",
    JOURNEY_STAGE_LABEL[r.stage],
    r.channel ? CHANNEL_LABEL[r.channel] : "",
    r.source ?? "",
    r.tags.join(", "),
    r.ownerName ?? "",
    r.birthDate ? r.birthDate.split("-").reverse().join("/") : "",
    String(r.visits),
    String(r.noShows),
    date(r.nextAt),
    date(r.lastInteractionAt),
    date(r.createdAt),
    r.consentMarketing ? "Sim" : "Não",
    r.optedOutAt ? "Sim" : "Não",
  ]);

  // CSV com ";" e BOM: o Excel em português abre com acentos e colunas certas.
  // Células que começam com = + - @ ganham um apóstrofo (evita fórmula maliciosa na planilha).
  const cell = (v: string) => {
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = "﻿" + [header, ...lines].map((l) => l.map(cell).join(";")).join("\r\n");
  const stamp = todayIso(current); // data local da clínica (não UTC)
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contatos-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
