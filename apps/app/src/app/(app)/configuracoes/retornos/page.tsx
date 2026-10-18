import { CRM_FEATURES } from "@ecosaude/core/crm";
import { asc, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import Link from "next/link";
import { ProtocolButton } from "@/components/crm/ReturnsTools";
import { Badge, EmptyState, LockedFeature, PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Protocolos de retorno" };
export const dynamic = "force-dynamic";

/**
 * PROTOCOLOS DE RETORNO: "revisão em 180 dias", "retorno de 30 dias após Consulta".
 * Quem passou por aquele tipo de consulta entra no Radar de retornos depois do prazo.
 * (Os mesmos protocolos também podem ser editados no próprio Radar.)
 */
export default async function ReturnProtocolsPage() {
  const ctx = await requireCrm("retornos.protocolos");
  if (!ctx.has(CRM_FEATURES.campaigns)) {
    return (
      <>
        <PageHeader title="Protocolos de retorno" />
        <LockedFeature title="Radar de retornos">Faz parte de um plano com o Radar de retornos. Veja em Plano e módulos.</LockedFeature>
      </>
    );
  }
  const protocols = await withTenant(ctx.user.clinicId, (tx) => tx.select().from(schema.returnProtocols).orderBy(asc(schema.returnProtocols.daysAfter)));

  return (
    <>
      <PageHeader
        title="Protocolos de retorno"
        description="Quando cada paciente deve voltar e a mensagem do lembrete. O resultado de cada protocolo aparece no Radar de retornos."
        actions={
          <>
            <Link href="/crm/retornos" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-crm ring-1 ring-line hover:ring-crm">
              Abrir o radar
            </Link>
            <ProtocolButton />
          </>
        }
      />
      {protocols.length === 0 ? (
        <EmptyState title="Nenhum protocolo">Crie o primeiro, por exemplo “Revisão semestral” (180 dias depois de qualquer consulta).</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {protocols.map((p) => (
            <li key={p.id} className="flex flex-col rounded-2xl bg-paper p-4 ring-1 ring-line">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-ink-soft">
                    {p.daysAfter} dias depois de {p.serviceMatch ? `consultas com “${p.serviceMatch}”` : "qualquer consulta"}
                  </p>
                </div>
                {p.active ? <Badge tone="success">ativo</Badge> : <Badge>pausado</Badge>}
              </div>
              {/* Prévia do lembrete como chega ao paciente */}
              <p className="mt-3 flex-1 rounded-2xl rounded-tr-sm bg-crm-tint px-3.5 py-2 text-sm whitespace-pre-line">{p.message}</p>
              <div className="mt-2">
                <ProtocolButton initial={{ id: p.id, name: p.name, serviceMatch: p.serviceMatch ?? "", daysAfter: p.daysAfter, message: p.message, active: p.active }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
