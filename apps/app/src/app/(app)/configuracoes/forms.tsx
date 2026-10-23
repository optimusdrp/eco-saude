"use client";

import { BR_TIME_ZONES, suggestTimeZone, timeZoneLabel, type WeeklySchedule } from "@ecosaude/core/crm";
import { SPECIALTIES } from "@ecosaude/core/pep";
import { Copy, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useState } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles } from "@/components/ui/styles";
import type { ActionState } from "@/lib/server";
import {
  createClinicUserAction,
  deleteQuickReplyAction,
  resetClinicUserPasswordAction,
  resetClinicUserTwoFactorAction,
  saveQuickReplyAction,
  toggleClinicUserAction,
  updateClinicUserAction,
  updateClinicProfileAction,
} from "@/modules/crm/actions/settings";
import { saveCrmSettingsAction, saveProfessionalAction } from "@/modules/crm/actions/clinic";
import { WeekEditor, type WeekPlaces } from "./clinica/WeekEditor";

/** Formulários dos Ajustes (rodam no navegador e chamam server actions). */

function useRefreshOnOk(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
}

/* ----------------------------- Senha temporária ----------------------------- */

/** Mostra a senha temporária UMA vez, com botão de copiar. */
function TempPassword({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl bg-erp-tint p-3 text-sm">
      <p className="font-semibold">Senha temporária (aparece só agora):</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-paper px-3 py-2 text-base break-all ring-1 ring-line" data-testid="temp-password">
          {secret}
        </code>
        <button type="button" onClick={() => navigator.clipboard?.writeText(secret).then(() => setCopied(true))} className={buttonStyles("secondary")} aria-label="Copiar senha">
          <Copy className="size-4" aria-hidden /> {copied ? "Copiada" : "Copiar"}
        </button>
      </div>
      <p className="mt-1 text-xs">Entregue pessoalmente. No primeiro acesso a pessoa cria a própria senha.</p>
    </div>
  );
}

/* ------------------------------ Respostas rápidas ----------------------------- */

export interface QuickReplyValues {
  id?: string;
  shortcut: string;
  title: string;
  body: string;
  approvedTemplate: boolean;
}

