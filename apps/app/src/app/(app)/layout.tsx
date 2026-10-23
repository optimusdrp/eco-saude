import { SchemaGuard } from "@/components/SchemaGuard";
import { automationConfig, CHANNEL_LABEL, CRM_FEATURES, type ClinicPermission } from "@ecosaude/core/crm";
import { MODULE_LABEL, MODULE_IDS } from "@ecosaude/core";
import { and, asc, count, eq, isNotNull, isNull, lt, or, pendingMigrations, schema, withTenant } from "@ecosaude/db";
import { AppShell, type ModuleItem, type NavItem } from "@/components/shell/AppShell";
import { getEntitlements, requireUser } from "@/lib/auth/dal";

/**
 * Layout de todas as telas internas: exige login completo, monta o menu
 * conforme perfil + módulos/funcionalidades contratados e carrega os dados
 * que a casca precisa (profissionais para agendar, conversas aguardando).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Banco sem as últimas migrações? Mostra o passo a passo em vez de quebrar
  if ((await pendingMigrations()).length) return <SchemaGuard>{children}</SchemaGuard>;

  const user = await requireUser();
  const ent = await getEntitlements(user.clinicId);
  const crm = ent.modules.includes("crm");
  const can = (p: ClinicPermission) => user.permissions.includes(p);

  const { waiting, professionals, simulator, audit, dropped } = crm
    ? await withTenant(user.clinicId, async (tx) => {
        const [w] = await tx
          .select({ n: count() })
          .from(schema.conversations)
          .where(
            and(
              isNotNull(schema.conversations.awaitingReplySince),
              eq(schema.conversations.status, "aberta"),
              or(isNull(schema.conversations.snoozedUntil), lt(schema.conversations.snoozedUntil, new Date())),
            ),
          );
        const pros = await tx
          .select({ id: schema.professionals.id, name: schema.professionals.name, specialty: schema.professionals.specialty, slotMinutes: schema.professionals.slotMinutes })
          .from(schema.professionals)
          .where(eq(schema.professionals.active, true))
          .orderBy(asc(schema.professionals.name));
        const [sim] = await tx.select({ n: count() }).from(schema.channelConnections).where(eq(schema.channelConnections.mode, "simulacao"));
        // Canal real que CAIU (ex.: o celular saiu do WhatsApp Web): aviso em todas as telas
        const down = await tx
          .select({ channel: schema.channelConnections.channel })
          .from(schema.channelConnections)
          .where(and(eq(schema.channelConnections.mode, "real"), eq(schema.channelConnections.active, true), or(eq(schema.channelConnections.connectionState, "desconectado"), eq(schema.channelConnections.connectionState, "erro"))));
        // Auditoria de atendimento (Ajustes > IA): aparece no menu só se ligada
        const [st] = await tx.select({ automations: schema.crmSettings.automations }).from(schema.crmSettings).limit(1);
        const a = automationConfig(st?.automations).ia_auditoria;
        return { waiting: w?.n ?? 0, professionals: pros, simulator: (sim?.n ?? 0) > 0, audit: { on: a?.enabled === true, own: a?.mostrarParaAtendente !== false }, dropped: down.map((d) => CHANNEL_LABEL[d.channel]) };
      })
    : { waiting: 0, professionals: [], simulator: false, audit: { on: false, own: false }, dropped: [] as string[] };

  const nav: NavItem[] = [];
  if (crm) {
    nav.push({ href: "/hoje", label: "Hoje", icon: "hoje", primary: true });
    if (can("conversas.ver")) nav.push({ href: "/crm/conversas", label: "Conversas", icon: "conversas", badge: ent.features.includes(CRM_FEATURES.inbox) ? waiting : 0, primary: true });
    if (can("agenda.ver")) nav.push({ href: "/crm/agenda", label: "Agenda", icon: "agenda", primary: true });
    if (can("jornada.ver")) nav.push({ href: "/crm/jornada", label: "Jornada", icon: "jornada", primary: true });
    if (can("agenda.ver")) nav.push({ href: "/crm/espera", label: "Espera", icon: "espera" });
    if (can("retornos.gerir")) nav.push({ href: "/crm/retornos", label: "Retornos", icon: "retornos" });
    if (can("tarefas.ver")) nav.push({ href: "/crm/tarefas", label: "Tarefas", icon: "tarefas" });
    if (audit.on && (can("qualidade.ver") || (audit.own && can("conversas.responder")))) nav.push({ href: "/crm/qualidade", label: "Qualidade", icon: "qualidade" });
  }
  // PACIENTES: todos os pacientes efetivos (substitui Contatos e Prontuário). Leads ficam em Conversas.
  // Os formulários e as regras do prontuário ficam em Ajustes > Prontuário (só a gestão).
  const pep = ent.modules.includes("pep");
  const pepRead = pep && (can("prontuario.ver") || can("prontuario.resumo") || can("prontuario.documentos") || can("prontuario.triagem"));
  const patients: NavItem | null = (crm && can("pacientes.ver")) || pepRead ? { href: "/pacientes", label: "Pacientes", icon: "pacientes", primary: user.healthProfessional || !crm } : null;
  if (patients) nav.splice(Math.min(crm ? 3 : 0, nav.length), 0, patients);
  // Consultório (o dia do profissional): para o profissional de saúde, o primeiro item (e a tela inicial)
  if (pep && can("prontuario.consultorio")) {
    const consultorio: NavItem = { href: "/consultorio", label: "Consultório", icon: "consultorio", primary: true };
    if (user.healthProfessional || !crm) {
      // Profissional: Consultório e Pacientes no começo
      if (patients) nav.splice(nav.indexOf(patients), 1);
      nav.unshift(...[consultorio, patients].filter((x): x is NavItem => !!x));
    } else nav.splice(Math.min(3, nav.length), 0, consultorio);
  }
  nav.push({ href: "/configuracoes", label: "Ajustes", icon: "config" });

  const modules: ModuleItem[] = MODULE_IDS.map((id) => ({ id, label: MODULE_LABEL[id], enabled: ent.modules.includes(id) }));

  return (
    <AppShell user={{ name: user.name, roleLabel: user.roleName }} clinicName={user.clinicName} nav={nav} modules={modules} professionals={professionals} simulator={simulator && can("conversas.ver")}
      channelAlert={dropped.length ? { channels: dropped, canFix: can("config.canais") } : null}
    >
      {children}
    </AppShell>
  );
}
