import { clinicTimeZone } from "@ecosaude/core/crm";
import { and, desc, eq, inArray, schema, withTenant } from "@ecosaude/db";
import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PepSettingsForm } from "@/components/pep/PepSettingsForm";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/server";
import { requirePep } from "@/lib/auth/dal";
import { loadPepSettings } from "@/modules/pep/access";
import { teamAccess } from "@/modules/crm/permissions";
import { emailStatus } from "@/lib/email";
import { noticeReceipts } from "@/modules/notices";

export const metadata: Metadata = { title: "Regras e acessos do prontuário" };

const ACTION_LABEL: Record<string, string> = {
  emergencia: "Acesso de emergência",
  exportar: "Cópia do prontuário",
  cancelar_documento: "Documento cancelado",
};

/**
 * Ajustes > Prontuário (gestão): áreas da clínica, regra de sigilo, cabeçalho dos documentos e o REGISTRO DE
 * ACESSOS SENSÍVEIS (emergências, cópias, cancelamentos). Mostra quem, quando e por quê,
 * nunca o conteúdo clínico.
 */
export default async function PepSettingsPage() {
  const ctx = await requirePep("prontuario.modelos");
  const { settings, events, professionals, team, receipts } = await withTenant(ctx.user.clinicId, async (tx) => {
    const team = (await teamAccess(tx)).filter((t) => t.active);
    const settings = await loadPepSettings(tx);
    const events = await tx
      .select({ id: schema.pepAudit.id, at: schema.pepAudit.at, action: schema.pepAudit.action, userName: schema.pepAudit.userName, reason: schema.pepAudit.reason, contactId: schema.pepAudit.contactId, patient: schema.contacts.name })
      .from(schema.pepAudit)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.pepAudit.contactId))
      .where(inArray(schema.pepAudit.action, ["emergencia", "exportar", "cancelar_documento"]))
      .orderBy(desc(schema.pepAudit.at))
      .limit(100);
    const professionals = await tx
      .select({ id: schema.professionals.id, name: schema.professionals.name, council: schema.professionals.council, councilNumber: schema.professionals.councilNumber, userId: schema.professionals.userId })
      .from(schema.professionals)
      .where(and(eq(schema.professionals.active, true)));
    // Quem foi avisado de cada acesso de emergência e quando leu (o sino)
    const receipts = await noticeReceipts(tx, events.filter((e) => e.action === "emergencia").map((e) => e.id));
    return { settings, events, professionals, team, receipts };
  });
  const missing = professionals.filter((p) => !p.council || !p.councilNumber || !p.userId);

  return (
    <div>
      <PageHeader title="Regras e acessos do prontuário" description="Áreas em que a clínica atende, regras do prontuário e o registro de acessos sensíveis. Quem configura é a gestão." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Regras">
          <PepSettingsForm
            initial={{ areas: settings.areas, accessMode: settings.accessMode, headerNote: settings.headerNote ?? "", defaultReturnDays: settings.defaultReturnDays ? String(settings.defaultReturnDays) : "", emergencyEmail: settings.emergencyEmail }}
            emailReady={emailStatus().configured}
          />
        </Panel>

        <div className="flex flex-col gap-5">
          {missing.length ? (
            <Panel title="Profissionais com cadastro incompleto" description="Sem o registro no conselho não se emite receita nem atestado; sem acesso ligado, o profissional não registra atendimentos.">
              <ul className="space-y-1.5">
                {missing.map((p) => (
                  <li key={p.id} className="text-sm">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-ink-soft">: {[!p.council || !p.councilNumber ? "sem conselho" : null, !p.userId ? "sem acesso ligado" : null].filter(Boolean).join(" e ")}</span>
                  </li>
                ))}
              </ul>
              {ctx.can("config.clinica") ? (
                <Link href="/configuracoes/clinica" className="mt-3 inline-block text-sm font-semibold text-pep underline underline-offset-2">
                  Completar em Ajustes &gt; Clínica
                </Link>
              ) : null}
            </Panel>
          ) : null}

          <Panel
            title="Quem vê o quê no prontuário"
            description="Acesso de cada pessoa da equipe, pelo cargo e pelos ajustes individuais. Conteúdo clínico só para profissional de saúde."
            actions={
              ctx.can("config.permissoes") ? (
                <Link href="/configuracoes/equipe" className="text-sm font-semibold text-pep underline underline-offset-2">
                  Mudar acessos
                </Link>
              ) : null
            }
          >
            <ul className="divide-y divide-line">
              {team.map((t) => {
                const has = (p: string) => (t.permissions as string[]).includes(p);
                const levels = [
                  has("prontuario.ver") ? "Atendimento completo" : null,
                  has("prontuario.resumo") ? "Resumo de segurança" : null,
                  has("prontuario.triagem") ? "Triagem" : null,
                  has("prontuario.documentos") ? "Documentos" : null,
                  has("prontuario.consultorio") ? "Consultório" : null,
                  has("prontuario.exportar") ? "Cópia" : null,
                ].filter(Boolean);
                return (
                  <li key={t.id} className="py-2.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {t.name}
                      <span className="font-normal text-ink-soft">{t.roleName}</span>
                      {t.healthProfessional ? <Badge tone="pep">Profissional de saúde</Badge> : null}
                    </p>
                    <p className="text-sm text-ink-soft">{levels.length ? levels.join(", ") : "Sem acesso ao prontuário"}</p>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Acessos sensíveis" description="Últimos 100. Aberturas comuns ficam no registro completo de cada prontuário.">
            {events.length ? (
              <ol className="divide-y divide-line">
                {events.map((e) => (
                  <li key={e.id} className="py-2.5">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {e.action === "emergencia" ? <ShieldAlert className="size-4 text-alert" aria-hidden /> : null}
                      {ACTION_LABEL[e.action] ?? e.action}
                      <span className="font-normal text-ink-soft">
                        {" "}
                        por {e.userName}, {e.at.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: clinicTimeZone() })}
                      </span>
                    </p>
                    {e.patient ? <p className="text-sm">Paciente: {e.patient}</p> : null}
                    {e.reason ? <p className="text-sm text-ink-soft">&ldquo;{e.reason}&rdquo;</p> : null}
                    {e.action === "emergencia" ? <NoticeReceipts list={receipts.get(e.id) ?? []} /> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="Nenhum acesso sensível">Acessos de emergência, cópias entregues e documentos cancelados aparecem aqui.</EmptyState>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Quem recebeu o aviso no sino e se já leu (prova de que a gestão foi avisada) */
function NoticeReceipts({ list }: { list: { name: string; readAt: Date | null }[] }) {
  const fmt = (d: Date) => d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: clinicTimeZone() });
  if (!list.length) return <p className="mt-0.5 text-xs text-ink-soft">Ninguém além de quem acessou cuida da gestão do prontuário: nenhum aviso enviado.</p>;
  return (
    <p className="mt-0.5 text-xs text-ink-soft" data-testid="notice-receipts">
      Avisados: {list.map((r) => `${r.name} (${r.readAt ? `leu ${fmt(r.readAt)}` : "não leu"})`).join("; ")}
    </p>
  );
}
