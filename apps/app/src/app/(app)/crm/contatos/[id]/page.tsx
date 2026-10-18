import {
  CHANNEL_LABEL,
  clinicTimeZone,
  CRM_FEATURES,
  formatWhen,
  PRIVACY_REQUEST_CHANNEL_LABEL,
  privacyDeadlineState,
  type PrivacyRequestChannel,
  RISK_LABEL,
  todayIso,
  utcToZoned,
  WAITLIST_PERIOD_LABEL,
} from "@ecosaude/core/crm";
import { and, asc, desc, eq, or, schema, withTenant } from "@ecosaude/db";
import { ArrowLeft, MessageCircle, ShieldCheck, ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditContactButton, NoteForm, StageSelect, Timeline } from "@/components/crm/patients/PatientTools";
import { TaskButton } from "@/components/crm/TaskTools";
import { ActionButton, ScheduleButton } from "@/components/crm/widgets";
import { DismissPair } from "@/components/crm/patients/MergeTools";
import { PrivacyPanel } from "@/components/crm/patients/PrivacyPanel";
import { StartConversation } from "@/components/crm/StartConversation";
import { AddToWaitlist } from "@/components/crm/WaitlistTools";
import { Avatar, Badge, ChannelBadge, Panel, StageBadge } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { completeTaskAction, resubscribeAction } from "@/modules/crm/actions/contacts";
import { ago, channelOptions, formatPhone } from "@/modules/crm/format";
import { findDuplicatesFor } from "@/modules/crm/duplicates";
import { loadPatient360 } from "@/modules/crm/patient";
import { anonymizeBlockers, openRequestFor } from "@/modules/crm/privacy";

export const metadata: Metadata = { title: "Ficha do contato" };
export const dynamic = "force-dynamic";

