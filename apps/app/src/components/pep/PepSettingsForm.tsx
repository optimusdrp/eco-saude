"use client";

import { ACCESS_MODE_LABEL, ACCESS_MODES, AREA_LABEL, CLINIC_AREAS, type ClinicArea } from "@ecosaude/core/pep";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { savePepSettingsAction } from "@/modules/pep/actions";

export function PepSettingsForm({ initial, emailReady }: { initial: { accessMode: string; headerNote: string; defaultReturnDays: string; emergencyEmail: boolean; areas: ClinicArea[] }; emailReady: boolean }) {
  const [state, action] = useActionState(savePepSettingsAction, {});
  const v = (k: Exclude<keyof typeof initial, "emergencyEmail" | "areas">) => state.values?.[k] ?? initial[k];
  return (
    <form action={action} className="space-y-5">
      {/* Áreas da clínica: definem os formulários prontos e as regras de cada profissão */}
      <fieldset>
        <legend className="font-semibold">Áreas em que a clínica atende</legend>
        <p className="mt-1 text-sm text-ink-soft">Cada área traz formulários prontos. O formulário de cada atendimento segue a especialidade do profissional (Ajustes &gt; Clínica).</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {CLINIC_AREAS.map((a) => (
            <label key={a} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 ring-1 ring-line has-[:checked]:bg-pep-tint has-[:checked]:ring-pep/40">
              <input type="checkbox" name="areas" value={a} defaultChecked={initial.areas.includes(a)} className="size-4 accent-[var(--color-pep)]" />
              <span className="text-sm font-semibold">{AREA_LABEL[a]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="font-semibold">Quem abre os prontuários</legend>
        <div className="mt-2 space-y-2">
          {ACCESS_MODES.map((m) => (
            <label key={m} className={cn("flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:bg-pep-tint has-[:checked]:ring-pep/40")}>
              <input type="radio" name="accessMode" value={m} defaultChecked={v("accessMode") === m} className="mt-1 size-4 accent-[var(--color-pep)]" />
              <span className="text-sm">
                <span className="block font-semibold">{m === "todos" ? "Todos os profissionais" : "Só quem atendeu"}</span>
                <span className="text-ink-soft">{ACCESS_MODE_LABEL[m]}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">Em qualquer caso, só perfis com a permissão &quot;Ler prontuários&quot; (Ajustes &gt; Perfis) abrem prontuários, e cada abertura é registrada.</p>
      </fieldset>
      <fieldset>
        <legend className="font-semibold">Aviso de acesso de emergência</legend>
        <p className="mt-1 text-sm text-ink-soft">Quem cuida da gestão do prontuário recebe o aviso no sino na hora: quem acessou, qual paciente e o motivo.</p>
        <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:bg-pep-tint has-[:checked]:ring-pep/40">
          <input type="checkbox" name="emergencyEmail" id="ps-email" defaultChecked={state.values ? state.values.emergencyEmail === "on" : initial.emergencyEmail} className="mt-1 size-4 accent-[var(--color-pep)]" />
          <span className="text-sm">
            <span className="block font-semibold">Avisar também por e-mail</span>
            <span className="text-ink-soft">O e-mail diz só que houve um acesso e traz o link. Nome do paciente e motivo ficam no Tropi (e-mail não é um canal seguro para dado de saúde).</span>
            {!emailReady ? <span className="mt-1 block font-semibold text-erp-ink">O envio de e-mail não está configurado neste servidor: por enquanto, só o sino funciona.</span> : null}
          </span>
        </label>
      </fieldset>
      <Field label="Linha extra no cabeçalho dos documentos" name="headerNote" id="ps-header" defaultValue={v("headerNote")} error={state.errors?.headerNote} hint="Endereço completo, CNES ou telefone. O nome, o CNPJ e a cidade vêm do cadastro da clínica." maxLength={200} />
      <Field label="Retorno sugerido (dias)" name="defaultReturnDays" id="ps-return" inputMode="numeric" defaultValue={v("defaultReturnDays")} error={state.errors?.defaultReturnDays} hint="Aparece como sugestão no campo de retorno. Vazio = sem sugestão." className="max-w-48" />
      <FormMessage state={state} />
      <SubmitButton>Salvar ajustes</SubmitButton>
    </form>
  );
}
