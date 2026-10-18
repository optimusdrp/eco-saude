import { withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { findDuplicatesFor } from "@/modules/crm/duplicates";

/**
 * GET /api/contatos/duplicados?nome=&telefone=&email=&nascimento=&ignorar=<id>
 * Verificação AO DIGITAR no cadastro: quem já parece ser esta pessoa.
 */
export async function GET(req: NextRequest) {
  const ctx = await apiContext("pacientes.ver");
  if (isResponse(ctx)) return ctx;
  const sp = req.nextUrl.searchParams;
  const name = (sp.get("nome") ?? "").trim().slice(0, 120);
  const phone = (sp.get("telefone") ?? "").replace(/\D/g, "").slice(0, 13);
  const email = (sp.get("email") ?? "").trim().slice(0, 160);
  const birth = sp.get("nascimento") ?? "";
  const ignore = sp.get("ignorar") ?? "";
  if (name.length < 3 && phone.length < 8 && !email.includes("@")) return NextResponse.json({ results: [] });

  const results = await withTenant(ctx.user.clinicId, (tx) =>
    findDuplicatesFor(
      tx,
      { name, phone: phone || null, email: email || null, birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : null },
      /^[0-9a-f-]{36}$/i.test(ignore) ? ignore : undefined,
    ),
  );
  return NextResponse.json({
    results: results.map((r) => ({ id: r.id, name: r.name, phone: r.phone, stage: r.stage, strength: r.strength, reasons: r.reasons })),
  });
}
