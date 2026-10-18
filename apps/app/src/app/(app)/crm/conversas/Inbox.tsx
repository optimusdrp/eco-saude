import { messagingWindow } from "@ecosaude/channels";
import {
  CRM_FEATURES,
  firstName,
  formatDayShort,
  formatTime,
  formatWhen,
  INTENT_LABEL,
  relativeDay,
  sentimentLabel,
  zonedToUtc,
  suggestReplies,
  URGENCY_GUIDANCE,
  type Channel,
  type Intent,
} from "@ecosaude/core/crm";
import { asc, eq, inSequence, schema, withTenant } from "@ecosaude/db";
import { notFound } from "next/navigation";
import { InboxLayout } from "@/components/crm/inbox/InboxLayout";
import type { InboxCounts, InboxItem, ThreadData } from "@/components/crm/inbox/types";
import { LockedFeature } from "@/components/ui/server";
import type { CrmContext } from "@/lib/auth/dal";
import { now as clockNow } from "@/lib/clock";
import { suggestionsFor } from "@/modules/crm/ai/insights";
import { attachmentsByMessage } from "@/modules/crm/files/attachments";
import { promisesForThread } from "@/modules/crm/ai/promises";
import { bestTimesFor } from "@/modules/crm/ml/best-time";
import { latestSummary } from "@/modules/crm/ai/summary";
import { describeEvent } from "@/modules/crm/format";
import { INBOX_PAGE, inboxCounts, listConversations, loadThread, quickReplies, threadContext, type InboxFilter, type InboxSort } from "@/modules/crm/inbox";

/**
 * MESA DE MENSAGENS (omnichannel), parte do SERVIDOR
 *
 * Busca a lista, os números, a conversa aberta e o contexto do paciente numa
 * única transação isolada pela clínica, converte datas em números e entrega
 * ao quadro interativo (InboxLayout), que cuida de: seleção e ações em lote,
 * atalhos de teclado, busca dentro da conversa, rascunhos, painel lateral com
 * abas e as preferências de cada pessoa.
 *
 * O ASSISTENTE usa regras locais (intenção por palavras-chave, respostas
 * sugeridas com horários livres reais, alerta de urgência, janela de 24h) e,
 * se a clínica ligar em Ajustes > Inteligência artificial, a IA (rascunho,
 * intenção e resumo), sempre com plano B pelas regras.
 */
