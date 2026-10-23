/**
 * MENSAGENS ENVIADAS PELO CELULAR DA CLÍNICA (WhatsApp por QR code, via Evolution)
 *
 * Quando alguém da equipe responde direto no celular, a Evolution avisa o Tropi (key.fromMe).
 * Essas mensagens entram em Conversas como saída "enviada pelo celular":
 *  - sem autor (o celular não diz quem da equipe digitou), mas CONTAM como resposta humana
 *    (tiram a conversa da fila de espera, valem nas regras "a equipe respondeu");
 *  - não abrem nem renovam a janela de 24h (a janela é do paciente: só mensagem dele conta);
 *  - não disparam automações, IA nem respostas automáticas.
 *
 * O cuidado principal é NÃO DUPLICAR o que o próprio Tropi enviou: a Evolution pode devolver
 * a mensagem enviada pela API como fromMe. Primeiro compara pelo ID externo; na corrida (o eco
 * chega antes de o Tropi gravar o ID), compara com a mensagem do Tropi que acabou de sair.
 */

/** meta.source das mensagens que vieram do celular */
export const PHONE_SOURCE = "celular" as const;

/** A mensagem veio do celular da clínica? */
export function isFromPhone(meta: unknown): boolean {
  return !!meta && typeof meta === "object" && (meta as { source?: unknown }).source === PHONE_SOURCE;
}

/**
 * Saída escrita por uma PESSOA da equipe (no Tropi, com autor, ou no celular)?
 * As automáticas (lembrete, confirmação, IA) não contam.
 */
export function isHumanOutbound(m: { direction: string; authorId: string | null; meta: unknown }): boolean {
  return m.direction === "out" && (m.authorId !== null || isFromPhone(m.meta));
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Janela da corrida: o eco chega segundos depois do envio; 10 min dá folga para a fila */
export const ECHO_WINDOW_MS = 10 * 60_000;

/**
 * O eco do celular é a mensagem que o Tropi acabou de enviar (ainda sem ID externo gravado)?
 * Mesmo texto (ignorando espaços e maiúsculas) e enviada há pouco. Anexo sem legenda: o eco
 * traz o rótulo ("[imagem]"), então aceita também o rótulo do anexo do Tropi.
 */
export function isEchoOf(echo: { text: string; at: Date }, sent: { body: string; at: Date; attachmentLabel?: string | null }): boolean {
  if (Math.abs(echo.at.getTime() - sent.at.getTime()) > ECHO_WINDOW_MS) return false;
  const e = norm(echo.text);
  return e === norm(sent.body) || (!!sent.attachmentLabel && e === norm(sent.attachmentLabel));
}
