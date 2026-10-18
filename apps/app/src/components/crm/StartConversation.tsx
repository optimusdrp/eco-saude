"use client";

import { CHANNEL_LABEL } from "@ecosaude/core/crm";
import { MessageCirclePlus, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Dialog, FormMessage, SubmitButton } from "@/components/ui";
import { channelDot } from "@/components/ui/server";
import { buttonStyles, cn, type Variant } from "@/components/ui/styles";
import { startConversationAction } from "@/modules/crm/actions/conversations";
import type { ChannelOption } from "@/modules/crm/format";

/**
 * MENSAGEM PARA O PACIENTE
 * Lista os canais pelos quais dá para falar com a pessoa:
 *   - conversa já existente  -> abre direto
 *   - canal alcançável sem conversa (ex.: WhatsApp pelo celular do cadastro) -> inicia
 * O paciente ainda não escreveu, então a janela de 24h da Meta está fechada:
 * a primeira mensagem precisa ser um modelo aprovado (a caixa já mostra só esses).
 */

export function StartConversation({
  contactId,
  options,
  optedOut,
  variant = "secondary",
  className,
  compact = false,
}: {
  contactId: string;
  options: ChannelOption[];
  optedOut: boolean;
  variant?: Variant;
  className?: string;
  /** Versão em bloco (trilho do paciente) */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(startConversationAction, {});
  const label = options.some((o) => o.conversationId) ? "Conversar" : "Enviar mensagem";
  const style = compact
    ? "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-xl bg-fog text-xs font-semibold hover:bg-crm-tint"
    : buttonStyles(variant, className);

  // Uma única conversa existente: atalho direto, sem diálogo
  if (options.length === 1 && options[0]!.conversationId) {
    return (
      <Link href={`/crm/conversas/${options[0]!.conversationId}`} className={style}>
        <MessageCircle className={compact ? "size-5" : "size-4"} aria-hidden /> {label}
      </Link>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={style} disabled={options.length === 0} title={options.length === 0 ? "Sem canal de contato: cadastre o celular" : undefined}>
        <MessageCirclePlus className={compact ? "size-5" : "size-4"} aria-hidden /> {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Falar com o paciente" description="Escolha o canal.">
        <div className="space-y-3">
          {optedOut ? (
            <p className="rounded-xl bg-alert-tint px-3 py-2 text-sm text-alert">
              Este paciente pediu para não receber mensagens (SAIR). Escreva só se for sobre o atendimento dele e com motivo claro.
            </p>
          ) : null}
          <FormMessage state={state} />
          <ul className="space-y-2">
            {options.map((o) => (
              <li key={o.channel} className="flex items-center justify-between gap-3 rounded-xl bg-fog px-3 py-2">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={cn("size-2.5 rounded-full", channelDot[o.channel])} aria-hidden />
                  {CHANNEL_LABEL[o.channel]}
                </span>
                {o.conversationId ? (
                  <Link href={`/crm/conversas/${o.conversationId}`} className={buttonStyles("ghost")}>
                    Abrir conversa
                  </Link>
                ) : (
                  <form action={action}>
                    <input type="hidden" name="contactId" value={contactId} />
                    <input type="hidden" name="channel" value={o.channel} />
                    <SubmitButton variant="primary" pendingText="Abrindo...">
                      Iniciar
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">
            Na primeira mensagem (ou depois de 24h sem resposta) WhatsApp, Instagram e Messenger só aceitam modelos aprovados, como /retomar. Telegram,
            Instagram e Messenger só aparecem para quem já escreveu para a clínica por eles.
          </p>
        </div>
      </Dialog>
    </>
  );
}
