import { AI_FEATURES, automationConfig, CRM_FEATURES, MESSAGE_TEMPLATES, type ClinicPermission } from "@ecosaude/core/crm";
import { and, count, db, eq, inSequence, schema, withTenant } from "@ecosaude/db";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { getEntitlements, requireUser } from "@/lib/auth/dal";
import { visibleGroups, type SettingsIcon } from "./catalog";
import { SettingsIconBadge } from "./SettingsIconBadge";

export const metadata: Metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

interface Step {
  done: boolean;
  label: string;
  hint: string;
  href: string;
}

/**
 * AJUSTES: VISÃO GERAL
 *
 *  - "Clínica pronta para usar": checklist do que falta configurar (só o que o
 *    perfil pode resolver), com progresso e link direto para cada pendência;
 *  - cartões de cada área com um resumo AO VIVO (quantos profissionais,
 *    canais em simulação, respostas, equipe sem 2 etapas...).
 */
export default async function SettingsHome() {
  const user = await requireUser();
  const can = (p: ClinicPermission) => user.permissions.includes(p);
  const entitlements = await getEntitlements(user.clinicId);
  const has = (f: string) => entitlements.features.includes(f);

  // Dados da clínica ficam fora do isolamento por clínica (tabela da plataforma): consulta direta pelo id
  const clinic = await db.query.clinics.findFirst({ where: eq(schema.clinics.id, user.clinicId) });
  const d = await withTenant(user.clinicId, (tx) =>
    inSequence([
      () => tx.select({ active: schema.professionals.active }).from(schema.professionals),
      () => tx.select().from(schema.crmSettings).limit(1),
      () => tx.select({ mode: schema.channelConnections.mode, active: schema.channelConnections.active, channel: schema.channelConnections.channel }).from(schema.channelConnections),
      () => tx.select({ approved: schema.quickReplies.approvedTemplate }).from(schema.quickReplies),
      () => tx.select({ n: count() }).from(schema.returnProtocols).where(eq(schema.returnProtocols.active, true)),
      () => tx.select({ role: schema.clinicUsers.role, totp: schema.clinicUsers.totpEnabled }).from(schema.clinicUsers).where(eq(schema.clinicUsers.active, true)),
      () =>
        tx
          .select({ n: count() })
          .from(schema.clinicUsers)
          .where(and(eq(schema.clinicUsers.active, true), eq(schema.clinicUsers.mustChangePassword, true))),
      () => tx.select({ enabled: schema.automationRules.enabled }).from(schema.automationRules),
      () => tx.select({ n: count() }).from(schema.messageTemplates),
      () => tx.select({ n: count() }).from(schema.clinicRoles),
      () => tx.select({ active: schema.clinicUnits.active }).from(schema.clinicUnits),
      () => tx.select({ n: count() }).from(schema.clinicRooms).where(eq(schema.clinicRooms.active, true)),
    ]),
  );
  const [pros, settings, channels, replies, protocols, team, tempPasswords, rules, customTemplates, roles, units, rooms] = d;
  const activeUnits = units.filter((u) => u.active).length;
  const autoCfg = automationConfig(settings[0]?.automations);
  // A IA tem área própria: não entra na contagem das automações
  const aiOn = AI_FEATURES.filter((a) => autoCfg[a.key]?.enabled).length;
  const autoOn = Object.values(autoCfg).filter((a) => a.enabled).length - aiOn + ((settings[0]?.autoConfirm ?? true) ? 1 : 0);
  const rulesOn = rules.filter((r) => r.enabled).length;
  const activePros = pros.filter((p) => p.active).length;
  const autoConfirm = settings[0]?.autoConfirm ?? true;
  const realChannels = channels.filter((c) => c.mode === "real" && c.active);
  const templates = replies.filter((r) => r.approved).length;
  const gestoresSem2fa = team.filter((u) => u.role === "gestor" && !u.totp).length;
  const sem2fa = team.filter((u) => !u.totp).length;

  /* ------------------------------ Checklist ------------------------------ */
  const steps: Step[] = [];
  if (can("config.clinica")) {
    steps.push({ done: !!(clinic?.phone && clinic.city), label: "Dados da clínica completos", hint: "Telefone e cidade aparecem nas mensagens e documentos.", href: "/configuracoes/clinica" });
    steps.push({ done: activePros > 0, label: "Profissionais cadastrados", hint: "Sem profissional ativo, a agenda não tem horários.", href: "/configuracoes/clinica" });
    if (has(CRM_FEATURES.confirmations))
      steps.push({ done: autoConfirm, label: "Confirmação automática ligada", hint: "Menos faltas sem ninguém precisar lembrar.", href: "/configuracoes/automacoes" });
  }
  if (can("config.canais"))
    steps.push({ done: realChannels.length > 0, label: "Um canal conectado de verdade", hint: "Em simulação as mensagens não saem para os pacientes.", href: "/configuracoes/canais" });
  if (can("config.respostas")) {
    steps.push({ done: replies.length >= 3, label: "Respostas rápidas da recepção", hint: "Endereço, valores, preparo de exame: pelo menos 3.", href: "/configuracoes/respostas" });
    steps.push({ done: templates > 0, label: "Modelo aprovado pela Meta", hint: "Necessário para escrever a quem não respondeu nas últimas 24h.", href: "/configuracoes/respostas" });
  }
  if (can("retornos.gerir") && has(CRM_FEATURES.campaigns))
    steps.push({ done: (protocols[0]?.n ?? 0) > 0, label: "Protocolo de retorno ativo", hint: "O radar encontra quem está na hora de voltar.", href: "/configuracoes/retornos" });
  if (can("config.equipe")) {
    steps.push({ done: team.length >= 2, label: "Equipe com acesso próprio", hint: "Cada pessoa com login próprio: o histórico mostra quem fez o quê.", href: "/configuracoes/equipe" });
    steps.push({ done: gestoresSem2fa === 0, label: "Gestão com verificação em 2 etapas", hint: "Quem vê tudo precisa da proteção extra.", href: "/configuracoes/seguranca" });
  }
  steps.push({ done: user.totpEnabled, label: "Sua conta com verificação em 2 etapas", hint: "Protege mesmo que alguém descubra a sua senha.", href: "/configuracoes/conta" });
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);

  /* ------------------------- Resumo de cada área ------------------------- */
  const summary: Record<SettingsIcon, string> = {
    conta: `${user.totpEnabled ? "2 etapas ligada" : "2 etapas desligada"}. Login: ${user.email}`,
    preferencias: "Tamanho do texto e telas personalizadas",
    clinica: `${clinic?.tradeName ?? user.clinicName}. ${activePros} ${activePros === 1 ? "profissional ativo" : "profissionais ativos"}`,
    automacoes: `${autoOn} automações do sistema ligadas, ${rulesOn} ${rulesOn === 1 ? "regra própria" : "regras próprias"}`,
    canais: realChannels.length ? `${realChannels.length} em modo real, ${channels.length - realChannels.length} em simulação` : "Todos em simulação",
    respostas: `${replies.length} ${replies.length === 1 ? "resposta" : "respostas"}, ${templates} ${templates === 1 ? "modelo aprovado" : "modelos aprovados"}`,
    retornos: `${protocols[0]?.n ?? 0} ${(protocols[0]?.n ?? 0) === 1 ? "protocolo ativo" : "protocolos ativos"}`,
    equipe: `${team.length} ${team.length === 1 ? "pessoa ativa" : "pessoas ativas"}${tempPasswords[0]?.n ? `, ${tempPasswords[0].n} com senha temporária` : ""}`,
    perfis: `${Math.max(3, roles[0]?.n ?? 0)} perfis de acesso`,
    mensagens: `${MESSAGE_TEMPLATES.length} mensagens, ${customTemplates[0]?.n ?? 0} personalizadas`,
    seguranca: sem2fa ? `${sem2fa} sem verificação em 2 etapas` : "Toda a equipe com 2 etapas",
    duracoes: "Duração real por profissional e procedimento",
    unidades: `${activeUnits} ${activeUnits === 1 ? "unidade" : "unidades"}, ${rooms[0]?.n ?? 0} ${(rooms[0]?.n ?? 0) === 1 ? "consultório" : "consultórios"}`,
    ia: aiOn ? `${aiOn} de ${AI_FEATURES.length} funcionalidades ligadas` : `Desligada. ${AI_FEATURES.length} funcionalidades disponíveis`,
    prontuario: "Áreas da clínica, sigilo e acessos sensíveis",
    formularios: "Formulários por especialidade e por profissional",
    plano: `Módulos: ${entitlements.modules.map((m) => m.toUpperCase()).join(", ") || "nenhum"}. ${entitlements.features.length} funcionalidades`,
  };
  const groups = visibleGroups(can, entitlements.modules);
  const r = 26;
  const c = 2 * Math.PI * r;

  return (
    <>
      <PageHeader title="Ajustes" description={`Tudo o que dá para configurar na ${clinic?.tradeName ?? user.clinicName}, num lugar só. Você vê o que o seu perfil pode mudar.`} />

      {/* ------------------------- Clínica pronta para usar ------------------------- */}
      <section aria-labelledby="pronta-t" className="mb-6 grid gap-5 rounded-2xl bg-paper p-5 ring-1 ring-line md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center gap-4 md:flex-col md:items-start">
          <svg viewBox="0 0 64 64" className="size-24 shrink-0 -rotate-90" role="img" aria-label={`${pct}% configurado`}>
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-fog)" strokeWidth="8" />
            <circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              stroke={pct === 100 ? "var(--color-pep)" : "var(--color-crm)"}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * c} ${c}`}
            />
          </svg>
          <div>
            <h2 id="pronta-t" className="text-lg font-bold">
              {pct === 100 ? "Tudo configurado" : "Deixe a clínica pronta"}
            </h2>
            <p className="text-sm text-ink-soft tabular">
              {done} de {steps.length} itens concluídos
            </p>
          </div>
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {steps.map((s) => (
            <li key={s.label}>
              <Link href={s.href} className={cn("group flex h-full items-start gap-2.5 rounded-xl p-2.5 hover:bg-fog", s.done && "opacity-70")}>
                {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-ink/30" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold", s.done && "line-through decoration-ink/30")}>{s.label}</span>
                  {!s.done ? <span className="block text-xs text-ink-soft">{s.hint}</span> : null}
                </span>
                {!s.done ? <ArrowRight className="mt-0.5 size-4 shrink-0 text-crm opacity-0 group-hover:opacity-100" aria-hidden /> : null}
                <span className="sr-only">{s.done ? "(concluído)" : "(pendente)"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------ Áreas ------------------------------ */}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="mb-5">
          <h2 className="mb-2 text-sm font-bold text-ink-soft">{g.label}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="flex h-full items-start gap-3 rounded-2xl bg-paper p-4 ring-1 ring-line transition-shadow hover:shadow-md hover:ring-crm">
                  <SettingsIconBadge icon={i.icon} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{i.label}</span>
                    <span className="block text-sm text-ink-soft">{i.hint}</span>
                    <span className="mt-1.5 block text-xs font-semibold text-crm">{summary[i.icon]}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
