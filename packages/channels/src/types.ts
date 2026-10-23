/**
 * Contrato único entre o Tropi e os canais de mensagem.
 *
 * O Tropi nunca fala "WhatsApp" ou "Telegram" diretamente: ele fala com um
 * ChannelAdapter. Trocar a simulação pela integração real é trocar o
 * adaptador, sem mexer em telas nem em regras do Tropi.
 *
 *   Paciente -> provedor (Meta/Telegram) -> webhook -> parseWebhook() -> InboundMessage -> CRM
 *   CRM -> OutboundMessage -> send() -> provedor -> paciente
 */
import type { AttachmentKind, Channel, ChannelMode } from "@ecosaude/core/crm";

export type { Channel, ChannelMode };

/** Mensagem recebida, já no formato do Tropi (igual para todos os canais). */
export interface InboundMessage {
  channel: Channel;
  /** Conta da clínica que recebeu (phone_number_id, id da página, nome do bot). Define a clínica. */
  accountId: string | null;
  /** ID da mensagem no provedor: usado para não gravar a mesma mensagem duas vezes */
  externalMessageId: string;
  from: {
    /** Telefone (WhatsApp), id do chat (Telegram), id do usuário (Instagram/Messenger) */
    externalId: string;
    name?: string;
    phone?: string;
  };
  text: string;
  receivedAt: Date;
  /** Arquivos que vieram junto (foto, áudio, PDF...). O Tropi baixa depois, fora do webhook. */
  attachments?: InboundAttachment[];
}

/**
 * Onde buscar o arquivo no provedor. O webhook NÃO traz o arquivo, só a referência:
 *  - whatsapp: id da mídia (baixa com o token na Graph API)
 *  - telegram: file_id (baixa com o token do bot)
 *  - url: link temporário (Messenger e Instagram)
 *  - simulado: arquivo que o simulador já guardou no armazenamento da clínica
 */
export type MediaRef =
  | { provider: "whatsapp"; mediaId: string }
  | { provider: "telegram"; fileId: string }
  | { provider: "url"; url: string }
  | { provider: "simulado"; key: string }
  /**
   * WhatsApp via Evolution API: o arquivo é pedido à instância pelo ID da mensagem.
   * `cloud`: na API oficial via Evolution, a Evolution NÃO guarda a mensagem para buscar
   * pelo ID; ela precisa do tipo e do ID do arquivo na Meta (vêm no próprio webhook).
   */
  | { provider: "evolution"; instance: string; messageId: string; cloud?: { type: string; mediaId: string; mime?: string } };

export interface InboundAttachment {
  kind: AttachmentKind;
  ref: MediaRef;
  /** O que o provedor DIZ que é (o Tropi confere pelo conteúdo ao baixar) */
  mime?: string;
  fileName?: string;
  sizeBytes?: number;
}

/** Arquivo baixado do provedor */
export interface MediaDownload {
  bytes: Uint8Array;
  mime?: string;
  fileName?: string;
}

/** Arquivo que a clínica envia (já conferido pelo Tropi) */
export interface OutboundMedia {
  kind: AttachmentKind;
  mime: string;
  fileName: string;
  bytes: Uint8Array;
  /**
   * Link temporário e assinado para o próprio arquivo (vale poucos minutos).
   * O Instagram só aceita anexo por link; os outros canais recebem os bytes.
   */
  publicUrl?: string;
}

/** Atualização de status de uma mensagem que a clínica enviou. */
export interface StatusUpdate {
  channel: Channel;
  externalMessageId: string;
  status: "enviada" | "entregue" | "lida" | "falhou";
  error?: string;
  at: Date;
}

export interface WebhookResult {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

/** Modelo aprovado no provedor (obrigatório no WhatsApp fora da janela de 24h). */
export interface TemplateRef {
  name: string;
  language: string;
  variables: string[];
}

export interface OutboundMessage {
  /** Destinatário no canal (mesmo formato de InboundMessage.from.externalId) */
  to: string;
  text: string;
  template?: TemplateRef;
  /** Anexo (foto, PDF, áudio...). `text` vira a legenda, quando o canal aceita. */
  media?: OutboundMedia;
}

export interface SendResult {
  externalMessageId: string;
}

/**
 * Credenciais de cada canal. NUNCA ficam no banco nem no código:
 * vêm de variáveis de ambiente ou de um cofre (AWS Secrets Manager).
 */
export interface ChannelCredentials {
  accessToken?: string;
  /** WhatsApp Cloud API */
  phoneNumberId?: string;
  /** Messenger: id da página; Instagram: id da conta profissional */
  accountId?: string;
  /** Telegram */
  botToken?: string;
  /** Versão da Graph API da Meta, ex.: "v23.0" (confirmar a atual na documentação) */
  graphVersion?: string;
  /**
   * Como o canal se conecta (CONNECTION_KINDS). Decide o adaptador:
   * evolution_qr/evolution_cloud -> Evolution API; instagram_login -> graph.instagram.com.
   */
  kind?: string | null;
  /** Evolution API: endereço do servidor, chave global e nome da instância da clínica */
  evolutionUrl?: string;
  evolutionApiKey?: string;
  instance?: string;
  /**
   * Endereços base das APIs. Em produção ficam no padrão; servem para testes e para
   * o servidor local da Bot API do Telegram (arquivos acima de 20 MB).
   */
  graphBase?: string;
  instagramBase?: string;
  telegramBase?: string;
}

/** Função de rede injetável (facilita testes sem internet). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | FormData },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  /** Para baixar arquivos */
  arrayBuffer?(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}>;

export interface ChannelAdapter {
  channel: Channel;
  mode: ChannelMode;
  send(message: OutboundMessage): Promise<SendResult>;
  /** Baixa um arquivo recebido (referência vinda do webhook) */
  downloadMedia?(ref: MediaRef, maxBytes: number): Promise<MediaDownload>;
  /** Converte o corpo do webhook do provedor no formato do Tropi */
  parseWebhook(body: unknown): WebhookResult;
}

export class ChannelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}
