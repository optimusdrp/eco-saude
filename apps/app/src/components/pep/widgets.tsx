"use client";

import { Ban, FileDown, MessageSquarePlus, Play, Replace, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles, cn, type Variant } from "@/components/ui/styles";
import { addAddendumAction, changeTemplateAction, createPatientAction, toggleTemplateAction, discardDraftAction, emergencyAccessAction, exportRecordAction, revokeDocumentAction, startEncounterAction } from "@/modules/pep/actions";

/**
 * Peças interativas pequenas do Prontuário (as telas são do servidor; estas
 * são as partes que precisam do navegador).
 */

/** Botão "Iniciar atendimento": cria o atendimento (ou reabre o da mesma consulta) e abre a tela */
export function StartEncounterButton({
  contactId,
  appointmentId,
  templates,
  label = "Iniciar atendimento",
  variant = "primary",
  className,
}: {
  contactId: string;
  appointmentId?: string | null;
  /** Com lista: deixa escolher o modelo. Sem lista: o Tropi escolhe (primeira consulta ou retorno). */
  templates?: { id: string; name: string; specialty: string }[];
  label?: string;
  variant?: Variant;
  className?: string;
}) {
  const [state, action] = useActionState(startEncounterAction, {});
  return (
    <form action={action} className={cn("flex flex-col gap-2", className)}>
      <input type="hidden" name="contactId" value={contactId} />
      {appointmentId ? <input type="hidden" name="appointmentId" value={appointmentId} /> : null}
      {templates?.length ? (
        <SelectField label="Modelo" name="templateId" id={`tpl-${contactId}`} defaultValue="">
          <option value="">Automático (sua especialidade: primeira consulta ou retorno)</option>
          {[...new Set(templates.map((t) => t.specialty))].map((sp) => (
            <optgroup key={sp} label={sp}>
              {templates.filter((t) => t.specialty === sp).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
      ) : null}
      <SubmitButton variant={variant} pendingText="Abrindo..." className={variant === "primary" ? "bg-pep hover:bg-pep-ink" : undefined}>
        <Play className="size-4" aria-hidden />
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** Cadastro rápido de paciente pelo Prontuário */
export function NewPatientButton({ initialName = "" }: { initialName?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createPatientAction, {});
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  const dup = !state.ok && (state.data as { duplicate?: boolean } | undefined)?.duplicate;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles("secondary")}>
        <UserPlus className="size-4" aria-hidden />
        Cadastrar paciente
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Cadastrar paciente" description="Dados para identificar o prontuário e os documentos.">
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome completo" name="name" id="np-name" required defaultValue={v("name", initialName)} error={state.errors?.name} className="sm:col-span-2" autoComplete="off" />
          <Field label="Nascimento" name="birthDate" id="np-birth" type="date" defaultValue={v("birthDate")} error={state.errors?.birthDate} />
          <SelectField label="Sexo" name="sex" id="np-sex" defaultValue={v("sex")} error={state.errors?.sex}>
            <option value="">Não informado</option>
            <option value="F">Feminino</option>
            <option value="M">Masculino</option>
          </SelectField>
          <Field label="CPF" name="cpf" id="np-cpf" inputMode="numeric" defaultValue={v("cpf")} error={state.errors?.cpf} hint="Opcional. Vai na receita e no atestado." />
          <Field label="Celular" name="phone" id="np-phone" type="tel" inputMode="tel" defaultValue={v("phone")} error={state.errors?.phone} />
          <Field label="E-mail" name="email" id="np-email" type="email" defaultValue={v("email")} error={state.errors?.email} className="sm:col-span-2" />
          {dup ? <CheckboxField name="allowDuplicate" label="É outra pessoa, cadastrar mesmo assim" className="sm:col-span-2" /> : null}
          <div className="sm:col-span-2">
            <FormMessage state={state} />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Cancelar
            </button>
            <SubmitButton>Cadastrar e abrir prontuário</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Pedido de acesso de emergência (sigilo "só quem atendeu") */
export function EmergencyAccessForm({ contactId }: { contactId: string }) {
  const [state, action] = useActionState(emergencyAccessAction, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="contactId" value={contactId} />
      <TextareaField
        label="Por que você precisa abrir este prontuário agora?"
        name="reason"
        id="em-reason"
        required
        minLength={10}
        defaultValue={state.values?.reason}
        error={state.errors?.reason}
        hint="Ex.: paciente chegou com dor no peito e o médico dele não está. Fica registrado com seu nome e a gestão é avisada."
      />
      <FormMessage state={state} />
      <SubmitButton variant="danger" pendingText="Registrando...">
        <ShieldAlert className="size-4" aria-hidden />
        Abrir com acesso de emergência
      </SubmitButton>
    </form>
  );
}

/** Cópia integral do prontuário (pedido do paciente): registra o pedido e baixa o PDF */
export function ExportRecordButton({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(exportRecordAction, {});
  const url = (state.data as { url?: string } | undefined)?.url;
  // Pedido registrado: fecha o diálogo (ajuste durante a renderização) e baixa o PDF
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    if (state.ok) setOpen(false);
  }
  useEffect(() => {
    if (state.ok && url) window.location.href = url;
  }, [state, url]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles("ghost")}>
        <FileDown className="size-4" aria-hidden />
        Cópia do prontuário
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Entregar cópia do prontuário" description="Direito do paciente (LGPD art. 18 e Código de Ética Médica). O PDF reúne os atendimentos finalizados e os documentos emitidos.">
        <form action={action} className="space-y-3">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="Pedido" name="reason" id="exp-reason" required error={state.errors?.reason} hint='Quem pediu e quando. Ex.: "paciente, presencial, 21/10".' />
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Cancelar
            </button>
            <SubmitButton pendingText="Gerando...">Registrar e baixar PDF</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Adendo: a única forma de complementar ou corrigir um atendimento finalizado */
export function AddendumForm({ encounterId }: { encounterId: string }) {
  const [state, action] = useActionState(addAddendumAction, {});
  // Adendo registrado: formulário novo (limpo)
  const [key, setKey] = useState(0);
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    if (state.ok) setKey((k) => k + 1);
  }
  return (
    <form key={key} action={action} className="space-y-3">
      <input type="hidden" name="id" value={encounterId} />
      <TextareaField label="Novo adendo" name="text" id="ad-text" required rows={3} error={state.errors?.text} hint="Fica junto do atendimento, com seu nome, data e hora. O texto original não muda." />
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Registrando...">
        <MessageSquarePlus className="size-4" aria-hidden />
        Registrar adendo
      </SubmitButton>
    </form>
  );
}

/** Cancelar documento emitido por engano (a verificação pública passa a mostrar "cancelado") */
export function RevokeDocumentButton({ documentId, label }: { documentId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(revokeDocumentAction, {});
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    if (state.ok) setOpen(false);
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Cancelar ${label}`} className="inline-flex size-10 items-center justify-center rounded-xl text-ink-soft hover:bg-alert-tint hover:text-alert">
        <Ban className="size-4" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Cancelar ${label.toLowerCase()}?`} description="O documento continua no histórico, marcado como cancelado. Quem conferir o código verá que ele não vale.">
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={documentId} />
          <Field label="Motivo" name="reason" id={`rv-${documentId}`} required error={state.errors?.reason} placeholder="Ex.: dose errada, emitido de novo" />
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Voltar
            </button>
            <SubmitButton variant="danger" pendingText="Cancelando...">
              Cancelar documento
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Descartar rascunho (só sem documentos emitidos) */
export function DiscardDraftButton({ encounterId }: { encounterId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(discardDraftAction, {});
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles("ghost", "w-full text-ink-soft")}>
        <Trash2 className="size-4" aria-hidden />
        Descartar rascunho
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Descartar este atendimento?" description="O rascunho é apagado. Use quando o atendimento foi aberto por engano.">
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={encounterId} />
          <FormMessage state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Voltar
            </button>
            <SubmitButton variant="danger" pendingText="Descartando...">
              Descartar
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * "Trocar formulário" do atendimento em rascunho. As respostas de campos iguais nos dois
 * formulários continuam; as demais saem (o aviso diz isso antes de confirmar).
 */
export function ChangeTemplateButton({ encounterId, current, templates }: { encounterId: string; current: string | null; templates: { id: string; name: string; specialty: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const specialties = [...new Set(templates.map((t) => t.specialty))];
  function apply() {
    if (!choice) return;
    start(async () => {
      const r = await changeTemplateAction(encounterId, choice);
      if (!r.ok) return setMessage(r.message ?? "Não foi possível trocar.");
      setOpen(false);
      router.refresh();
    });
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles("ghost", "min-h-10 px-3 text-sm")}>
        <Replace className="size-4" aria-hidden />
        Trocar formulário
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Trocar o formulário deste atendimento" description="Respostas de campos que existem nos dois formulários continuam. As demais são descartadas.">
        <div className="space-y-3">
          <SelectField label="Formulário" name="templateId" id={`chg-${encounterId}`} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="" disabled>
              Escolha
            </option>
            {specialties.map((sp) => (
              <optgroup key={sp} label={sp}>
                {templates
                  .filter((t) => t.specialty === sp)
                  .map((t) => (
                    <option key={t.id} value={t.id} disabled={t.id === current}>
                      {t.name}
                      {t.id === current ? " (atual)" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </SelectField>
          {message ? (
            <p role="alert" className="text-sm font-semibold text-alert">
              {message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Voltar
            </button>
            <button type="button" onClick={apply} disabled={!choice || pending} className={buttonStyles("primary", "bg-pep hover:bg-pep-ink")}>
              {pending ? "Trocando..." : "Trocar formulário"}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Ativar/desativar modelo (desativado some da lista de novos atendimentos; os antigos não mudam) */
export function ToggleTemplateButton({ id, active }: { id: string; active: boolean }) {
  const [state, action] = useActionState(toggleTemplateAction, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <SubmitButton variant="ghost" className="min-h-9 px-2.5" pendingText="...">
        {active ? "Desativar" : "Ativar"}
      </SubmitButton>
      {state.message && !state.ok ? <FormMessage state={state} /> : null}
    </form>
  );
}
