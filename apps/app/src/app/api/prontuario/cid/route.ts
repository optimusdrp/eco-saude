import { normalizeCidCode, searchText } from "@ecosaude/core/pep";
import { asc, ilike, or, schema, sql, withTenant } from "@ecosaude/db";
import { NextResponse } from "next/server";
import { authorizePep } from "@/lib/auth/dal";

/**
 * GET /api/prontuario/cid?q=hipertens  ou  ?q=I10
 * Busca na CID-10 (DATASUS) por código ou por trecho do nome, sem acento. Até 20 resultados,
 * códigos que começam com o texto primeiro.
 */
export async function GET(req: Request) {
  const ctx = await authorizePep("prontuario.atender");
  if (!ctx) return NextResponse.json({ error: "Sem acesso." }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ items: [] });
  const code = normalizeCidCode(q);
  const looksCode = /^[A-Za-z]\d/.test(q);
  const words = searchText(q).split(/\s+/).filter(Boolean).slice(0, 4);
  const items = await withTenant(ctx.user.clinicId, (tx) =>
    tx
      .select({ code: schema.cid10.code, name: schema.cid10.name, sex: schema.cid10.sex })
      .from(schema.cid10)
      .where(
        looksCode
          ? ilike(schema.cid10.code, `${code}%`)
          : or(sql.join(words.map((w) => sql`${schema.cid10.search} like ${`%${w.replace(/[%_\\]/g, "")}%`}`), sql` and `)),
      )
      // Categoria (3 caracteres) antes das subcategorias; depois em ordem de código
      .orderBy(sql`length(${schema.cid10.code})`, asc(schema.cid10.code))
      .limit(20),
  );
  return NextResponse.json({ items });
}
