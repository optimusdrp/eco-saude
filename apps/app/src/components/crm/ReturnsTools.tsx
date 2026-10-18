"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles } from "@/components/ui/styles";
import { saveReturnProtocolAction } from "@/modules/crm/actions/settings";

/**
 * Protocolos de retorno: criar e editar (usado no Radar de retornos).
 */

/* ------------------------------ Protocolos ---------------------------------- */

export interface ProtocolValues {
  id?: string;
  name: string;
  serviceMatch: string;
  daysAfter: number;
  message: string;
  active: boolean;
}

const NEW_PROTOCOL: ProtocolValues = {
  name: "",
  serviceMatch: "",
  daysAfter: 180,
  message: "Olá, {{primeiro_nome}}! Já faz um tempo desde a sua última consulta na {{clinica}}. Que tal agendar o seu retorno? Responda esta mensagem que a gente encontra um horário.",
  active: true,
};

/** Criar/editar protocolo de retorno ("revisão em 6 meses", "retorno de 30 dias"). */
export function ProtocolButton({ initial }: { initial?: ProtocolValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveReturnProtocolAction, {});
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setOpen(false);
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  const v = initial ?? NEW_PROTOCOL;
  const p = initial?.id ?? "new";
  const val = (k: keyof ProtocolValues) => state.values?.[k] ?? String(v[k] ?? "");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles(initial ? "ghost" : "secondary")} aria-label={initial ? `Editar protocolo ${initial.name}` : undefined}>
        {initial ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {initial ? "Editar" : "Novo protocolo"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={initial ? "Editar protocolo" : "Novo protocolo de retorno"} description="Quem passou por este tipo de consulta entra no radar após o prazo.">
        <form action={action} className="space-y-4">
          <FormMessage state={state} />
          {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
          <Field label="Nome" name="name" id={`pr-name-${p}`} placeholder="Revisão semestral" defaultValue={val("name")} error={state.errors?.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Serviço (contém)"
              name="serviceMatch"
              id={`pr-svc-${p}`}
              placeholder="limpeza"
              defaultValue={val("serviceMatch")}
              hint="Vazio = qualquer consulta."
            />
            <Field label="Dias depois da consulta" name="daysAfter" id={`pr-days-${p}`} type="number" min={7} max={730} defaultValue={val("daysAfter")} error={state.errors?.daysAfter} />
          </div>
          <TextareaField
            label="Mensagem"
            name="message"
            id={`pr-msg-${p}`}
            defaultValue={val("message")}
            error={state.errors?.message}
            hint="Use {{primeiro_nome}}, {{nome}} e {{clinica}}. Enviada só a quem autorizou mensagens."
            rows={5}
          />
          <CheckboxField name="active" label="Ativo" defaultChecked={state.values ? state.values.active === "on" : v.active} />
          <SubmitButton pendingText="Salvando...">Salvar protocolo</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}