export function QuickReplyButton({ initial, suggestionId, label }: { initial?: QuickReplyValues; /** Veio de uma sugestão (marca como aceita ao salvar) */ suggestionId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveQuickReplyAction, {});
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setOpen(false);
  }
  useRefreshOnOk(state);
  const p = initial?.id ?? suggestionId ?? "new";
  const val = (k: keyof QuickReplyValues) => state.values?.[k] ?? String(initial?.[k] ?? "");

  return (
    <>
      {suggestionId ? (
        <button type="button" onClick={() => setOpen(true)} className={buttonStyles("primary")}>
          <Plus className="size-4" aria-hidden /> {label ?? "Criar atalho"}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={buttonStyles(initial ? "ghost" : "primary")} aria-label={initial ? `Editar /${initial.shortcut}` : undefined}>
          {initial ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {initial ? "Editar" : "Nova resposta"}
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={suggestionId ? "Criar atalho a partir da sugestão" : initial ? `Editar /${initial.shortcut}` : "Nova resposta rápida"}
        description={suggestionId ? "Revise o texto: é assim que vai sair para o paciente." : "Na conversa, digite / e o atalho para inserir o texto."}
      >
        <form action={action} className="space-y-4">
          <FormMessage state={state} />
          {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
          {suggestionId ? <input type="hidden" name="suggestionId" value={suggestionId} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Atalho" name="shortcut" id={`qr-sc-${p}`} placeholder="horarios" defaultValue={val("shortcut")} error={state.errors?.shortcut} hint="Sem a barra. Ex.: horarios" />
            <Field label="Título" name="title" id={`qr-t-${p}`} placeholder="Horários de atendimento" defaultValue={val("title")} error={state.errors?.title} />
          </div>
          <TextareaField
            label="Texto"
            name="body"
            id={`qr-b-${p}`}
            rows={5}
            defaultValue={val("body")}
            error={state.errors?.body}
            hint="Variáveis: {{primeiro_nome}}, {{nome}}, {{clinica}}, {{data}}, {{hora}}, {{profissional}}."
          />
          <CheckboxField
            name="approvedTemplate"
            defaultChecked={state.values ? state.values.approvedTemplate === "on" : (initial?.approvedTemplate ?? false)}
            label="Modelo aprovado pela Meta"
            hint="Só modelos aprovados podem ser enviados no WhatsApp/Instagram/Messenger depois de 24h sem resposta do paciente."
          />
          <SubmitButton>Salvar</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

export function DeleteQuickReply({ id, shortcut }: { id: string; shortcut: string }) {
  const [state, action] = useActionState(deleteQuickReplyAction, {});
  useRefreshOnOk(state);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Excluir a resposta /${shortcut}?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" pendingText="...">
        Excluir
      </SubmitButton>
    </form>
  );
}

/* ----------------------------------- Equipe ----------------------------------- */

/** Perfil (cargo) que pode ser escolhido para alguém */
export interface RoleOption {
  id: string;
  name: string;
  description: string;
}

function RoleSelect({ id, roles, defaultValue, error }: { id: string; roles: RoleOption[]; defaultValue?: string; error?: string }) {
  const [value, setValue] = useState(defaultValue ?? roles[0]?.id ?? "");
  const chosen = roles.find((r) => r.id === value);
  return (
    <div>
      <SelectField label="Perfil" name="roleId" id={id} value={value} onChange={(e) => setValue(e.target.value)} error={error}>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      {chosen?.description ? <p className="mt-1 text-xs text-ink-soft">{chosen.description}</p> : null}
    </div>
  );
}

export function NewUserButton({ roles }: { roles: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  // Chave nova a cada abertura: o formulário (e a senha mostrada) começam do zero
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
        className={buttonStyles("primary")}
      >
        <Plus className="size-4" aria-hidden /> Novo acesso
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo acesso" description="A pessoa entra com o e-mail e a senha temporária e cria a própria senha.">
        <NewUserForm key={formKey} roles={roles} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function NewUserForm({ roles, onClose }: { roles: RoleOption[]; onClose: () => void }) {
  const [state, action] = useActionState(createClinicUserAction, {});
  useRefreshOnOk(state);
  if (state.ok && state.secret) {
    return (
      <div className="space-y-3">
        <FormMessage state={state} />
        <TempPassword secret={state.secret} />
        <button type="button" onClick={onClose} className={buttonStyles("secondary")}>
          Fechar
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Nome" name="name" id="nu-name" defaultValue={state.values?.name} error={state.errors?.name} />
      <Field label="E-mail" name="email" id="nu-email" type="email" defaultValue={state.values?.email} error={state.errors?.email} />
      <RoleSelect id="nu-role" roles={roles} defaultValue={state.values?.roleId ?? roles.find((r) => r.name === "Recepção")?.id} error={state.errors?.roleId} />
      <p className="text-xs text-ink-soft">O que cada perfil pode fazer está em Ajustes, Perfis e permissões.</p>
      <SubmitButton pendingText="Criando...">Criar acesso</SubmitButton>
    </form>
  );
}

export function UserActions({ id, name, active, roleId, roles, totpEnabled }: { id: string; name: string; active: boolean; roleId: string | null; roles: RoleOption[]; totpEnabled: boolean }) {
  const [reset, resetAction] = useActionState(resetClinicUserPasswordAction, {});
  const [toggle, toggleAction] = useActionState(toggleClinicUserAction, {});
  const [twoFactor, twoFactorAction] = useActionState(resetClinicUserTwoFactorAction, {});
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);
  useRefreshOnOk(toggle);
  useRefreshOnOk(twoFactor);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => {
            setEditKey((k) => k + 1);
            setEditOpen(true);
          }}
          className={buttonStyles("ghost")}
        >
          Editar
        </button>
        <form
          action={resetAction}
          onSubmit={(e) => {
            if (!window.confirm(`Gerar nova senha temporária para ${name}? A pessoa será desconectada.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="ghost" pendingText="...">
            Nova senha
          </SubmitButton>
        </form>
        {totpEnabled ? (
          <form
            action={twoFactorAction}
            onSubmit={(e) => {
              if (!window.confirm(`Desligar a verificação em duas etapas de ${name}? Use quando a pessoa perdeu o celular.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={id} />
            <SubmitButton variant="ghost" pendingText="...">
              Resetar 2 etapas
            </SubmitButton>
          </form>
        ) : null}
        <form action={toggleAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={String(!active)} />
          <SubmitButton variant={active ? "ghost" : "secondary"} pendingText="...">
            {active ? "Desativar" : "Reativar"}
          </SubmitButton>
        </form>
      </div>
      {reset.ok && reset.secret ? <TempPassword secret={reset.secret} /> : reset.message ? <FormMessage state={reset} /> : null}
      {toggle.message && !toggle.ok ? <FormMessage state={toggle} /> : null}
      {twoFactor.message ? <FormMessage state={twoFactor} /> : null}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title={`Editar ${name}`}>
        <EditUserForm key={editKey} id={id} name={name} roleId={roleId} roles={roles} onSaved={() => setEditOpen(false)} />
      </Dialog>
    </div>
  );
}

function EditUserForm({ id, name, roleId, roles, onSaved }: { id: string; name: string; roleId: string | null; roles: RoleOption[]; onSaved: () => void }) {
  const [state, action] = useActionState(updateClinicUserAction, {});
  useRefreshOnOk(state);
  const saved = useEffectEvent(onSaved);
  useEffect(() => {
    if (state.ok) saved();
  }, [state]);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <Field label="Nome" name="name" id={`eu-name-${id}`} defaultValue={state.values?.name ?? name} error={state.errors?.name} />
      <RoleSelect id={`eu-role-${id}`} roles={roles} defaultValue={state.values?.roleId ?? roleId ?? undefined} error={state.errors?.roleId} />
      <p className="text-xs text-ink-soft">O e-mail de login não muda: para trocar, crie um novo acesso e desative este.</p>
      <SubmitButton pendingText="Salvando...">Salvar</SubmitButton>
    </form>
  );
}

/* ------------------------------- Profissionais -------------------------------- */

export interface ProfessionalValues {
  id?: string;
  name: string;
  specialty: string;
  council?: string;
  councilNumber?: string;
  councilUf?: string;
  color: string;
  slotMinutes: number;
  /** Semana completa: períodos e duração por dia */
  weeklySchedule: WeeklySchedule;
  userId: string;
  active: boolean;
}

const NEW_PROFESSIONAL: ProfessionalValues = {
  name: "",
  specialty: "",
  color: "crm",
  slotMinutes: 30,
  weeklySchedule: Object.fromEntries(
    ["1", "2", "3", "4", "5"].map((d) => [
      d,
      {
        periods: [
          { start: "08:00", end: "12:00" },
          { start: "13:00", end: "18:00" },
        ],
      },
    ]),
  ),
  userId: "",
  active: true,
};

const COLORS: { id: string; label: string; dot: string }[] = [
  { id: "crm", label: "Roxo", dot: "bg-crm" },
  { id: "erp", label: "Amarelo", dot: "bg-erp" },
  { id: "pep", label: "Verde", dot: "bg-ok" },
  { id: "bi", label: "Azul", dot: "bg-bi" },
];

/**
 * Criar/editar profissional: expediente, intervalo, dias de atendimento e
 * duração da consulta. É isso que a agenda usa para mostrar horários livres.
 */
export function ProfessionalButton({ initial, users, places }: { initial?: ProfessionalValues; users: { id: string; name: string }[]; places?: WeekPlaces }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
        className={buttonStyles(initial ? "ghost" : "primary")}
        aria-label={initial ? `Editar ${initial.name}` : undefined}
      >
        {initial ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {initial ? "Editar" : "Novo profissional"}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={initial ? `Editar ${initial.name}` : "Novo profissional"}
        description="Os horários de cada dia definem os horários livres da agenda e da lista de espera."
        wide
      >
        <ProfessionalForm key={formKey} initial={initial ?? NEW_PROFESSIONAL} users={users} places={places} onSaved={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function ProfessionalForm({ initial, users, places, onSaved }: { initial: ProfessionalValues; users: { id: string; name: string }[]; places?: WeekPlaces; onSaved: () => void }) {
  const [state, action] = useActionState(saveProfessionalAction, {});
  useRefreshOnOk(state);
  // Mensagem de sucesso com aviso (consultas fora do novo horário): mantém aberto para a pessoa ler
  const done = state.ok && !state.message?.includes("Atenção");
  const notifySaved = useEffectEvent(onSaved);
  useEffect(() => {
    if (done) notifySaved();
  }, [done]);

  const p = initial.id ?? "new";
  const val = (k: keyof ProfessionalValues) => state.values?.[k] ?? String(initial[k] ?? "");
  // A semana e a duração ficam no estado do navegador: um erro do servidor não apaga o que foi montado
  const [week, setWeek] = useState<WeeklySchedule>(initial.weeklySchedule);
  const [slot, setSlot] = useState(initial.slotMinutes);

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" name="name" id={`pro-name-${p}`} placeholder="Dra. Ana Souza" defaultValue={val("name")} error={state.errors?.name} />
        {/* Lista do catálogo: com o nome reconhecido, o prontuário abre os formulários da especialidade */}
        <Field label="Especialidade" name="specialty" id={`pro-spec-${p}`} placeholder="Dermatologia" defaultValue={val("specialty")} list={`pro-spec-list-${p}`} hint="Escolha da lista para o prontuário abrir os formulários da especialidade." />
        <datalist id={`pro-spec-list-${p}`}>
          {SPECIALTIES.map((s) => (
            <option key={s.key} value={s.label} />
          ))}
        </datalist>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5rem] gap-3">
        <Field label="Conselho" name="council" id={`pro-council-${p}`} placeholder="CRM" defaultValue={val("council")} error={state.errors?.council} />
        <Field label="Nº do registro" name="councilNumber" id={`pro-cnum-${p}`} defaultValue={val("councilNumber")} error={state.errors?.councilNumber} />
        <Field label="UF" name="councilUf" id={`pro-cuf-${p}`} maxLength={2} defaultValue={val("councilUf")} error={state.errors?.councilUf} />
      </div>
      <p className="-mt-2 text-xs text-ink-soft">Vai na receita, no atestado e nos demais documentos do Prontuário (com o acesso ligado abaixo).</p>

      <WeekEditor value={week} onChange={setWeek} slotMinutes={slot} onSlotChange={setSlot} idPrefix={`pro-week-${p}`} places={places} />
      {state.errors?.weeklySchedule || state.errors?.slotMinutes ? <p className="text-sm font-semibold text-alert">{state.errors.weeklySchedule ?? state.errors.slotMinutes}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-semibold">Cor na agenda</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <label key={c.id} className="cursor-pointer">
                <input type="radio" name="color" value={c.id} defaultChecked={val("color") === c.id} className="peer sr-only" />
                <span className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-fog px-3 text-sm font-semibold ring-1 ring-line peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-crm">
                  <span className={`size-3 rounded-full ${c.dot}`} aria-hidden /> {c.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <SelectField label="Acesso ao sistema" name="userId" id={`pro-user-${p}`} defaultValue={val("userId")} hint="Liga o profissional ao login dele.">
          <option value="">Sem acesso ligado</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      </div>

      <CheckboxField
        name="active"
        defaultChecked={state.values ? state.values.active === "on" : initial.active}
        label="Atendendo"
        hint="Desmarque para tirar da agenda (exige não ter consultas futuras)."
      />
      <SubmitButton pendingText="Salvando...">Salvar profissional</SubmitButton>
    </form>
  );
}

/* ------------------------ Confirmação automática ----------------------------- */

export function CrmSettingsForm({ initial }: { initial: { autoConfirm: boolean; confirmHour: number; confirmDaysBefore: number } }) {
  const [state, action] = useActionState(saveCrmSettingsAction, {});
  useRefreshOnOk(state);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <CheckboxField
        name="autoConfirm"
        defaultChecked={initial.autoConfirm}
        label="Pedir confirmação automaticamente"
        hint="O paciente responde 1 para confirmar ou 2 para remarcar. Quem pediu SAIR não recebe."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Consultas de" name="confirmDaysBefore" id="cfg-days" defaultValue={String(initial.confirmDaysBefore)}>
          <option value="1">Amanhã</option>
          <option value="2">Em 2 dias</option>
          <option value="3">Em 3 dias</option>
        </SelectField>
        <SelectField label="Enviar a partir de" name="confirmHour" id="cfg-hour" defaultValue={String(initial.confirmHour)}>
          {Array.from({ length: 14 }, (_, i) => i + 7).map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </SelectField>
      </div>
      <SubmitButton variant="secondary" pendingText="Salvando...">
        Salvar preferências
      </SubmitButton>
    </form>
  );
}

/* ------------------------------ Dados da clínica ----------------------------- */

/**
 * Nome, telefone, e-mail e cidade da clínica (o nome entra nas mensagens como {{clinica}}).
 * Razão social e CNPJ só mudam pelo suporte (fazem parte do contrato).
 */
export function ClinicProfileForm({
  initial,
  legal,
}: {
  initial: { tradeName: string; phone: string; email: string; city: string; state: string; timeZone: string };
  legal: { legalName: string | null; cnpj: string | null };
}) {
  const [state, action] = useActionState(updateClinicProfileAction, {});
  useRefreshOnOk(state);
  const v = (k: keyof typeof initial) => state.values?.[k] ?? initial[k];
  // Fuso: controlado. Ao digitar a UF, sugere o fuso do estado (se a pessoa ainda não escolheu outro)
  const [tz, setTz] = useState(initial.timeZone);
  const [tzTouched, setTzTouched] = useState(false);
  const [keep, setKeep] = useState(true);
  const changed = tz !== initial.timeZone;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field
        label="Nome da clínica (como os pacientes conhecem)"
        name="tradeName"
        id="cl-name"
        defaultValue={v("tradeName")}
        error={state.errors?.tradeName}
        hint="Aparece nas mensagens automáticas."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Telefone" name="phone" id="cl-phone" inputMode="tel" defaultValue={v("phone")} error={state.errors?.phone} placeholder="(51) 3333-4444" />
        <Field label="E-mail" name="email" id="cl-email" type="email" defaultValue={v("email")} error={state.errors?.email} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]">
        <Field label="Cidade" name="city" id="cl-city" defaultValue={v("city")} error={state.errors?.city} />
        <Field
          label="UF"
          name="state"
          id="cl-state"
          maxLength={2}
          defaultValue={v("state")}
          error={state.errors?.state}
          placeholder="RS"
          onChange={(e) => {
            if (!tzTouched && e.target.value.trim().length === 2) setTz(suggestTimeZone(e.target.value));
          }}
        />
      </div>
      <SelectField
        label="Fuso horário"
        name="timeZone"
        id="cl-tz"
        value={tz}
        onChange={(e) => {
          setTz(e.target.value);
          setTzTouched(true);
        }}
        error={state.errors?.timeZone}
        hint="Agenda, horários livres, lembretes, aniversários e relatórios do dia seguem este horário."
      >
        {BR_TIME_ZONES.map((z) => (
          <option key={z.id} value={z.id}>
            {timeZoneLabel(z.id)}
          </option>
        ))}
      </SelectField>
      {changed ? (
        <div className="rounded-xl bg-erp-tint p-3 text-sm text-erp-ink">
          <p className="font-semibold">Você está trocando o fuso da clínica.</p>
          <CheckboxField
            name="keepWallClock"
            checked={keep}
            onChange={(e) => setKeep(e.target.checked)}
            label="Manter o horário das consultas já marcadas (recomendado)"
            hint={
              keep
                ? "Quem foi marcado para as 14:00 continua às 14:00, no novo fuso. Use quando a clínica sempre esteve neste fuso e o sistema usava o errado."
                : "As consultas mantêm o mesmo instante: o horário mostrado muda (ex.: 14:00 de Brasília aparece como 13:00 em Manaus)."
            }
          />
          <p className="text-xs">Lembretes já enviados não mudam. Horários de atendimento dos profissionais continuam iguais (09:00 é 09:00 no novo fuso).</p>
        </div>
      ) : null}
      <p className="rounded-xl bg-fog p-3 text-xs text-ink-soft">
        Razão social: <strong className="text-ink">{legal.legalName ?? "não informada"}</strong>. CNPJ: <strong className="text-ink">{legal.cnpj ?? "não informado"}</strong>. Para mudar estes dois,
        fale com o suporte.
      </p>
      <SubmitButton pendingText="Salvando...">Salvar dados</SubmitButton>
    </form>
  );
}