export async function Inbox({
  ctx,
  selectedId,
  filter,
  channel,
  q,
  limit,
  sort,
}: {
  ctx: CrmContext;
  selectedId?: string;
  filter: InboxFilter;
  channel?: Channel;
  q?: string;
  limit: number;
  sort: InboxSort;
}) {
  if (!ctx.has(CRM_FEATURES.inbox)) {
    return <LockedFeature title="Caixa de entrada omnichannel">Todas as conversas de WhatsApp, Telegram, Instagram e Messenger num só lugar, com fila por tempo de espera.</LockedFeature>;
  }

  const current = clockNow();
  const nowMs = current.getTime();
  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const [page, counts, thread, replies, team] = await inSequence([
      () => listConversations(tx, { filter, channel, userId: ctx.user.id, q, limit, sort }),
      () => inboxCounts(tx, ctx.user.id),
      () => (selectedId ? loadThread(tx, selectedId) : Promise.resolve(null)),
      () => quickReplies(tx),
      // Quem pode receber conversas transferidas
      () => tx.select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name }).from(schema.clinicUsers).where(eq(schema.clinicUsers.active, true)).orderBy(asc(schema.clinicUsers.name)),
    ]);
    const context = thread ? await threadContext(tx, thread.conversation.contactId) : null;
    // Último resumo (de quem resumiu antes): quem assume já abre a conversa com ele
    const summary = thread ? await latestSummary(tx, thread.conversation.id, current) : null;
    // O que ficou prometido a este paciente (tarefas automáticas em aberto)
    const promises = thread ? await promisesForThread(tx, thread.conversation.id, thread.conversation.contactId) : null;
    // Sugestões para a ficha/etiquetas e melhor horário (Ajustes > IA)
    const suggestions = thread ? await suggestionsFor(tx, thread.conversation.contactId) : null;
    const best = thread ? (await bestTimesFor(tx, [thread.conversation.contactId])).get(thread.conversation.contactId) : undefined;
    // Anexos das mensagens da conversa aberta (só a ficha; o arquivo vem pela rota autenticada)
    const files = thread
      ? await attachmentsByMessage(
          tx,
          thread.messages.map((m) => m.id),
        )
      : new Map();
    return { page, counts, thread, replies, team, context, summary, promises, suggestions, best, files };
  });
  if (selectedId && !data.thread) notFound();

  /* ------------------------------ Lista ------------------------------ */
  const items: InboxItem[] = data.page.items.map((c) => ({
    id: c.id,
    contactId: c.contact.id,
    contactName: c.contact.name,
    channel: c.channel,
    status: c.status,
    preview: c.lastMessagePreview,
    lastMessageMs: c.lastMessageAt?.getTime() ?? null,
    waitingSinceMs: c.status === "aberta" && c.awaitingReplySince ? c.awaitingReplySince.getTime() : null,
    snoozedUntilMs: c.snoozedUntil && c.snoozedUntil.getTime() > nowMs ? c.snoozedUntil.getTime() : null,
    unread: c.unreadCount,
    urgent: c.urgent,
    intentLabel: c.intent ? (INTENT_LABEL[c.intent as Intent] ?? c.intent) : null,
    intentByAi: c.intentSource === "ia",
    sentimentLabel: c.sentimentLevel >= 2 ? sentimentLabel(c.sentiment) : null,
    sentimentLevel: c.sentimentLevel,
    sentimentByAi: c.sentimentSource === "ia",
    sentimentHot: c.sentimentPriority > 0,
    assigneeId: c.assignee?.id ?? null,
    assigneeName: c.assignee?.name.split(" ")[0] ?? null,
  }));
  const counts: InboxCounts = { ...data.counts, maisAntigaMs: data.counts.maisAntiga?.getTime() ?? null };

  /* ----------------------------- Conversa ----------------------------- */
  let thread: ThreadData | null = null;
  if (data.thread && data.context) {
    const { conversation: conv, messages } = data.thread;
    const contact = conv.contact;
    const win = messagingWindow(conv.channel, conv.lastInboundAt, current);
    const intent = conv.intent as Intent | null;
    thread = {
      id: conv.id,
      channel: conv.channel,
      status: conv.status,
      urgent: conv.urgent,
      urgentGuidance: conv.urgent ? URGENCY_GUIDANCE[(conv.urgentKind as "clinica" | "emocional") ?? "clinica"] : null,
      unread: conv.unreadCount,
      assigneeId: conv.assignee?.id ?? null,
      intent,
      intentLabel: intent ? INTENT_LABEL[intent] : null,
      intentSource: conv.intentSource,
      intentConfidence: conv.intentConfidence,
      intentReason: conv.intentReason,
      intentPending: !!conv.intentPendingMessageId,
      summary: data.summary,
      promises: (data.promises?.items ?? []).map((p) => ({ ...p, dueLabel: relativeDay(zonedToUtc(p.dueDate, "12:00"), current) })),
      promisePending: data.promises?.pending ?? false,
      sentiment: conv.sentiment,
      sentimentLabel: sentimentLabel(conv.sentiment),
      sentimentLevel: conv.sentimentLevel,
      sentimentSource: conv.sentimentSource,
      sentimentConfidence: conv.sentimentConfidence,
      sentimentReason: conv.sentimentReason,
      sentimentPending: !!conv.sentimentPendingMessageId,
      sentimentHot: conv.sentimentPriority > 0,
      contact: {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        stage: contact.stage,
        tags: contact.tags,
        source: contact.source,
        optedOut: !!contact.optedOutAt,
        consentMarketing: contact.consentMarketing,
        lastVisit: contact.lastVisitAt ? formatDayShort(contact.lastVisitAt) : null,
        since: formatDayShort(contact.createdAt),
        insurance: contact.insurance,
        referredBy: contact.referredBy,
      },
      profileSuggestions: data.suggestions?.items ?? [],
      profileSuggestionsPending: data.suggestions?.pending ?? false,
      bestTime: data.best ? (data.best.source === "padrao" ? null : `${data.best.label}${data.best.source === "clinica" ? " (padrão da clínica; ainda escreveu pouco)" : ""}`) : null,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        status: m.status,
        createdMs: m.createdAt.getTime(),
        dayLabel: formatDayShort(m.createdAt),
        time: formatTime(m.createdAt),
        authorName: m.author?.name.split(" ")[0] ?? null,
        auto: m.direction === "out" && !m.authorId,
        handledBy: ((m.meta as { handledBy?: string } | null)?.handledBy ?? null)?.replace(/_/g, " ") ?? null,
        error: m.error,
        attachments: data.files.get(m.id) ?? [],
      })),
      otherChannels: data.thread.otherChannels,
      next: data.thread.next ? { label: formatWhen(data.thread.next.startsAt, current), professional: data.thread.next.professional.name, status: data.thread.next.status } : null,
      slots: data.thread.slots,
      suggestionPro: data.thread.suggestionPro?.name ?? null,
      suggestions: suggestReplies(intent, { firstName: firstName(contact.name), slots: data.thread.slots, clinicName: ctx.user.clinicName }),
      window: {
        open: win.open,
        closesAtMs: win.closesAt?.getTime() ?? null,
        closesLabel: win.closesAt ? `${formatDayShort(win.closesAt)} às ${formatTime(win.closesAt)}` : null,
        unlimited: win.open && !win.closesAt,
      },
      stats: data.context.stats,
      events: data.context.events.map((e) => ({ id: e.id, text: describeEvent(e.type, e.data, current), when: formatWhen(e.createdAt, current) })),
    };
  }

  return (
    <InboxLayout
      items={items}
      hasMore={data.page.hasMore}
      counts={counts}
      thread={thread}
      selectedId={selectedId ?? null}
      filter={filter}
      channel={channel ?? null}
      q={q ?? ""}
      sort={sort}
      pages={Math.round(limit / INBOX_PAGE)}
      serverNowMs={nowMs}
      timeZone={ctx.user.clinicTimeZone}
      userId={ctx.user.id}
      team={data.team}
      canReply={ctx.can("conversas.responder")}
      canBulk={ctx.can("conversas.massa")}
      canSchedule={ctx.can("agenda.editar")}
      quickReplies={data.replies.map((r) => ({ id: r.id, shortcut: r.shortcut, title: r.title, body: r.body, approvedTemplate: r.approvedTemplate }))}
      vars={thread ? { nome: thread.contact.name, primeiro_nome: firstName(thread.contact.name), clinica: ctx.user.clinicName } : null}
    />
  );
}
