import { formatWhen } from "@ecosaude/core/crm";
import { asc, desc, eq, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { QuickReplyButton } from "../forms";
import { automationSettings } from "@/modules/crm/automation-settings";
import { MINING_EVENT } from "@/modules/crm/ai/quick-replies";
import { RepliesList } from "./RepliesList";
import { ReplySuggestions } from "./ReplySuggestions";

export const metadata: Metadata = { title: "Respostas rápidas" };
export const dynamic = "force-dynamic";

/** Respostas rápidas: textos prontos acionados com "/" na conversa. */
export default async function QuickRepliesPage() {
  const ctx = await requireCrm("config.respostas");
  const { replies, suggestions, lastRun } = await withTenant(ctx.user.clinicId, async (tx) => {
    const replies = await tx.select().from(schema.quickReplies).orderBy(asc(schema.quickReplies.shortcut));
    // Sugestões da repetição (Ajustes > IA > Respostas rápidas sugeridas)
    if (!(await automationSettings(tx)).ia_respostas_sugeridas?.enabled) return { replies, suggestions: null, lastRun: null };
    const suggestions = await tx.select().from(schema.quickReplySuggestions).where(eq(schema.quickReplySuggestions.status, "pendente")).orderBy(desc(schema.quickReplySuggestions.count)).limit(12);
    const [last] = await tx.select({ at: schema.crmEvents.createdAt }).from(schema.crmEvents).where(eq(schema.crmEvents.type, MINING_EVENT)).orderBy(desc(schema.crmEvents.createdAt)).limit(1);
    return { replies, suggestions, lastRun: last ? formatWhen(last.at) : null };
  });

  return (
    <>
      <PageHeader
        title="Respostas rápidas"
        description="Na conversa, digite / para escolher. As marcadas como modelo aprovado podem ser enviadas mesmo após 24h sem resposta do paciente."
        actions={<QuickReplyButton />}
      />
      {suggestions ? (
        <ReplySuggestions
          lastRun={lastRun}
          items={suggestions.map((s) => ({ id: s.id, shortcut: s.shortcut, title: s.title, body: s.body, count: s.count, conversations: s.conversations, source: s.source as "ia" | "regras" }))}
        />
      ) : null}
      {replies.length === 0 ? (
        <EmptyState title="Nenhuma resposta rápida">Crie as respostas que a recepção mais repete: endereço, valores, preparo de exame...</EmptyState>
      ) : (
        <RepliesList replies={replies.map((r) => ({ id: r.id, shortcut: r.shortcut, title: r.title, body: r.body, approvedTemplate: r.approvedTemplate }))} />
      )}
    </>
  );
}
