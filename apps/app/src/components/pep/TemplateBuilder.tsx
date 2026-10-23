"use client";

import { FIELD_TYPE_LABEL, FIELD_TYPES, SPECIALTIES, TEMPLATE_KIND_LABEL, type FieldType, type TemplateField, type TemplateKind } from "@ecosaude/core/pep";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { saveTemplateAction } from "@/modules/pep/actions";

/**
 * EDITOR DE MODELO (anamnese / evolução)
 * Lista de campos com tipo, obrigatório e opções. O identificador interno é gerado do nome
 * (e não muda depois de salvo: as respostas antigas ficam guardadas por ele).
 */
export interface TemplateValues {
  id: string | null;
  specialty: string;
  name: string;
  /** Primeira consulta, retorno ou outro: o Tropi usa para abrir o formulário certo */
  kind: TemplateKind | "";
  fields: TemplateField[];
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .slice(0, 40) || "campo";

export function TemplateBuilder({ initial, specialties, trigger }: { initial: TemplateValues; specialties: string[]; trigger: "novo" | "editar" }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  // Campos que já existiam: o identificador fica fixo
  const savedIds = new Set(initial.fields.map((f) => f.id));

  const update = (i: number, patch: Partial<TemplateField>) => setV({ ...v, fields: v.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, d: -1 | 1) => {
    const f = [...v.fields];
    const [x] = f.splice(i, 1);
    f.splice(i + d, 0, x!);
    setV({ ...v, fields: f });
  };
  const add = () => {
    const n = v.fields.length + 1;
    setV({ ...v, fields: [...v.fields, { id: uniqueId(`campo_${n}`, v.fields), label: "", type: "texto_longo" }] });
  };

  const save = () =>
    start(async () => {
      const fields = v.fields.map((f) => ({
        ...f,
        id: savedIds.has(f.id) ? f.id : uniqueId(slug(f.label || f.id), v.fields.filter((x) => x !== f)),
        options: f.type === "escolha" || f.type === "multipla" ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined,
        unit: f.unit?.trim() || undefined,
        hint: f.hint?.trim() || undefined,
        required: f.type === "titulo" ? undefined : f.required || undefined,
      }));
      const r = await saveTemplateAction({ ...v, fields });
      setMsg(r);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      {trigger === "novo" ? (
        <button type="button" onClick={() => (setV(initial), setMsg({}), setOpen(true))} className={buttonStyles("primary", "bg-pep hover:bg-pep-ink")}>
          <Plus className="size-4" aria-hidden />
          Novo modelo
        </button>
      ) : (
        <button type="button" onClick={() => (setV(initial), setMsg({}), setOpen(true))} className={buttonStyles("ghost", "min-h-9 px-2.5")} aria-label={`Editar ${initial.name}`}>
          <Pencil className="size-4" aria-hidden />
          Editar
        </button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={initial.id ? `Editar: ${initial.name}` : "Novo modelo"} description="Atendimentos já registrados guardam a versão antiga do modelo: editar não muda o passado." wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Especialidade" name="specialty" id="tb-sp" list="tb-specialties" value={v.specialty} onChange={(e) => setV({ ...v, specialty: e.target.value })} placeholder="Ex.: Nutrição clínica" hint="Use o nome da lista para o Tropi ligar ao profissional." />
            <datalist id="tb-specialties">
              {[...new Set([...specialties, ...SPECIALTIES.map((s) => s.label)])].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Field label="Nome do modelo" name="name" id="tb-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ex.: Primeira consulta" />
            <SelectField label="Usado em" name="kind" id="tb-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as TemplateKind | "" })}>
              <option value="">Só quando escolhido</option>
              {(Object.keys(TEMPLATE_KIND_LABEL) as TemplateKind[]).map((k) => (
                <option key={k} value={k}>
                  {TEMPLATE_KIND_LABEL[k]}
                </option>
              ))}
            </SelectField>
          </div>

          <ol className="space-y-2">
            {v.fields.map((f, i) => (
              <li key={i} className={cn("rounded-xl p-3", f.type === "titulo" ? "bg-pep-tint/60" : "bg-fog")}>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
                  <Field label={f.type === "titulo" ? "Título da seção" : `Campo ${i + 1}`} name={`lb-${i}`} id={`lb-${i}`} value={f.label} onChange={(e) => update(i, { label: e.target.value })} />
                  <SelectField label="Tipo" name={`tp-${i}`} id={`tp-${i}`} value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldType })}>
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {FIELD_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </SelectField>
                  <div className="flex items-end gap-1">
                    <IconButton label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton label="Descer" disabled={i === v.fields.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton label={`Remover ${f.label || `campo ${i + 1}`}`} danger onClick={() => setV({ ...v, fields: v.fields.filter((_, j) => j !== i) })}>
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  </div>
                </div>
                {f.type === "escolha" || f.type === "multipla" ? (
                  <Field className="mt-2" label="Opções (separe por vírgula)" name={`op-${i}`} id={`op-${i}`} value={(f.options ?? []).join(", ")} onChange={(e) => update(i, { options: e.target.value.split(",").map((o) => o.trimStart()) })} />
                ) : null}
                {f.type !== "titulo" ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-4">
                    <CheckboxField label="Obrigatório para finalizar" checked={!!f.required} onChange={(e) => update(i, { required: e.target.checked })} />
                    {f.type === "numero" ? <Field label="Unidade" name={`un-${i}`} id={`un-${i}`} value={f.unit ?? ""} onChange={(e) => update(i, { unit: e.target.value })} className="w-28" /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <button type="button" onClick={add} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-pep hover:bg-pep-tint">
            <Plus className="size-4" aria-hidden />
            Campo
          </button>

          <FormMessage state={msg} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Cancelar
            </button>
            <button type="button" onClick={save} disabled={pending} aria-busy={pending} className={buttonStyles("primary", "bg-pep hover:bg-pep-ink")}>
              {pending ? "Salvando..." : "Salvar modelo"}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function uniqueId(base: string, others: TemplateField[]) {
  const taken = new Set(others.map((f) => f.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 36)}_${n}`;
  return id;
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cn("inline-flex size-11 items-center justify-center rounded-xl text-ink-soft disabled:opacity-30 sm:size-10", danger ? "hover:bg-alert-tint hover:text-alert" : "hover:bg-ink/5 hover:text-ink")}>
      {children}
    </button>
  );
}
