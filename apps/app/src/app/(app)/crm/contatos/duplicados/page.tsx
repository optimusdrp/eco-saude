import { DUPLICATE_VERDICT_LABEL, JOURNEY_STAGE_LABEL } from "@ecosaude/core/crm";
import { withTenant } from "@ecosaude/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DuplicateOpinion } from "@/components/crm/patients/DuplicateOpinion";
import { DismissPair } from "@/components/crm/patients/MergeTools";
import { Badge, EmptyState, PageHeader } from "@/components/ui/server";
import { buttonStyles } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { formatPhone } from "@/modules/crm/format";
import { duplicateOpinions } from "@/modules/crm/ai/insights";
import { automationSettings } from "@/modules/crm/automation-settings";
import { findDuplicatePairs } from "@/modules/crm/duplicates";

export const metadata: Metadata = { title: "Possíveis duplicados" };
export const dynamic = "force-dynamic";

/**
 * POSSÍVEIS DUPLICADOS
 * Cadastros que parecem ser a mesma pessoa (mesmo celular, e-mail, nome +
 * nascimento, ou nome muito parecido). Acontece muito quando o paciente
 * escreve por canais diferentes: cada canal novo cria um contato.
 *
 * Com "Duplicados com IA" ligado (Ajustes > IA), cada par mostra uma opinião
 * (mesma pessoa, família, pessoas diferentes) e dá para pedir a da IA nos casos
 * difíceis ("Bia" x "Beatriz Souza" com o mesmo e-mail). Unificar continua manual.
 */
export default async function DuplicatesPage() {
  const ctx = await requireCrm("contatos.mesclar");
  const { pairs, opinions, aiOn } = await withTenant(ctx.user.clinicId, async (tx) => {
    // Ordem fixa (menor id primeiro): é como a opinião fica guardada
    const pairs = (await findDuplicatePairs(tx)).map((p) => (p.a.id < p.b.id ? p : { ...p, a: p.b, b: p.a }));
    const aiOn = !!(await automationSettings(tx)).ia_duplicados?.enabled;
    return { pairs, aiOn, opinions: aiOn ? await duplicateOpinions(tx, pairs) : null };
  });
  const strong = pairs.filter((p) => p.strength === "forte").length;

  return (
    <>
      <Link href="/pacientes" className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Pacientes
      </Link>
      <PageHeader
        title="Possíveis duplicados"
        description={
          pairs.length
            ? `${pairs.length} ${pairs.length === 1 ? "par" : "pares"} para revisar${strong ? `, ${strong} com suspeita forte` : ""}. Compare e unifique, ou marque como pessoas diferentes.`
            : "Nenhum cadastro duplicado encontrado."
        }
      />
      {pairs.length === 0 ? (
        <EmptyState title="Tudo certo">Quando dois cadastros parecerem a mesma pessoa, eles aparecem aqui.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {pairs.map((p) => (
            <li key={`${p.a.id}-${p.b.id}`} className="rounded-2xl bg-paper p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={p.strength === "forte" ? "alert" : "warning"}>{p.strength === "forte" ? "suspeita forte" : "nome parecido"}</Badge>
                <span className="text-sm text-ink-soft">{p.reasons.join(", ")}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[p.a, p.b].map((c) => (
                  <div key={c.id} className="rounded-xl bg-fog px-3 py-2">
                    <Link href={`/crm/contatos/${c.id}`} className="font-semibold hover:text-crm hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-ink-soft">
                      {formatPhone(c.phone)}
                      {c.email ? `, ${c.email}` : ""}, {JOURNEY_STAGE_LABEL[c.stage].toLowerCase()}
                    </p>
                  </div>
                ))}
              </div>
              {(() => {
                const o = opinions?.get(`${p.a.id}|${p.b.id}`);
                return o ? <DuplicateOpinion a={p.a.id} b={p.b.id} verdict={o.verdict} label={DUPLICATE_VERDICT_LABEL[o.verdict]} reason={o.reason} source={o.source} canAsk={aiOn} /> : null;
              })()}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/crm/contatos/duplicados/comparar?a=${p.a.id}&b=${p.b.id}`} className={buttonStyles("primary")}>
                  Comparar e unificar
                </Link>
                <DismissPair a={p.a.id} b={p.b.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
