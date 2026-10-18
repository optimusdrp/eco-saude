/**
 * Textos legíveis para a linha do tempo (usado no servidor e no navegador).
 */
import {
  APPOINTMENT_STATUS_LABEL,
  CHANNEL_LABEL,
  JOURNEY_STAGE_LABEL,
  PROFILE_FIELD_LABEL,
  formatWhen,
  type AppointmentStatus,
  type Channel,
  type JourneyStage,
  type ProfileField,
} from "@ecosaude/core/crm";

type Data = Record<string, unknown> | null;

/** Frase para cada tipo de evento do CRM. */
export function describeEvent(type: string, data: Data, now = new Date()): string {
  const d = data ?? {};
  const when = typeof d.startsAt === "string" ? formatWhen(new Date(d.startsAt), now) : "";
  switch (type) {
    case "stage_changed":
      return `${d.auto ? "Jornada atualizada" : "Movido"}: ${JOURNEY_STAGE_LABEL[d.de as JourneyStage] ?? d.de} para ${JOURNEY_STAGE_LABEL[d.para as JourneyStage] ?? d.para}${d.motivo ? `. Motivo: ${String(d.motivo)}` : ""}`;
    case "note":
      return String(d.body ?? "");
    case "appointment_created":
      return `Consulta marcada ${when}${d.profissional ? ` com ${String(d.profissional)}` : ""}${d.origem === "lista_espera" ? " (lista de espera)" : ""}`;
    case "appointment_finished":
      return `Atendimento finalizado (${String(d.minutos ?? "?")} min)`;
    case "appointment_status":
      return `Consulta ${when ? `de ${when} ` : ""}${APPOINTMENT_STATUS_LABEL[d.para as AppointmentStatus]?.toLowerCase() ?? String(d.para)}${d.auto ? " pelo próprio paciente" : ""}${d.motivo ? `. Motivo: ${String(d.motivo)}` : ""}`;
    case "appointment_rescheduled": {
      const from = typeof d.deStartsAt === "string" ? formatWhen(new Date(d.deStartsAt), now) : "";
      const changedPro = d.deProfissional && d.deProfissional !== d.profissional;
      return `Consulta remarcada de ${from} para ${when}${changedPro ? ` (agora com ${String(d.profissional)})` : ""}`;
    }
    case "appointment_updated":
      return `Consulta ${when ? `de ${when} ` : ""}atualizada${d.servico ? `: ${String(d.servico)}` : ""}${d.duracao ? `, duração ${String(d.duracao)} min` : ""}`;
    case "confirmation_requested":
      return "Pedido de confirmação enviado";
    case "slot_offered":
      return `Horário oferecido ${when}${d.profissional ? ` com ${String(d.profissional)}` : ""}`;
    case "slot_filled":
      return `Aceitou horário da lista de espera ${when}`;
    case "nps":
      return `Respondeu a pesquisa de satisfação: nota ${String(d.nota)}`;
    case "opt_out":
      return "Pediu para não receber mais mensagens (SAIR)";
    case "return_reminder":
      return `Lembrete de retorno enviado (${String(d.protocolo ?? "")})`;
    case "promise_task":
      return `Lembrete criado: ${String(d.tarefa ?? "")}${typeof d.prazo === "string" ? ` (até ${d.prazo.slice(8, 10)}/${d.prazo.slice(5, 7)})` : ""}`;
    case "promise_undone":
      return `Lembrete apagado (não era promessa): ${String(d.tarefa ?? "")}`;
    case "suggestion_applied":
      return d.tipo === "etiqueta"
        ? `Etiqueta sugerida aplicada: ${String(d.valor ?? "")}`
        : `Ficha atualizada pela conversa: ${PROFILE_FIELD_LABEL[d.campo as ProfileField] ?? String(d.campo ?? "")} (${String(d.valor ?? "")})`;
    case "sentiment_alert":
      return `Gestão avisada: paciente ${String(d.sentimento ?? "").toLowerCase()}${d.motivo ? ` (${d.motivo})` : ""}`;
    case "urgency_flag":
      return `Sinal de possível urgência: ${Array.isArray(d.sinais) ? d.sinais.join(", ") : ""}`;
    case "contact_created":
      return `Primeiro contato pelo ${CHANNEL_LABEL[d.origem as Channel] ?? String(d.origem ?? "cadastro")}`;
    case "contact_updated":
      return "Cadastro atualizado";
    case "automation_run":
      return `Regra “${String(d.regra ?? "")}”: ${String(d.resultado ?? "executada")}`;
    case "confirmation_reply":
      return d.resposta === "confirmou" ? "Confirmou a consulta pela mensagem" : "Pediu para remarcar pela mensagem de confirmação";
    case "reminder_sent":
      return "Lembrete do dia enviado";
    case "post_visit_sent":
      return "Mensagem pós-consulta enviada";
    case "birthday_sent":
      return "Mensagem de aniversário enviada";
    case "no_show_followup":
      return "Mensagem após a falta enviada";
    case "cancel_notice":
      return "Aviso de cancelamento enviado";
    case "welcome_sent":
      return "Boas-vindas enviada";
    case "after_hours_reply":
      return "Resposta automática de fora do horário";
    case "waitlist_added":
      return "Entrou na lista de espera";
    case "task_deleted":
      return `Tarefa excluída: ${String(d.title ?? "")}`;
    case "task_done":
      return `Tarefa concluída: ${String(d.title ?? "")}`;
    case "opt_in":
      return d.origem === "paciente" ? "Pediu para voltar a receber mensagens (VOLTAR)" : "Equipe liberou o envio de mensagens novamente";
    case "phone_changed":
      return `Celular alterado${d.de ? ` (o número antigo deixou de receber mensagens)` : ""}`;
    case "contacts_merged":
      return `Cadastro unificado com "${String(d.nome ?? "")}"${d.telefoneDiferente ? ` (outro celular: ${String(d.telefoneDiferente)})` : ""}`;
    case "duplicate_dismissed":
      return "Marcado como pessoa diferente de um cadastro parecido";
    case "conversation_assigned":
      return d.para ? `Conversa transferida para ${String(d.para)}` : "Conversa ficou sem responsável";
    case "owner_changed":
      return d.para ? `Responsável pelo contato: ${String(d.para)}` : "Contato ficou sem responsável";
    case "conversation_started":
      return `Conversa iniciada pela clínica no ${CHANNEL_LABEL[d.canal as Channel] ?? String(d.canal ?? "")}`;
    case "contacts_export":
      return `Lista de contatos exportada (${String(d.linhas ?? 0)} linhas)`;
    case "data_export":
      return `Dados do paciente exportados (LGPD${d.protocolo ? `, protocolo ${String(d.protocolo)}` : ""})`;
    case "privacy_request":
      return `Pedido de exclusão dos dados registrado (protocolo ${String(d.protocolo ?? "")})`;
    case "privacy_refused":
      return `Pedido de exclusão recusado (protocolo ${String(d.protocolo ?? "")})`;
    case "data_anonymized":
      return `Dados apagados a pedido do paciente (protocolo ${String(d.protocolo ?? "")})`;
    default:
      return type;
  }
}

