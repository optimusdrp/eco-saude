import { withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { durationFor } from "@/modules/crm/ml/durations";

/**
 * GET /api/agenda/duracao?prof=<id>&servico=<texto>
 * Duração sugerida ao agendar (Ajustes > Inteligência artificial > Duração real):
 * a aplicada pela equipe para o procedimento, ou a medida (com amostra suficiente).
 * { minutes: null } = usa a duração padrão do profissional.
 */
export async function GET(req: NextRequest) {
  const ctx = await apiContext("agenda.ver");
  if (isResponse(ctx)) return ctx;
  const prof = req.nextUrl.searchParams.get("prof") ?? "";
  const service = (req.nextUrl.searchParams.get("servico") ?? "").slice(0, 80);
  if (!/^[0-9a-f-]{36}$/i.test(prof)) return NextResponse.json({ minutes: null });
  const hit = await withTenant(ctx.user.clinicId, (tx) => durationFor(tx, prof, service || null));
  return NextResponse.json(hit ?? { minutes: null });
}
