"use client";

import { ROOM_KIND_LABEL, ROOM_KINDS, type RoomKind } from "@ecosaude/core/crm";
import { Pencil, Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles } from "@/components/ui/styles";
import { saveRoomAction, saveUnitAction, setMainUnitAction } from "@/modules/crm/actions/units";

/** Formulários de unidades e consultórios (diálogos). */

export interface UnitValues {
  id?: string;
  name: string;
  address: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  cnes: string;
  active: boolean;
  main: boolean;
}

export interface RoomValues {
  id?: string;
  unitId: string;
  name: string;
  kind: RoomKind;
  notes: string;
  active: boolean;
}

/** Fecha o diálogo e atualiza a tela quando a ação dá certo (ajuste durante a renderização) */
function useClosingState<T extends { ok?: boolean }>(state: T, close: () => void) {
  const router = useRouter();
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    if (state.ok) close();
  }
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
}

export function UnitButton({ initial }: { initial?: UnitValues }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => (setKey((k) => k + 1), setOpen(true))}
        className={buttonStyles(initial ? "ghost" : "primary", initial ? "min-h-9 px-2.5" : undefined)}
        aria-label={initial ? `Editar ${initial.name}` : undefined}
      >
        {initial ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {initial ? "Editar" : "Nova unidade"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={initial ? `Editar ${initial.name}` : "Nova unidade"} description="O endereço, o telefone e o CNES vão no cabeçalho de receitas e atestados emitidos aqui." wide>
        <UnitForm key={key} initial={initial} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function UnitForm({ initial, onDone }: { initial?: UnitValues; onDone: () => void }) {
  const [state, action] = useActionState(saveUnitAction, {});
  useClosingState(state, onDone);
  const v = (k: keyof UnitValues) => state.values?.[k] ?? String(initial?.[k] ?? "");
  const id = initial?.id ?? "nova";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-6">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Field label="Nome" name="name" id={`un-name-${id}`} required defaultValue={v("name")} error={state.errors?.name} placeholder="Unidade Centro" className="sm:col-span-4" />
      <Field label="CNES" name="cnes" id={`un-cnes-${id}`} inputMode="numeric" maxLength={7} defaultValue={v("cnes")} error={state.errors?.cnes} hint="7 números" className="sm:col-span-2" />
      <Field label="Endereço" name="address" id={`un-addr-${id}`} defaultValue={v("address")} error={state.errors?.address} placeholder="Rua, número, sala" className="sm:col-span-4" />
      <Field label="Bairro" name="district" id={`un-dist-${id}`} defaultValue={v("district")} className="sm:col-span-2" />
      <Field label="Cidade" name="city" id={`un-city-${id}`} defaultValue={v("city")} className="sm:col-span-3" />
      <Field label="UF" name="state" id={`un-uf-${id}`} maxLength={2} defaultValue={v("state")} error={state.errors?.state} className="sm:col-span-1" />
      <Field label="CEP" name="zip" id={`un-zip-${id}`} inputMode="numeric" defaultValue={v("zip")} error={state.errors?.zip} className="sm:col-span-2" />
      <Field label="Telefone" name="phone" id={`un-phone-${id}`} type="tel" defaultValue={v("phone")} className="sm:col-span-3" />
      <div className="sm:col-span-6">
        {initial?.main ? (
          <>
            <input type="hidden" name="active" value="on" />
            <p className="text-sm text-ink-soft">Unidade principal: sempre ativa.</p>
          </>
        ) : (
          <CheckboxField name="active" label="Em funcionamento" hint="Desmarque para fechar a unidade (exige não ter consultas futuras nela)." defaultChecked={state.values ? state.values.active === "on" : (initial?.active ?? true)} />
        )}
      </div>
      <div className="sm:col-span-6">
        <FormMessage state={state} />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-6">
        <SubmitButton pendingText="Salvando...">Salvar unidade</SubmitButton>
      </div>
    </form>
  );
}

export function MainUnitButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(setMainUnitAction, {});
  useClosingState(state, () => undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" className="min-h-9 px-2.5" pendingText="..." aria-label={`Tornar ${name} a unidade principal`}>
        <Star className="size-4" aria-hidden />
        Tornar principal
      </SubmitButton>
      {state.message && !state.ok ? <FormMessage state={state} /> : null}
    </form>
  );
}

export function RoomButton({ initial, units }: { initial: RoomValues; units: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const editing = !!initial.id;
  return (
    <>
      <button
        type="button"
        onClick={() => (setKey((k) => k + 1), setOpen(true))}
        className={editing ? "inline-flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left hover:text-crm" : buttonStyles("ghost", "min-h-9 px-2.5")}
        aria-label={editing ? `Editar ${initial.name}` : undefined}
      >
        {editing ? (
          <span className="min-w-0 truncate font-semibold">{initial.name}</span>
        ) : (
          <>
            <Plus className="size-4" aria-hidden />
            Consultório
          </>
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? `Editar ${initial.name}` : "Novo consultório"}>
        <RoomForm key={key} initial={initial} units={units} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function RoomForm({ initial, units, onDone }: { initial: RoomValues; units: { id: string; name: string }[]; onDone: () => void }) {
  const [state, action] = useActionState(saveRoomAction, {});
  useClosingState(state, onDone);
  const v = (k: keyof RoomValues) => state.values?.[k] ?? String(initial[k] ?? "");
  const id = initial.id ?? `novo-${initial.unitId}`;
  return (
    <form action={action} className="space-y-3">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {units.length > 1 && !initial.id ? (
        <SelectField label="Unidade" name="unitId" id={`rm-unit-${id}`} defaultValue={v("unitId")}>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <input type="hidden" name="unitId" value={initial.unitId} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" name="name" id={`rm-name-${id}`} required defaultValue={v("name")} error={state.errors?.name} placeholder="Consultório 1" />
        <SelectField label="Tipo" name="kind" id={`rm-kind-${id}`} defaultValue={v("kind")} hint="Triagem e outras salas não recebem consultas sozinhas.">
          {ROOM_KINDS.map((k) => (
            <option key={k} value={k}>
              {ROOM_KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
      </div>
      <TextareaField label="Observações" name="notes" id={`rm-notes-${id}`} rows={2} defaultValue={v("notes")} placeholder="Ex.: tem cadeira odontológica, acessível para cadeirantes" />
      {initial.id ? (
        <CheckboxField name="active" label="Em uso" hint="Desmarque para tirar das agendas (exige não ter consultas futuras nele)." defaultChecked={state.values ? state.values.active === "on" : initial.active} />
      ) : (
        <input type="hidden" name="active" value="on" />
      )}
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton pendingText="Salvando...">Salvar consultório</SubmitButton>
      </div>
    </form>
  );
}
