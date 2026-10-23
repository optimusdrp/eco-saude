"use client";

import { CHANNEL_LABEL, CHANNELS, type Channel } from "@ecosaude/core/crm";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useState } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { buttonStyles } from "@/components/ui/styles";
import { createContactAction, updateContactAction } from "@/modules/crm/actions/contacts";
import { DuplicateHint, useDuplicateCheck, type DuplicateProbe } from "./DuplicateHint";

/**
 * FORMULÁRIO DE PACIENTE (cadastro e edição)
 * - O mesmo componente serve para criar e editar (com "version" para
 *   impedir que duas pessoas sobrescrevam a alteração uma da outra).
 * - Consentimento LGPD explícito: sem ele, o Tropi não envia lembretes de
 *   retorno nem campanhas (só mensagens do próprio atendimento).
 */
export interface ContactFormValues {
  id?: string;
  version?: number;
  name: string;
  phone: string;
  email: string;
  birthDate: string;
  sex?: string;
  cpf?: string;
  preferredChannel: Channel | "";
  source: string;
  tags: string;
  consentMarketing: boolean;
}

const EMPTY: ContactFormValues = { name: "", phone: "", email: "", birthDate: "", preferredChannel: "", source: "", tags: "", consentMarketing: false };

export function ContactForm({
  initial = EMPTY,
  onDone,
  idPrefix = "ct",
  onUseExisting,
  initialName,
  asPatient = false,
}: {
  initial?: ContactFormValues;
  onDone?: (contactId?: string, name?: string) => void;
  idPrefix?: string;
  /** Escolher um cadastro existente em vez de criar (ex.: dentro do agendamento) */
  onUseExisting?: (c: { id: string; name: string }) => void;
  /** Nome já digitado em outra busca (ex.: "Cadastrar Fulano" no agendamento) */
  initialName?: string;
  /** Cadastro feito na página Pacientes: já entra como paciente (não como lead) */
  asPatient?: boolean;
}) {
  const editing = !!initial.id;
  const [state, action] = useActionState(editing ? updateContactAction : createContactAction, {});
  // Mantém o que a pessoa digitou quando o servidor devolve erro
  const v = (k: keyof ContactFormValues) => (state.values?.[k] as string | undefined) ?? String((k === "name" && initialName) || initial[k] || "");

  // VERIFICAÇÃO DE DUPLICIDADE ao digitar nome, celular, e-mail e nascimento
  const [probe, setProbe] = useState<DuplicateProbe>({ name: v("name"), phone: v("phone"), email: v("email"), birthDate: v("birthDate") });
  const duplicates = useDuplicateCheck(probe, initial.id);
  const serverSawDuplicate = !state.ok && (state.data as { duplicate?: boolean } | undefined)?.duplicate;

  // Avisar o "pai" (fechar diálogo, navegar) é efeito colateral: fica fora da renderização.
  // useEffectEvent lê sempre o onDone mais recente sem refazer o efeito a cada render.
  const notifyDone = useEffectEvent((id?: string) => onDone?.(id, probe.name));
  useEffect(() => {
    if (state.ok) notifyDone((state.data as { contactId?: string } | undefined)?.contactId);
  }, [state]);

  return (
    <form
      action={action}
      className="space-y-4"
      onInput={(e) => {
        const f = e.currentTarget.elements;
        const val = (n: string) => (f.namedItem(n) as HTMLInputElement | null)?.value ?? "";
        setProbe({ name: val("name"), phone: val("phone"), email: val("email"), birthDate: val("birthDate") });
      }}
    >
      <FormMessage state={state} />
      {!editing && asPatient ? <input type="hidden" name="asPatient" value="1" /> : null}
      {editing ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version} />
        </>
      ) : null}
      <Field label="Nome completo" name="name" id={`${idPrefix}-name`} defaultValue={v("name")} error={state.errors?.name} required autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Celular (WhatsApp)"
          name="phone"
          id={`${idPrefix}-phone`}
          inputMode="tel"
          placeholder="(51) 99999-0000"
          defaultValue={v("phone")}
          error={state.errors?.phone}
          hint="Com DDD. Vira o contato do WhatsApp."
        />
        <Field label="E-mail" name="email" id={`${idPrefix}-email`} type="email" defaultValue={v("email")} error={state.errors?.email} />
        <Field label="Nascimento" name="birthDate" id={`${idPrefix}-birth`} type="date" defaultValue={v("birthDate")} error={state.errors?.birthDate} />
        <SelectField label="Sexo" name="sex" id={`${idPrefix}-sex`} defaultValue={v("sex")} hint="Usado no prontuário.">
          <option value="">Não informado</option>
          <option value="F">Feminino</option>
          <option value="M">Masculino</option>
        </SelectField>
        <Field label="CPF" name="cpf" id={`${idPrefix}-cpf`} inputMode="numeric" defaultValue={v("cpf")} error={state.errors?.cpf} hint="Opcional. Vai nos documentos clínicos (receita, atestado)." />
        <SelectField label="Canal preferido" name="preferredChannel" id={`${idPrefix}-channel`} defaultValue={v("preferredChannel")}>
          <option value="">Automático (último usado)</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </SelectField>
        <Field label="Como conheceu" name="source" id={`${idPrefix}-source`} placeholder="indicação, google, instagram..." defaultValue={v("source")} />
        <Field label="Etiquetas" name="tags" id={`${idPrefix}-tags`} placeholder="convênio, vip, ansioso" defaultValue={v("tags")} hint="Separe por vírgula." />
      </div>
      <DuplicateHint results={duplicates} onUse={onUseExisting ? (r) => onUseExisting({ id: r.id, name: r.name }) : undefined} />
      {!editing && (duplicates.length > 0 || serverSawDuplicate) ? (
        <CheckboxField
          name="allowDuplicate"
          label="É outra pessoa: cadastrar mesmo assim"
          hint="Ex.: mãe e filho com o mesmo celular. Se for a mesma pessoa, use o cadastro existente."
        />
      ) : null}
      <CheckboxField
        name="consentMarketing"
        defaultChecked={state.values ? state.values.consentMarketing === "on" : initial.consentMarketing}
        label="Autoriza mensagens de relacionamento (LGPD)"
        hint="Lembretes de retorno, pesquisas e novidades. Pode ser retirado a qualquer momento."
      />
      <SubmitButton pendingText="Salvando...">{editing ? "Salvar alterações" : "Cadastrar paciente"}</SubmitButton>
    </form>
  );
}

/** Botão "Novo paciente": abre o cadastro e, ao salvar, leva para a ficha. */
export function NewContactButton({ label = "Novo contato", asPatient = false }: { label?: string; asPatient?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [goTo, setGoTo] = useState<string | null>(null);
  useEffect(() => {
    if (goTo) router.push(`/crm/contatos/${goTo}`);
  }, [goTo, router]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles("primary")}>
        <UserPlus className="size-4" aria-hidden /> {label}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={asPatient ? "Cadastrar paciente" : "Novo contato"}
        description={asPatient ? "Entra direto na lista de Pacientes. Só o nome é obrigatório; o resto pode ser completado depois." : "Interessado ou paciente. Só o nome é obrigatório. O resto pode ser completado depois."}
      >
        <ContactForm
          idPrefix="new"
          asPatient={asPatient}
          onDone={(id) => {
            setOpen(false);
            if (id) setGoTo(id);
          }}
        />
      </Dialog>
    </>
  );
}
