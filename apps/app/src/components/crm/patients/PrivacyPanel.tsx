"use client";

/**
 * PAINEL "DADOS PESSOAIS (LGPD)" DA FICHA
 *
 *  - Cópia dos dados: baixa o arquivo (vira um pedido de acesso atendido, com protocolo).
 *  - Exclusão:
 *      RECEPÇÃO (Editar contatos): registra o pedido e por onde chegou -> protocolo e prazo.
 *      GESTÃO (Excluir dados): confere a identidade, digita o nome e apaga; ou recusa
 *      com um motivo da lista (sem texto livre: o registro não pode guardar dado pessoal).
 *  - A exclusão é IRREVERSÍVEL: o diálogo diz exatamente o que some e o que fica.
 */
import { PRIVACY_REFUSAL_LABEL, PRIVACY_REFUSAL_REASONS, PRIVACY_REQUEST_CHANNEL_LABEL, PRIVACY_REQUEST_CHANNELS } from "@ecosaude/core/crm";
import { AlertTriangle, Download, ShieldX, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { anonymizeContactAction, refusePrivacyRequestAction, registerPrivacyRequestAction } from "@/modules/crm/actions/privacy";

export interface PrivacyPanelProps {
  contactId: string;
  contactName: string;
  /** Pedido de exclusão em aberto */
  openRequest: { id: string; protocol: string; dueLabel: string; dueTone: "ok" | "warning" | "alert"; dueDate: string; channelLabel: string } | null;
  /** O que impede apagar agora (ex.: consulta marcada) */
  blockers: string[];
  canExport: boolean;
  canRegister: boolean;
  canExecute: boolean;
  ownerName: string | null;
}

const TONE = { ok: "bg-fog text-ink-soft ring-1 ring-line", warning: "bg-erp-tint text-erp-ink", alert: "bg-alert-tint text-alert" } as const;

export function PrivacyPanel(p: PrivacyPanelProps) {
  const router = useRouter();
  const [registered, register] = useActionState(registerPrivacyRequestAction, {});
  const [refused, refuse] = useActionState(refusePrivacyRequestAction, {});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (registered.ok || refused.ok) router.refresh();
  }, [registered, refused, router]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">O paciente pode pedir uma cópia de tudo o que a clínica guarda sobre ele, ou que os dados sejam apagados.</p>

      {p.canExport ? (
        <a href={`/api/contatos/${p.contactId}/exportar`} className={buttonStyles("ghost", "w-full justify-start")} download>
          <Download className="size-4" aria-hidden /> Exportar dados do paciente
        </a>
      ) : null}

      {/* Pedido de exclusão em aberto */}
      {p.openRequest ? (
        <div className="rounded-xl bg-fog p-3">
          <p className="text-sm font-semibold">Pedido de exclusão {p.openRequest.protocol}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            Chegou por: {p.openRequest.channelLabel.toLowerCase()}. Responder até {p.openRequest.dueDate}.
          </p>
          <span className={cn("mt-1.5 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", TONE[p.openRequest.dueTone])}>{p.openRequest.dueLabel}</span>
          {p.canExecute ? (
            <div className="mt-3 space-y-2">
              <button type="button" onClick={() => setOpen(true)} className={buttonStyles("danger", "w-full")}>
                <Trash2 className="size-4" aria-hidden /> Apagar dados do paciente
              </button>
              <form action={refuse} className="space-y-2">
                <input type="hidden" name="requestId" value={p.openRequest.id} />
                <SelectField label="Ou recusar o pedido" name="reason" defaultValue="">
                  <option value="" disabled>
                    Escolha o motivo
                  </option>
                  {PRIVACY_REFUSAL_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {PRIVACY_REFUSAL_LABEL[r]}
                    </option>
                  ))}
                </SelectField>
                <SubmitButton variant="ghost" pendingText="Recusando...">
                  <ShieldX className="size-4" aria-hidden /> Recusar pedido
                </SubmitButton>
                <FormMessage state={refused} />
              </form>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-soft">A gestão confere a identidade e executa. Você será avisado pela linha do tempo.</p>
          )}
        </div>
      ) : p.canRegister ? (
        <form action={register} className="space-y-2 rounded-xl bg-fog p-3">
          <input type="hidden" name="contactId" value={p.contactId} />
          <SelectField label="Pediu para apagar os dados? Registre o pedido" name="channel" defaultValue="" hint="Gera um protocolo e conta o prazo de 15 dias.">
            <option value="" disabled>
              Por onde o pedido chegou
            </option>
            {PRIVACY_REQUEST_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {PRIVACY_REQUEST_CHANNEL_LABEL[c]}
              </option>
            ))}
          </SelectField>
          <SubmitButton variant="secondary" pendingText="Registrando...">
            Registrar pedido de exclusão
          </SubmitButton>
          <FormMessage state={registered} />
        </form>
      ) : null}

      {/* A gestão pode atender na hora (o pedido é registrado junto) */}
      {!p.openRequest && p.canExecute ? (
        <button type="button" onClick={() => setOpen(true)} className={buttonStyles("ghost", "w-full justify-start text-alert hover:text-alert")}>
          <Trash2 className="size-4" aria-hidden /> Apagar agora (paciente presente)
        </button>
      ) : null}

      {p.ownerName ? <p className="text-xs text-ink-soft">Responsável pelo relacionamento: {p.ownerName}</p> : null}

      {p.canExecute ? <AnonymizeDialog {...p} open={open} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function AnonymizeDialog(p: PrivacyPanelProps & { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(anonymizeContactAction, {});
  const [, startTransition] = useTransition();
  // Campos controlados: depois de um erro (ex.: esqueceu de marcar a identidade) o nome digitado não some
  const [identity, setIdentity] = useState(false);
  const [typed, setTyped] = useState("");
  const [channel, setChannel] = useState("presencial");
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  const blocked = p.blockers.length > 0;

  return (
    <Dialog wide open={p.open} onClose={p.onClose} title="Apagar os dados do paciente" description="Atende o pedido do titular (LGPD, art. 18). Não tem como desfazer.">
      <div className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <section className="rounded-xl bg-alert-tint/60 p-3">
            <h3 className="font-semibold text-alert">Some para sempre</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-soft">
              <li>Nome, telefone, e-mail, nascimento, convênio e indicação</li>
              <li>Texto de todas as mensagens e os números dos canais</li>
              <li>Anotações, etiquetas e tarefas em aberto</li>
              <li>Resumos, sentimentos e sugestões da IA</li>
              <li>Lista de espera e mensagens que ainda iam sair</li>
            </ul>
          </section>
          <section className="rounded-xl bg-fog p-3">
            <h3 className="font-semibold">Fica, sem identificar ninguém</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-soft">
              <li>Datas, profissional e serviço das consultas (relatórios)</li>
              <li>Notas da pesquisa de satisfação</li>
              <li>O registro deste pedido (protocolo, datas e quem executou)</li>
            </ul>
          </section>
        </div>
        <p className="flex gap-2 rounded-xl bg-erp-tint px-3 py-2 text-erp-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            O prontuário (quando existir no Tropi) não é apagado: a lei obriga a guardá-lo por 20 anos. As mensagens no celular do paciente e no WhatsApp também não são apagadas pelo sistema.
          </span>
        </p>

        {blocked ? (
          <div role="alert" className="rounded-xl bg-alert-tint px-3 py-2 font-semibold text-alert">
            Antes de apagar: {p.blockers.join(" ")}
          </div>
        ) : (
          <form
            // Envio manual (sem o "form action" do React): assim o formulário NÃO é limpo
            // depois de um erro, e a caixa de identidade mostra sempre o estado real.
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(() => action(fd));
            }}
            className="space-y-2"
          >
            <input type="hidden" name="contactId" value={p.contactId} />
            {!p.openRequest ? (
              <SelectField label="Por onde o pedido chegou" name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {PRIVACY_REQUEST_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {PRIVACY_REQUEST_CHANNEL_LABEL[c]}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <CheckboxField
              name="identity"
              checked={identity}
              onChange={(e) => setIdentity(e.target.checked)}
              label="Conferi que quem pediu é o próprio paciente (ou o responsável legal)"
              hint="Documento na recepção, ou o pedido veio do mesmo número ou e-mail do cadastro."
            />
            <Field label={`Para confirmar, digite o nome completo: ${p.contactName}`} name="confirmName" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <FormMessage state={state} />
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={p.onClose} className={buttonStyles("ghost")}>
                Cancelar
              </button>
              <button type="submit" disabled={pending} className={buttonStyles("danger")}>
                <Trash2 className="size-4" aria-hidden /> {pending ? "Apagando..." : "Apagar definitivamente"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
