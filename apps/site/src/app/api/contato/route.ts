import { contactSchema, flattenErrors } from "@ecosaude/core/validation";
import { and, db, eq, gte, schema, sql, writeAudit } from "@ecosaude/db";
import { NextResponse } from "next/server";

/**
 * POST /api/contato
 * Recebe o pedido de demonstração do site e grava como LEAD no banco,
 * onde a equipe comercial acompanha pelo backoffice.
 *
 * Proteções:
 *  - validação com o mesmo schema do formulário (zod)
 *  - campo-armadilha contra robôs
 *  - limite de 5 envios por IP por hora
 *  - mesmo e-mail em menos de 24h não duplica o lead (só atualiza os interesses)
 */
const LIMIT_PER_HOUR = 5;

/** IP do visitante (a Vercel envia no cabeçalho x-forwarded-for). */
function clientIp(request: Request): string | null {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

/** Soma um envio para o IP e devolve quantos já foram feitos na hora atual. */
async function hitRateLimit(ip: string): Promise<number> {
  const key = `contato:${ip}`;
  const result = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - interval '1 hour' then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - interval '1 hour' then now() else rate_limits.window_start end
    returning count
  `);
  return Number(result.rows[0]?.count ?? 1);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: flattenErrors(parsed.error) }, { status: 422 });
  }
  const data = parsed.data;

  // Robô preencheu o campo invisível: responde "ok" sem gravar nada
  if (data.website) return NextResponse.json({ ok: true }, { status: 201 });

  try {
    const ip = clientIp(request);
    if (ip && (await hitRateLimit(ip)) > LIMIT_PER_HOUR) {
      return NextResponse.json({ error: "Muitos envios. Tente de novo mais tarde." }, { status: 429 });
    }

    const dayAgo = new Date(Date.now() - 86_400_000);
    await db.transaction(async (tx) => {
      // Mesmo e-mail nas últimas 24h: atualiza em vez de duplicar
      const recent = await tx.query.leads.findFirst({
        where: and(sql`lower(${schema.leads.email}) = lower(${data.email})`, gte(schema.leads.createdAt, dayAgo)),
      });

      if (recent) {
        const interests = [...new Set([...recent.interests, ...data.interests])];
        await tx.update(schema.leads).set({ interests }).where(eq(schema.leads.id, recent.id));
        await writeAudit(tx, { actor: null, action: "lead.resubmitted", entity: "lead", entityId: recent.id, data: { interests }, ip });
        return;
      }

      const [lead] = await tx
        .insert(schema.leads)
        .values({
          name: data.name,
          email: data.email,
          clinicName: data.clinic,
          size: data.size,
          interests: data.interests,
          consentAt: new Date(),
          source: "site",
        })
        .returning({ id: schema.leads.id });
      await writeAudit(tx, { actor: null, action: "lead.created", entity: "lead", entityId: lead!.id, data: { source: "site" }, ip });
    });
  } catch (error) {
    // Não registra dados pessoais no log (LGPD), só o erro técnico
    console.error("[contato] falha ao gravar lead:", (error as Error).message);
    return NextResponse.json({ error: "Não foi possível registrar agora." }, { status: 503 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
