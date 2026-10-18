import { automationConfig } from "@ecosaude/core/crm";
import { inSequence, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { durationRows } from "@/modules/crm/ml/durations";
import { DurationsTable } from "./DurationsTable";

export const metadata: Metadata = { title: "Duração das consultas" };
export const dynamic = "force-dynamic";

/**
 * DURAÇÃO DAS CONSULTAS (exige "config.clinica")
 * Duração real medida (chegada -> saída) por profissional e procedimento, a duração
 * marcada hoje e a sugestão. "Aplicar" vale para os PRÓXIMOS agendamentos.
 */
export default async function DurationsPage() {
  const ctx = await requireCrm("config.clinica");
  const [data, settings] = await withTenant(ctx.user.clinicId, (tx) =>
    inSequence([() => durationRows(tx), () => tx.select({ automations: schema.crmSettings.automations }).from(schema.crmSettings).limit(1)] as const),
  );
  const enabled = automationConfig(settings[0]?.automations).ia_duracao?.enabled === true;
  const pct = data.percentile === 50 ? "metade" : data.percentile === 90 ? "9 de cada 10" : "3 de cada 4";

  return (
    <>
      <PageHeader
        title="Duração das consultas"
        description={`Quanto cada consulta dura de verdade, da chegada (“Chegou”) à saída (“Finalizar atendimento”). A sugestão é o tempo em que cabem ${pct} das consultas, arredondado de 5 em 5 minutos.`}
      />
      {!enabled ? (
        <p className="mb-4 rounded-2xl bg-erp-tint px-4 py-3 text-sm text-erp-ink">
          A sugestão ao agendar está desligada. Ligue em{" "}
          <Link href="/configuracoes/ia" className="font-semibold underline">
            Ajustes &gt; Inteligência artificial &gt; Duração real das consultas
          </Link>
          . As medições continuam sendo feitas.
        </p>
      ) : null}
      <DurationsTable rows={data.rows} measured={data.measured} />
    </>
  );
}
