import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, pendingStep } from "@/lib/auth/dal";
import { markNoticesRead, noticesFor } from "@/modules/notices";

/**
 * AVISOS DA PESSOA LOGADA (sino da barra superior)
 *   GET  /api/avisos            -> { unread, items } (os 20 mais recentes)
 *   POST /api/avisos { ids? }   -> marca como lidos (sem ids: todos)
 *
 * Cada pessoa só lê e marca os PRÓPRIOS avisos (filtro por user_id, além do isolamento
 * entre clínicas no banco). Sem cache: o sino consulta a cada 20 s.
 */
export const dynamic = "force-dynamic";

async function currentUser() {
  const user = await getCurrentUser();
  // Login pela metade (2 etapas ou troca de senha pendente) não vê avisos
  return user && !pendingStep(user) ? user : null;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sem acesso." }, { status: 401 });
  const data = await noticesFor(user.clinicId, user.id);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

const bodySchema = z.object({ ids: z.array(z.uuid()).max(100).optional() });

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sem acesso." }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  await markNoticesRead(user.clinicId, user.id, parsed.data.ids);
  return NextResponse.json({ ok: true });
}