/** "há 5 min", "há 2 h", "há 3 dias" */
export function ago(date: Date, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - date.getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

/** Duração curta de espera: "4 min", "1 h 20" */
export function waitLabel(since: Date, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - since.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return rest ? `${h} h ${rest}` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** 5551999990000 -> (51) 99999-0000 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const d = phone.replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

/* ------------------------- Canais para falar com o paciente ------------------------- */

export interface ChannelOption {
  channel: Channel;
  /** Conversa já existente neste canal (null = dá para iniciar) */
  conversationId: string | null;
}

/**
 * Canais pelos quais a clínica consegue falar com o paciente: os que ele já
 * usou (identidade ou conversa) e o WhatsApp, se houver celular no cadastro.
 * Usado no servidor (ficha) e no navegador (trilho).
 */
export function channelOptions(input: { conversations: { id: string; channel: Channel }[]; identities: { channel: Channel }[]; phone: string | null }): ChannelOption[] {
  const order: Channel[] = ["whatsapp", "instagram", "facebook", "telegram"];
  const reachable = new Set<Channel>(input.identities.map((i) => i.channel));
  if (input.phone) reachable.add("whatsapp");
  for (const c of input.conversations) reachable.add(c.channel);
  return order.filter((c) => reachable.has(c)).map((c) => ({ channel: c, conversationId: input.conversations.find((x) => x.channel === c)?.id ?? null }));
}
