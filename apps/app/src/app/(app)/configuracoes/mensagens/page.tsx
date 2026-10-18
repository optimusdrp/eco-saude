import { automationConfig, BUILTIN_AUTOMATIONS, LEGACY_QUICK_REPLY_SHORTCUT, MESSAGE_TEMPLATES } from "@ecosaude/core/crm";
import { and, eq, inArray, inSequence, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { MessagesWorkspace, type TemplateView } from "./MessagesWorkspace";

export const metadata: Metadata = { title: "Mensagens automáticas" };
export const dynamic = "force-dynamic";

/**
 * MENSAGENS AUTOMÁTICAS (exige "config.mensagens")
 * Todos os textos que o CRM envia sozinho, num lugar só: confirmação, lembrete,
 * lista de espera, pesquisa, boas-vindas, aniversário, SAIR/VOLTAR...
 * Cada um com prévia, variáveis, "voltar ao padrão" e (quando faz sentido) desligar.
 */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const ctx = await requireCrm("config.mensagens");
  const { msg } = await searchParams;
  const legacyShortcuts = Object.values(LEGACY_QUICK_REPLY_SHORTCUT);
  const [own, legacy, settings] = await withTenant(ctx.user.clinicId, (tx) =>
    inSequence([
      () => tx.select().from(schema.messageTemplates),
      () =>
        tx
          .select({ shortcut: schema.quickReplies.shortcut, body: schema.quickReplies.body })
          .from(schema.quickReplies)
          .where(and(inArray(schema.quickReplies.shortcut, legacyShortcuts), eq(schema.quickReplies.approvedTemplate, true))),
      () => tx.select({ automations: schema.crmSettings.automations }).from(schema.crmSettings).limit(1),
    ] as const),
  );
  const cfg = automationConfig(settings[0]?.automations);

  const views: TemplateView[] = MESSAGE_TEMPLATES.map((t) => {
    const row = own.find((r) => r.key === t.key);
    const shortcut = LEGACY_QUICK_REPLY_SHORTCUT[t.key as keyof typeof LEGACY_QUICK_REPLY_SHORTCUT];
    const fromQuickReply = !row && shortcut ? legacy.find((l) => l.shortcut === shortcut) : undefined;
    // Automação que envia esta mensagem, e se ela está ligada
    const owner = BUILTIN_AUTOMATIONS.find((a) => a.templates.includes(t.key));
    return {
      key: t.key,
      group: t.group,
      label: t.label,
      when: t.when,
      optional: t.optional,
      outsideWindow: t.outsideWindow,
      variables: [...t.variables],
      defaultBody: t.body,
      body: row?.body ?? fromQuickReply?.body ?? t.body,
      enabled: row ? row.enabled || !t.optional : true,
      source: row ? "clinica" : fromQuickReply ? "resposta" : "padrao",
      legacyShortcut: fromQuickReply ? shortcut : undefined,
      automation: owner ? { title: owner.title, on: cfg[owner.key]?.enabled === true } : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Mensagens automáticas"
        description="Os textos que o CRM envia sozinho. Escreva do jeito da clínica: o paciente recebe exatamente o que estiver aqui, com o nome e a consulta dele no lugar das variáveis."
      />
      <MessagesWorkspace templates={views} clinicName={ctx.user.clinicName} initialKey={msg ?? null} canAutomations={ctx.can("config.automacoes")} />
    </>
  );
}
