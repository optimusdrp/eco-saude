import { and, desc, ilike, isNull, or, schema, sql, withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { containsText } from "@/modules/crm/search";
import { apiContext, isResponse } from "@/lib/api";

/**
 * GET /api/busca?q=ana
 * Busca de pacientes para a barra de comandos e para escolher paciente ao agendar.
 * Procura por nome, telefone (só números) ou e-mail.
 */
export async function GET(req: NextRequest) {
  const ctx = await apiContext("pacientes.ver");
  if (isResponse(ctx)) return ctx;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const digits = q.replace(/\D/g, "");
  const results = await withTenant(ctx.user.clinicId, (tx) =>
    tx
      .select({ id: schema.contacts.id, name: schema.contacts.name, stage: schema.contacts.stage, phone: schema.contacts.phone })
      .from(schema.contacts)
      .where(
        and(
          isNull(schema.contacts.anonymizedAt),
          or(containsText(schema.contacts.name, q), containsText(schema.contacts.email, q), digits.length >= 4 ? ilike(schema.contacts.phone, `%${digits}%`) : sql`false`),
        ),
      )
      .orderBy(desc(schema.contacts.lastInteractionAt))
      .limit(8),
  );
  return NextResponse.json({ results });
}