/** Idade a partir da data de nascimento (AAAA-MM-DD), no fuso da clínica. */
function age(birth: string | null, today: string): number | null {
  if (!birth) return null;
  const [by, bm, bd] = birth.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/**
 * FICHA 360 DO PACIENTE
 * Coluna principal: linha do tempo unificada (todas as conversas, consultas,
 * anotações e automações). Coluna lateral: o que fazer agora (próximas
 * consultas com risco, tarefas), como se relacionar (melhor horário,
 * tempo de resposta) e o cadastro com consentimento LGPD.
 */
export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCrm("pacientes.ver");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const current = now();
  const today = todayIso(current);

  const result = await withTenant(ctx.user.clinicId, async (tx) => {
    const data = await loadPatient360(tx, id, current, { risk: ctx.has(CRM_FEATURES.noShowRisk) });
    const pros = await tx
      .select({ id: schema.professionals.id, name: schema.professionals.name })
      .from(schema.professionals)
      .where(eq(schema.professionals.active, true))
      .orderBy(asc(schema.professionals.name));
    const team = await tx
      .select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.active, true))
      .orderBy(asc(schema.clinicUsers.name));
    if (!data) return null;
    // LGPD: pedido de exclusão em aberto, o que impede apagar agora, ou o protocolo já atendido
    const privacy = {
      open: await openRequestFor(tx, id),
      blockers: ctx.can("pacientes.anonimizar") ? await anonymizeBlockers(tx, id) : [],
      done: data.contact.anonymizedAt
        ? ((
            await tx
              .select({ protocol: schema.privacyRequests.protocol, decidedAt: schema.privacyRequests.decidedAt })
              .from(schema.privacyRequests)
              .where(and(eq(schema.privacyRequests.contactId, id), eq(schema.privacyRequests.kind, "exclusao"), eq(schema.privacyRequests.status, "concluida")))
              .orderBy(desc(schema.privacyRequests.decidedAt))
              .limit(1)
          )[0] ?? null)
        : null,
    };
    if (data.contact.anonymizedAt) return { ...data, pros, team, duplicates: [], privacy };
    // Possíveis duplicados deste cadastro (menos os já marcados como "pessoa diferente")
    const dups = ctx.can("contatos.mesclar")
      ? await findDuplicatesFor(tx, { name: data.contact.name, phone: data.contact.phone, email: data.contact.email, birthDate: data.contact.birthDate }, id)
      : [];
    const dismissed = dups.length
      ? await tx
          .select({ a: schema.contactDuplicateDismissals.contactA, b: schema.contactDuplicateDismissals.contactB })
          .from(schema.contactDuplicateDismissals)
          .where(or(eq(schema.contactDuplicateDismissals.contactA, id), eq(schema.contactDuplicateDismissals.contactB, id)))
      : [];
    const duplicates = dups.filter((d) => !dismissed.some((x) => x.a === d.id || x.b === d.id));
    return { ...data, pros, team, duplicates, privacy };
  });
  if (!result) notFound();

  const { team, duplicates, contact: c, conversations, upcoming, tasks, timeline, stats, lastNps, waitlist, bestTime, responsiveness, pros } = result;

  // Ficha com dados apagados a pedido do titular: só o aviso e os números sem identificação
  if (c.anonymizedAt) {
    const when = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: clinicTimeZone() });
    return (
      <>
        <Link href="/crm/contatos" className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Contatos
        </Link>
        <section className="max-w-2xl rounded-3xl bg-paper p-5 ring-1 ring-line sm:p-6">
          <ShieldCheck className="size-8 text-pep" aria-hidden />
          <h1 className="mt-2 text-2xl font-bold">Dados apagados a pedido do paciente</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Em {when(c.anonymizedAt)}
            {result.privacy.done ? `, protocolo ${result.privacy.done.protocol}` : ""}. Nome, contatos, mensagens, anotações e leituras da IA foram apagados de forma definitiva (LGPD, art. 18).
            Ficaram só números sem identificação, usados nos relatórios.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Consultas realizadas" value={String(stats.attended)} />
            <Stat label="Faltas" value={String(stats.noShows)} />
            <Stat label="Conversas" value={String(conversations.length)} />
          </dl>
          <p className="mt-4 text-xs text-ink-soft">
            Esta ficha não pode ser editada nem receber consultas ou mensagens. Se a pessoa voltar a procurar a clínica, um cadastro novo é criado, sem ligação com este.
          </p>
        </section>
      </>
    );
  }
  const canEdit = ctx.can("pacientes.editar");
  const canSchedule = ctx.can("agenda.editar");
  const years = age(c.birthDate, today);
  const birthdayToday = c.birthDate?.slice(5) === today.slice(5);
  const mainConversation = conversations[0];

  return (
    <>
      <Link href="/crm/contatos" className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Contatos
      </Link>

      {/* ------------------------------ Cabeçalho ------------------------------ */}
      <header className="mb-5 rounded-3xl bg-paper p-4 ring-1 ring-line sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={c.name} size="lg" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold break-words sm:text-3xl">{c.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
                <StageBadge stage={c.stage} />
                {years !== null ? <span>{years} anos</span> : null}
                {birthdayToday ? <Badge tone="crm">aniversário hoje</Badge> : null}
                <span>{formatPhone(c.phone)}</span>
                {c.optedOutAt ? <Badge tone="alert">pediu SAIR</Badge> : null}
                {c.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSchedule ? <ScheduleButton contactId={c.id} contactName={c.name} conversationId={mainConversation?.id} /> : null}
            {ctx.can("conversas.responder") && ctx.has(CRM_FEATURES.inbox) ? (
              <StartConversation contactId={c.id} optedOut={!!c.optedOutAt} options={channelOptions({ conversations, identities: c.identities, phone: c.phone })} />
            ) : mainConversation ? (
              <Link href={`/crm/conversas/${mainConversation.id}`} className={buttonStyles("secondary")}>
                <MessageCircle className="size-4" aria-hidden /> Ver conversa
              </Link>
            ) : null}
            {canSchedule && ctx.has(CRM_FEATURES.waitlist) && !waitlist ? <AddToWaitlist professionals={pros} contact={{ id: c.id, name: c.name }} /> : null}
            {canEdit ? (
              <EditContactButton
                initial={{
                  id: c.id,
                  version: c.version,
                  name: c.name,
                  phone: c.phone ?? "",
                  email: c.email ?? "",
                  birthDate: c.birthDate ?? "",
                  preferredChannel: c.preferredChannel ?? "",
                  source: c.source ?? "",
                  tags: c.tags.join(", "),
                  consentMarketing: c.consentMarketing,
                }}
              />
            ) : null}
          </div>
        </div>

        {/* Números da relação */}
        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Consultas realizadas" value={String(stats.attended)} />
          <Stat
            label="Comparecimento"
            value={stats.attendanceRate === null ? "—" : `${stats.attendanceRate}%`}
            tone={stats.attendanceRate !== null && stats.attendanceRate < 70 ? "alert" : undefined}
            hint={stats.noShows ? `${stats.noShows} ${stats.noShows === 1 ? "falta" : "faltas"}` : undefined}
          />
          <Stat
            label="Última nota de satisfação"
            value={lastNps ? String(lastNps.score) : "—"}
            tone={lastNps ? (lastNps.score <= 6 ? "alert" : lastNps.score >= 9 ? "good" : undefined) : undefined}
            hint={lastNps ? ago(lastNps.createdAt, current.getTime()) : undefined}
          />
          <Stat label="Paciente desde" value={c.createdAt.toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: clinicTimeZone() })} hint={c.source ?? undefined} />
        </dl>
      </header>

      {duplicates.length ? (
        <section aria-label="Possível cadastro duplicado" className="mb-5 rounded-2xl bg-erp-tint p-4">
          <p className="font-semibold">Este paciente pode ter outro cadastro</p>
          <ul className="mt-2 space-y-2">
            {duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper/80 px-3 py-2">
                <span>
                  <Link href={`/crm/contatos/${d.id}`} className="font-semibold hover:underline">
                    {d.name}
                  </Link>
                  <span className="text-sm text-ink-soft"> ({d.reasons.join(", ")})</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Link href={`/crm/contatos/duplicados/comparar?a=${c.id}&b=${d.id}`} className={buttonStyles("secondary")}>
                    Comparar e unificar
                  </Link>
                  <DismissPair a={c.id} b={d.id} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---------------------------- Linha do tempo ---------------------------- */}
        <Panel title="Linha do tempo" description="Tudo o que aconteceu com este paciente, em todos os canais." className="order-2 min-w-0 self-start lg:order-1">
          <Timeline items={timeline} />
        </Panel>

        {/* -------------------------------- Lateral ------------------------------- */}
        <aside className="order-1 min-w-0 space-y-5 lg:order-2" aria-label="Resumo e ações">
          <Panel title="Próximas consultas">
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-soft">Nenhuma consulta marcada.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((a) => (
                  <li key={a.id} className="rounded-xl bg-fog p-3">
                    <Link
                      href={`/crm/agenda?data=${utcToZoned(a.startsAt).date}&consulta=${a.id}`}
                      className="font-semibold text-crm hover:underline"
                      title="Abrir na agenda (remarcar, confirmar, editar)"
                    >
                      {formatWhen(a.startsAt, current)}
                    </Link>
                    <p className="text-sm text-ink-soft">
                      {a.professional.name}
                      {a.service ? `, ${a.service}` : ""}, {a.status === "confirmado" ? "confirmada" : "aguardando confirmação"}
                    </p>
                    {a.risk && a.risk.level !== "baixo" ? (
                      <p className={cn("mt-1 text-xs font-semibold", a.risk.level === "alto" ? "text-alert" : "text-erp-ink")}>
                        {RISK_LABEL[a.risk.level]} de falta. {a.risk.suggestion}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {waitlist ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-crm-tint px-3 py-2 text-sm text-crm">
                <span>
                  Na lista de espera ({WAITLIST_PERIOD_LABEL[waitlist.period].toLowerCase()}
                  {waitlist.professional ? `, ${waitlist.professional.name}` : ""}).
                </span>
                {canSchedule ? (
                  <AddToWaitlist professionals={pros} contact={{ id: c.id, name: c.name }} entry={{ professionalId: waitlist.professionalId, period: waitlist.period, notes: waitlist.notes }} />
                ) : null}
              </div>
            ) : null}
          </Panel>

          <Panel title="Como se relacionar" description="Aprendido com as conversas.">
            <ul className="space-y-2.5 text-sm">
              <li>
                <span className="text-ink-soft">Canal preferido: </span>
                {c.preferredChannel ? <ChannelBadge channel={c.preferredChannel} /> : <span>o último que usou</span>}
              </li>
              <li>
                <span className="text-ink-soft">Costuma escrever: </span>
                {bestTime ? (
                  <strong>
                    {bestTime.label} <span className="font-normal text-ink-soft">({bestTime.share}% das mensagens)</span>
                  </strong>
                ) : (
                  <span className="text-ink-soft">ainda sem conversa suficiente</span>
                )}
              </li>
              <li>
                <span className="text-ink-soft">Responde em: </span>
                {responsiveness !== null ? (
                  <strong>{responsiveness < 60 ? `${responsiveness} min` : `${Math.round(responsiveness / 60)} h`} (mediana)</strong>
                ) : (
                  <span className="text-ink-soft">—</span>
                )}
              </li>
              <li className="flex flex-wrap gap-1.5">
                {c.identities.map((i) => (
                  <span key={i.id} className="rounded-lg bg-fog px-2 py-1 text-xs">
                    {CHANNEL_LABEL[i.channel]}: {i.channel === "whatsapp" ? formatPhone(i.externalId) : (i.displayName ?? i.externalId)}
                  </span>
                ))}
              </li>
              <li className={cn("flex items-start gap-2 rounded-xl px-3 py-2", c.optedOutAt ? "bg-alert-tint" : c.consentMarketing ? "bg-pep-tint" : "bg-erp-tint")}>
                {c.consentMarketing && !c.optedOutAt ? <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden />}
                <span>
                  {c.optedOutAt
                    ? `Pediu para não receber mensagens ${ago(c.optedOutAt, current.getTime())}. Responda só se ele escrever.`
                    : c.consentMarketing
                      ? "Autorizou mensagens de relacionamento (lembretes de retorno e pesquisas)."
                      : "Sem consentimento para lembretes de retorno. Peça autorização no próximo contato."}
                </span>
              </li>
              {c.optedOutAt && canEdit ? (
                <li>
                  <ActionButton
                    action={resubscribeAction}
                    fields={{ contactId: c.id }}
                    label="Paciente pediu para voltar a receber"
                    pendingText="Liberando..."
                    variant="ghost"
                    confirmText="Confirme que o próprio paciente pediu para voltar a receber mensagens (fica registrado quem liberou)."
                  />
                  <p className="text-xs text-ink-soft">Ele também pode enviar VOLTAR pelo WhatsApp.</p>
                </li>
              ) : null}
            </ul>
          </Panel>

          <Panel title="Tarefas" actions={canEdit ? <TaskButton team={team} today={today} fixedContact={{ id: c.id, name: c.name }} /> : null}>
            {tasks.length ? (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 rounded-xl bg-fog p-3">
                    <span className="min-w-0 text-sm">
                      <span className="block font-semibold">{t.title}</span>
                      <span className={cn("text-xs", t.dueDate < today ? "font-semibold text-alert" : "text-ink-soft")}>
                        {t.dueDate === today ? "hoje" : t.dueDate < today ? "atrasada" : t.dueDate.split("-").reverse().slice(0, 2).join("/")}
                        {t.assigneeId ? `, com ${team.find((u) => u.id === t.assigneeId)?.name.split(" ")[0] ?? "outro usuário"}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center">
                      {canEdit ? (
                        <TaskButton
                          team={team}
                          today={today}
                          fixedContact={{ id: c.id, name: c.name }}
                          initial={{ id: t.id, title: t.title, dueDate: t.dueDate, assigneeId: t.assigneeId ?? "", contact: { id: c.id, name: c.name } }}
                        />
                      ) : null}
                      <ActionButton action={completeTaskAction} fields={{ id: t.id }} label="Feito" pendingText="..." variant="ghost" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">Nenhuma tarefa aberta.</p>
            )}
          </Panel>

          {canEdit ? (
            <Panel title="Anotar">
              <NoteForm contactId={c.id} />
            </Panel>
          ) : null}

          {ctx.can("jornada.editar") ? (
            <Panel>
              <StageSelect contactId={c.id} stage={c.stage} />
              {c.stage === "perdido" && c.lostReason ? <p className="mt-2 text-sm text-ink-soft">Motivo: {c.lostReason}</p> : null}
            </Panel>
          ) : null}

          {ctx.can("contatos.exportar_ficha") || ctx.can("pacientes.editar") || ctx.can("pacientes.anonimizar") ? (
            <Panel title="Dados pessoais (LGPD)">
              <PrivacyPanel
                contactId={c.id}
                contactName={c.name}
                openRequest={
                  result.privacy.open
                    ? (() => {
                        const st = privacyDeadlineState(result.privacy.open.dueAt, current);
                        return {
                          id: result.privacy.open.id,
                          protocol: result.privacy.open.protocol,
                          dueLabel: st.label,
                          dueTone: st.tone,
                          dueDate: result.privacy.open.dueAt.toLocaleDateString("pt-BR", { timeZone: clinicTimeZone() }),
                          channelLabel: PRIVACY_REQUEST_CHANNEL_LABEL[result.privacy.open.channel as PrivacyRequestChannel] ?? "outro",
                        };
                      })()
                    : null
                }
                blockers={result.privacy.blockers}
                canExport={ctx.can("contatos.exportar_ficha")}
                canRegister={ctx.can("pacientes.editar")}
                canExecute={ctx.can("pacientes.anonimizar")}
                ownerName={c.owner?.name ?? null}
              />
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "alert" | "good" }) {
  return (
    <div className={cn("rounded-2xl px-3 py-2.5", tone === "alert" ? "bg-alert-tint" : tone === "good" ? "bg-pep-tint" : "bg-fog")}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-display text-xl font-bold tabular">{value}</dd>
      {hint ? <dd className="truncate text-xs text-ink-soft">{hint}</dd> : null}
    </div>
  );
}
