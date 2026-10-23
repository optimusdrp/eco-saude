import { FIELD_TYPE_LABEL } from "@ecosaude/core/pep";
import { asc, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { PepTabs } from "@/components/pep/PepTabs";
import { pepTabsFor } from "@/components/pep/tabs";
import { TemplateBuilder } from "@/components/pep/TemplateBuilder";
import { ToggleTemplateButton } from "@/components/pep/widgets";
import { Badge, PageHeader } from "@/components/ui/server";
import { requirePep } from "@/lib/auth/dal";
import { ensureBuiltInTemplates } from "@/modules/pep/records";

export const metadata: Metadata = { title: "Modelos do prontuário" };

/** Modelos de anamnese e evolução por especialidade. Os do Tropi vêm prontos e podem ser editados. */
export default async function TemplatesPage() {
  const ctx = await requirePep("prontuario.modelos");
  const templates = await withTenant(ctx.user.clinicId, async (tx) => {
    await ensureBuiltInTemplates(tx);
    return tx.select().from(schema.pepTemplates).orderBy(asc(schema.pepTemplates.specialty), asc(schema.pepTemplates.name));
  });
  const specialties = [...new Set(templates.map((t) => t.specialty))];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Modelos"
        description="O que o profissional preenche em cada atendimento. Sinais vitais, CID-10, conduta e retorno já fazem parte de todo atendimento."
        actions={<TemplateBuilder trigger="novo" specialties={specialties} initial={{ id: null, specialty: specialties[0] ?? "", name: "", fields: [{ id: "queixa", label: "Queixa principal", type: "texto", required: true }] }} />}
      />
      <PepTabs tabs={pepTabsFor(ctx.can)} />
      {specialties.map((sp) => (
        <section key={sp} className="mb-6" aria-labelledby={`sp-${sp}`}>
          <h2 id={`sp-${sp}`} className="mb-2 text-lg font-bold">
            {sp}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {templates
              .filter((t) => t.specialty === sp)
              .map((t) => {
                const fields = t.fields.filter((f) => f.type !== "titulo");
                return (
                  <li key={t.id} className={t.active ? "rounded-2xl bg-paper p-4 ring-1 ring-line" : "rounded-2xl bg-fog p-4 ring-1 ring-line"}>
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{t.name}</p>
                        <p className="text-sm text-ink-soft">
                          {fields.length} {fields.length === 1 ? "campo" : "campos"}, {fields.filter((f) => f.required).length} obrigatórios
                        </p>
                      </div>
                      {t.systemKey ? <Badge tone="pep">Tropi</Badge> : null}
                      {!t.active ? <Badge>Desativado</Badge> : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{fields.map((f) => f.label).join(", ")}</p>
                    <div className="mt-3 flex gap-1 border-t border-line pt-2">
                      <TemplateBuilder trigger="editar" specialties={specialties} initial={{ id: t.id, specialty: t.specialty, name: t.name, fields: t.fields }} />
                      <ToggleTemplateButton id={t.id} active={t.active} />
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      <p className="text-sm text-ink-soft">Tipos de campo: {Object.values(FIELD_TYPE_LABEL).join(", ").toLowerCase()}.</p>
    </div>
  );
}
