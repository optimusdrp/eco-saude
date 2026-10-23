import { AREA_LABEL, areaOf, CLINIC_AREAS, FIELD_TYPE_LABEL, matchSpecialty, pickTemplate, SPECIALTIES, TEMPLATE_KIND_LABEL, type TemplateKind } from "@ecosaude/core/pep";
import { asc, eq, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import Link from "next/link";
import { InstallSpecialtyButton, ProfessionalTemplatesForm } from "@/components/pep/TemplateSettings";
import { TemplateBuilder } from "@/components/pep/TemplateBuilder";
import { ToggleTemplateButton } from "@/components/pep/widgets";
import { Badge, PageHeader, Panel } from "@/components/ui/server";
import { requirePep } from "@/lib/auth/dal";
import { loadPepSettings } from "@/modules/pep/access";
import { ensureBuiltInTemplates } from "@/modules/pep/records";

export const metadata: Metadata = { title: "Formulários de atendimento" };

/**
 * AJUSTES > PRONTUÁRIO > FORMULÁRIOS (só a gestão: permissão "prontuario.modelos")
 *
 *  1. Qual formulário cada profissional usa: automático pela especialidade (o padrão) ou um
 *     escolhido para a primeira consulta e outro para o retorno.
 *  2. Formulários da clínica, por especialidade: editar, ativar e desativar.
 *  3. Biblioteca do Tropi: formulários prontos de outras especialidades para adicionar.
 */
export default async function TemplatesSettingsPage() {
  const ctx = await requirePep("prontuario.modelos");
  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    await ensureBuiltInTemplates(tx);
    const templates = await tx.select().from(schema.pepTemplates).orderBy(asc(schema.pepTemplates.specialty), asc(schema.pepTemplates.name));
    const professionals = await tx
      .select({ id: schema.professionals.id, name: schema.professionals.name, specialty: schema.professionals.specialty, council: schema.professionals.council, firstTemplateId: schema.professionals.firstTemplateId, returnTemplateId: schema.professionals.returnTemplateId })
      .from(schema.professionals)
      .where(eq(schema.professionals.active, true))
      .orderBy(asc(schema.professionals.name));
    const settings = await loadPepSettings(tx);
    return { templates, professionals, settings };
  });
  const { templates, professionals, settings } = data;
  const specialties = [...new Set(templates.map((t) => t.specialty))];
  const options = templates.map((t) => ({ ...t, kind: t.kind as TemplateKind | null }));
  const activeList = options.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, specialty: t.specialty }));
  const installed = new Set(templates.map((t) => t.specialtyKey).filter(Boolean));
  const label = (id: string | undefined) => {
    const t = templates.find((x) => x.id === id);
    return t ? `${t.specialty}: ${t.name}` : "nenhum";
  };

  return (
    <div>
      <PageHeader
        title="Formulários de atendimento"
        description="O que cada profissional preenche no atendimento. Sinais vitais, diagnóstico, conduta, retorno e documentos já fazem parte de todo atendimento (conforme a área de cada profissão)."
        actions={<TemplateBuilder trigger="novo" specialties={specialties} initial={{ id: null, specialty: specialties[0] ?? "", name: "", kind: "", fields: [{ id: "queixa", label: "Queixa principal", type: "texto", required: true }] }} />}
      />

      {/* ------------------------- 1. Formulário de cada profissional ------------------------- */}
      <Panel
        title="Qual formulário cada profissional usa"
        description="Automático: o Tropi abre a primeira consulta ou o retorno da especialidade do profissional. Escolha outro só quando precisar."
        className="mb-6"
      >
        {professionals.length ? (
          <ul className="divide-y divide-line">
            {professionals.map((p) => {
              const spec = matchSpecialty(p.specialty);
              const area = areaOf({ specialty: p.specialty, council: p.council, clinicAreas: settings.areas });
              const autoFirst = pickTemplate({ templates: options, professional: { ...p, firstTemplateId: null }, clinicAreas: settings.areas, isReturn: false });
              const autoReturn = pickTemplate({ templates: options, professional: { ...p, returnTemplateId: null }, clinicAreas: settings.areas, isReturn: true });
              return (
                <li key={p.id} className="py-3" data-testid={`prof-form-${p.id}`}>
                  <p className="font-semibold">{p.name}</p>
                  <p className="mb-2 text-sm text-ink-soft">
                    {p.specialty ? p.specialty : "Sem especialidade"}
                    {spec ? (spec.label !== p.specialty ? ` (formulários de ${spec.label})` : "") : `. Especialidade não reconhecida: usa o formulário geral de ${AREA_LABEL[area]}.`}
                    {!spec ? (
                      <>
                        {" "}
                        {ctx.can("config.clinica") ? (
                          <Link href="/configuracoes/clinica" className="font-semibold text-pep underline underline-offset-2">
                            Ajustar no cadastro
                          </Link>
                        ) : null}
                      </>
                    ) : null}
                  </p>
                  <ProfessionalTemplatesForm
                    professionalId={p.id}
                    first={p.firstTemplateId}
                    ret={p.returnTemplateId}
                    templates={activeList}
                    autoFirst={label(autoFirst?.id)}
                    autoReturn={label(autoReturn?.id)}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">Cadastre os profissionais em Ajustes &gt; Clínica e profissionais.</p>
        )}
      </Panel>

      {/* ------------------------------ 2. Formulários da clínica ------------------------------ */}
      <h2 className="mb-3 text-xl font-bold">Formulários da clínica</h2>
      {specialties.map((sp) => (
        <section key={sp} className="mb-6" aria-labelledby={`sp-${sp}`}>
          <h3 id={`sp-${sp}`} className="mb-2 text-lg font-bold">
            {sp}
          </h3>
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
                      {t.kind ? <Badge tone="neutral">{TEMPLATE_KIND_LABEL[t.kind as TemplateKind]}</Badge> : null}
                      {t.systemKey ? <Badge tone="pep">Tropi</Badge> : null}
                      {!t.active ? <Badge>Desativado</Badge> : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{fields.map((f) => f.label).join(", ")}</p>
                    <div className="mt-3 flex gap-1 border-t border-line pt-2">
                      <TemplateBuilder trigger="editar" specialties={specialties} initial={{ id: t.id, specialty: t.specialty, name: t.name, kind: (t.kind as TemplateKind | null) ?? "", fields: t.fields }} />
                      <ToggleTemplateButton id={t.id} active={t.active} />
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      {/* ------------------------------ 3. Biblioteca do Tropi ------------------------------ */}
      <Panel title="Biblioteca do Tropi" description="Formulários prontos por especialidade. Adicione os que a clínica vai usar; depois é só editar a cópia." className="mt-2">
        <div className="space-y-4">
          {CLINIC_AREAS.map((a) => {
            const list = SPECIALTIES.filter((s) => s.area === a);
            return (
              <section key={a} aria-labelledby={`area-${a}`}>
                <h3 id={`area-${a}`} className="mb-1.5 font-semibold">
                  {AREA_LABEL[a]}
                  {settings.areas.includes(a) ? <Badge tone="pep" className="ml-2">Área da clínica</Badge> : null}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((s) => (
                    <li key={s.key} className="flex min-h-12 items-center gap-2 rounded-xl bg-fog px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-semibold">{s.label}</span>
                        <span className="text-xs text-ink-soft">{s.templates.map((t) => t.name).join(", ")}</span>
                      </span>
                      {installed.has(s.key) ? <Badge tone="success">Na clínica</Badge> : <InstallSpecialtyButton specialty={s.key} label={s.label} />}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>
      <p className="mt-4 text-sm text-ink-soft">Tipos de campo: {Object.values(FIELD_TYPE_LABEL).join(", ").toLowerCase()}.</p>
    </div>
  );
}
