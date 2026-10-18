import { and, desc, eq, inArray, schema, withTenant } from "@ecosaude/db";
import { NextResponse } from "next/server";
import { apiContext, isResponse } from "@/lib/api";

/**
 * GET /api/simulador
 * Dados do SIMULADOR DE CANAIS: canais em simulação, pacientes já conhecidos
 * (para responder como eles) e as últimas mensagens que a clínica enviou
 * (o que o paciente "recebeu" no celular).
 */
export async function GET() {
  const ctx = await apiContext("conversas.ver");
  if (isResponse(ctx)) return ctx;

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const channels = await tx.select().from(schema.channelConnections).where(eq(schema.channelConnections.mode, "simulacao"));
    const identities = await tx
      .select({ channel: schema.contactIdentities.channel, externalId: schema.contactIdentities.externalId, name: schema.contacts.name, contactId: schema.contacts.id })
      .from(schema.contactIdentities)
      .innerJoin(schema.contacts, eq(schema.contactIdentities.contactId, schema.contacts.id))
      .orderBy(desc(schema.contacts.lastInteractionAt))
      .limit(40);
    const outbound = await tx
      .select({
        id: schema.messages.id,
        channel: schema.messages.channel,
        body: schema.messages.body,
        status: schema.messages.status,
        meta: schema.messages.meta,
        createdAt: schema.messages.createdAt,
        contactId: schema.conversations.contactId,
        contactName: schema.contacts.name,
      })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
      .innerJoin(schema.contacts, eq(schema.conversations.contactId, schema.contacts.id))
      .where(and(eq(schema.messages.direction, "out"), inArray(schema.messages.channel, channels.map((c) => c.channel).length ? channels.map((c) => c.channel) : ["whatsapp"])))
      .orderBy(desc(schema.messages.createdAt))
      .limit(15);
    const idOf = new Map(identities.map((i) => [`${i.contactId}:${i.channel}`, i.externalId]));
    return {
      channels: channels.map((c) => ({ channel: c.channel, displayName: c.displayName })),
      identities,
      outbound: outbound.map((m) => ({
        id: m.id,
        channel: m.channel,
        body: m.body,
        status: m.status,
        kind: (m.meta as { kind?: string } | null)?.kind ?? null,
        at: m.createdAt.toISOString(),
        contactName: m.contactName,
        externalId: idOf.get(`${m.contactId}:${m.channel}`) ?? null,
      })),
    };
  });
  return NextResponse.json(data);
}
