import { WAITLIST_PERIOD_LABEL } from "@ecosaude/core/crm";
import { withTenant } from "@ecosaude/db";
import { NextResponse, type NextRequest } from "next/server";
import { apiContext, isResponse } from "@/lib/api";
import { ago } from "@/modules/crm/format";
import { expireOffers, waitlistCandidates } from "@/modules/crm/scheduling";

/**
 * GET /api/agenda/candidatos?prof=<id>&inicio=<ISO>
 * Pacientes da lista de espera que combinam com um horário liberado
 * (mesmo profissional ou "qualquer", e período compatível): por ordem de chegada ou,
 * com o Encaixe inteligente ligado, pela chance de aceitar (com os motivos).
 */
export async function GET(req: NextRequest) {
  const ctx = await apiContext("agenda.ver");
  if (isResponse(ctx)) return ctx;
  const professionalId = req.nextUrl.searchParams.get("prof") ?? "";
  const startsAt = new Date(req.nextUrl.searchParams.get("inicio") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(professionalId) || Number.isNaN(startsAt.getTime())) return NextResponse.json({ candidates: [] });

  const candidates = await withTenant(ctx.user.clinicId, async (tx) => {
    await expireOffers(tx);
    return waitlistCandidates(tx, { professionalId, startsAt });
  });
  return NextResponse.json({
    candidates: candidates.map((c) => ({
      id: c.id,
      contactId: c.contactId,
      name: c.contact.name,
      period: WAITLIST_PERIOD_LABEL[c.period],
      professional: c.professional?.name ?? "Qualquer profissional",
      since: ago(c.createdAt),
      notes: c.notes,
      // Encaixe inteligente (Ajustes > Inteligência artificial): chance de aceitar e motivos
      score: c.fit?.score ?? null,
      reasons: c.fit?.reasons ?? [],
      learned: c.fit?.source === "aprendido",
    })),
  });
}
