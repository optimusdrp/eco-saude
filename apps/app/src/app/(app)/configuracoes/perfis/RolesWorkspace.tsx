"use client";

/**
 * ÁREA DE PERFIS
 *  - Lista de perfis à esquerda (sistema + cargos da clínica), editor à direita.
 *  - Editor: permissões agrupadas por área, com liga/desliga e "marcar todas".
 *    Nada é gravado até clicar em "Salvar perfil" (a barra avisa quando há
 *    alteração pendente; "Descartar" volta ao que está salvo).
 *  - "Novo perfil": a partir de um modelo pronto, copiando um perfil ou em branco.
 *  - "Comparar perfis": tabela com todos os perfis lado a lado.
 */
import {
  CLINIC_ROLE_LABEL,
  CLINIC_ROLES,
  CLINIC_PERMISSIONS,
  permissionsByCategory,
  type ClinicRole,
} from "@ecosaude/core/crm";
import {
  Check,
  Copy,
  Minus,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  Dialog,
  Field,
  FormMessage,
  SelectField,
  SubmitButton,
} from "@/components/ui";
import { cn, buttonStyles } from "@/components/ui/styles";
import {
  deleteRoleAction,
  saveRoleAction,
} from "@/modules/crm/actions/permissions";

export interface RoleView {
  id: string;
  name: string;
  description: string;
  base: ClinicRole;
  system: boolean;
  permissions: string[];
  people: { id: string; name: string; adjusted: boolean }[];
}

interface Preset {
  id: string;
  name: string;
  description: string;
  base: ClinicRole;
  permissions: string[];
}

const GROUPS = permissionsByCategory();
const TOTAL = CLINIC_PERMISSIONS.length;

export function RolesWorkspace({
  roles,
  presets,
  initialId,
  myId,
}: {
  roles: RoleView[];
  presets: Preset[];
  initialId: string | null;
  myId: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const [selectedId, setSelectedId] = useState(
    initialId && roles.some((r) => r.id === initialId)
      ? initialId
      : roles[0]?.id,
  );
  const [creating, setCreating] = useState(false);
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];

  const select = (id: string) => {
    setSelectedId(id);
    // O endereço guarda o perfil aberto (dá para mandar o link para alguém)
    router.replace(`${path}?perfil=${id}`, { scroll: false });
    if (window.matchMedia("(max-width: 79.99rem)").matches)
      document
        .getElementById("editor-perfil")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ------------------------------ Lista ------------------------------ */}
        <nav aria-label="Perfis" className="space-y-2 xl:sticky xl:top-4">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={buttonStyles("primary", "w-full")}
          >
            <Plus className="size-4" aria-hidden /> Novo perfil
          </button>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {roles.map((r) => {
              const on = r.id === selected?.id;
              const share = r.permissions.length / TOTAL;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => select(r.id)}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "block w-full rounded-2xl p-3 text-left ring-1 transition-colors",
                      on
                        ? "bg-night text-white ring-night"
                        : "bg-paper ring-line hover:ring-crm",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{r.name}</span>
                      {r.system ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
                            on ? "bg-white/15" : "bg-fog text-ink-soft",
                          )}
                        >
                          sistema
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-xs",
                        on ? "text-white/75" : "text-ink-soft",
                      )}
                    >
                      {r.people.length}{" "}
                      {r.people.length === 1 ? "pessoa" : "pessoas"},{" "}
                      {r.permissions.length} de {TOTAL} permissões
                    </span>
                    {/* Quanto do sistema este perfil alcança */}
                    <span
                      className={cn(
                        "mt-2 block h-1 overflow-hidden rounded-full",
                        on ? "bg-white/20" : "bg-fog",
                      )}
                      aria-hidden
                    >
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          on ? "bg-white" : "bg-crm",
                        )}
                        style={{ width: `${Math.max(3, share * 100)}%` }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ----------------------------- Editor ------------------------------ */}
        <div id="editor-perfil" className="min-w-0 scroll-mt-4">
          {selected ? (
            <RoleEditor
              key={selected.id}
              role={selected}
              roles={roles}
              myId={myId}
            />
          ) : null}
        </div>
      </div>

      <Compare roles={roles} />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Novo perfil"
        description="Comece de um modelo e ajuste depois. Nada muda para ninguém até você colocar pessoas nele."
        wide
      >
        {creating ? (
          <NewRoleForm
            presets={presets}
            roles={roles}
            onCreated={(id) => {
              setCreating(false);
              setSelectedId(id);
              router.replace(`${path}?perfil=${id}`, { scroll: false });
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/* --------------------------------- Editor ---------------------------------- */

function RoleEditor({
  role,
  roles,
  myId,
}: {
  role: RoleView;
  roles: RoleView[];
  myId: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState(saveRoleAction, {});
  const [perms, setPerms] = useState<Set<string>>(
    () => new Set(role.permissions),
  );
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [base, setBase] = useState<ClinicRole>(role.base);
  const [deleting, setDeleting] = useState(false);

  // Salvou (ou outra pessoa mudou): os dados novos do servidor viram a base do editor
  const signature = `${role.name}|${role.description}|${role.base}|${role.permissions.join(",")}`;
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setPerms(new Set(role.permissions));
    setName(role.name);
    setDescription(role.description);
    setBase(role.base);
  }

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const dirty =
    name !== role.name ||
    description !== role.description ||
    base !== role.base ||
    perms.size !== role.permissions.length ||
    role.permissions.some((p) => !perms.has(p));
  const reset = () => {
    setPerms(new Set(role.permissions));
    setName(role.name);
    setDescription(role.description);
    setBase(role.base);
  };
  const toggle = (key: string, on: boolean) =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const imIn = role.people.some((p) => p.id === myId);

  return (
    <>
      <form action={action} className="rounded-2xl bg-paper ring-1 ring-line">
        <input type="hidden" name="id" value={role.id} />
        <div className="space-y-4 p-4 sm:p-5">
          <FormMessage state={state} />
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
            <Field
              label="Nome do perfil"
              name="name"
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={state.errors?.name}
              maxLength={60}
            />
            {role.system ? (
              <div>
                <p className="text-sm font-semibold">Nível de referência</p>
                <p className="mt-1 flex min-h-10 items-center rounded-xl bg-fog px-3 text-sm text-ink-soft">
                  {CLINIC_ROLE_LABEL[role.base]} (fixo)
                </p>
                <input type="hidden" name="base" value={role.base} />
              </div>
            ) : (
              <SelectField
                label="Nível de referência"
                name="base"
                id="role-base"
                value={base}
                onChange={(e) => setBase(e.target.value as ClinicRole)}
              >
                {CLINIC_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {CLINIC_ROLE_LABEL[r]}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          <Field
            label="Para que serve"
            name="description"
            id="role-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={state.errors?.description}
            maxLength={200}
            hint="Aparece ao escolher o perfil de alguém."
          />

          {/* Quem usa este perfil */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Users className="size-4 text-ink-soft" aria-hidden />
            {role.people.length ? (
              role.people.map((p) => (
                <span
                  key={p.id}
                  className="rounded-full bg-fog px-2.5 py-0.5"
                  title={
                    p.adjusted ? "Tem ajuste individual em Equipe" : undefined
                  }
                >
                  {p.name}
                  {p.id === myId ? " (você)" : ""}
                  {p.adjusted ? " *" : ""}
                </span>
              ))
            ) : (
              <span className="text-ink-soft">
                Ninguém com este perfil ainda.
              </span>
            )}
          </div>
          {imIn ? (
            <p className="text-xs text-ink-soft">
              Você usa este perfil: o que mudar aqui vale para você também.
            </p>
          ) : null}
        </div>

        {/* Permissões por área */}
        <div className="border-t border-line">
          {GROUPS.map((g) => {
            const on = g.items.filter((i) => perms.has(i.key)).length;
            const all = on === g.items.length;
            return (
              <fieldset
                key={g.category}
                className="border-b border-line px-4 py-3 last:border-b-0 sm:px-5"
              >
                <legend className="sr-only">{g.label}</legend>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="font-semibold">
                    {g.label}{" "}
                    <span className="text-sm font-normal text-ink-soft tabular">
                      {on} de {g.items.length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => g.items.forEach((i) => toggle(i.key, !all))}
                    className="min-h-9 rounded-lg px-2 text-sm font-semibold text-crm hover:bg-crm-tint"
                  >
                    {all ? "Desmarcar todas" : "Marcar todas"}
                  </button>
                </div>
                <ul className="grid gap-x-6 md:grid-cols-2">
                  {g.items.map((i) => (
                    <li key={i.key}>
                      <Switch
                        name="perm"
                        value={i.key}
                        checked={perms.has(i.key)}
                        onChange={(v) => toggle(i.key, v)}
                        label={i.label}
                        hint={i.hint}
                        sensitive={"sensitive" in i && i.sensitive}
                      />
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
        </div>

        {/* Barra de salvar: fica visível ao rolar */}
        {/* Barra de salvar: fica visível ao rolar (ações à esquerda, longe do botão flutuante do simulador) */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:px-5">
          <SubmitButton disabled={!dirty} pendingText="Salvando...">
            Salvar perfil
          </SubmitButton>
          {dirty ? (
            <button
              type="button"
              onClick={reset}
              className={buttonStyles("ghost")}
            >
              Descartar
            </button>
          ) : null}
          <p
            className={cn(
              "text-sm",
              dirty ? "font-semibold text-erp-ink" : "text-ink-soft",
            )}
            role="status"
          >
            {dirty
              ? "Alterações não salvas"
              : `${perms.size} de ${TOTAL} permissões`}
          </p>
          {!role.system ? (
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className={buttonStyles(
                "ghost",
                "ml-auto text-alert hover:bg-alert-tint hover:text-alert",
              )}
            >
              <Trash2 className="size-4" aria-hidden /> Excluir perfil
            </button>
          ) : null}
        </div>
      </form>
      {/* Fora do formulário do editor (formulário dentro de formulário não é permitido) */}
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Excluir “${role.name}”`}
      >
        {deleting ? (
          <DeleteRole
            role={role}
            roles={roles}
            onDone={() => setDeleting(false)}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/** Liga/desliga acessível: é um checkbox de verdade (vai no formulário), com aparência de chave. */
function Switch({
  name,
  value,
  checked,
  onChange,
  label,
  hint,
  sensitive,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  sensitive?: boolean;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-ink/20 transition-colors peer-checked:bg-crm peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-crm after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          {label}
          {sensitive ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-erp-tint px-1.5 py-0.5 text-[0.68rem] font-semibold text-erp-ink">
              <ShieldAlert className="size-3" aria-hidden /> acesso amplo
            </span>
          ) : null}
        </span>
        <span className="block text-xs text-ink-soft">{hint}</span>
      </span>
    </label>
  );
}

/* ------------------------------- Novo perfil ------------------------------- */

function NewRoleForm({
  presets,
  roles,
  onCreated,
}: {
  presets: Preset[];
  roles: RoleView[];
  onCreated: (id: string) => void;
}) {
  const [state, action] = useActionState(saveRoleAction, {});
  const router = useRouter();
  const [source, setSource] = useState<string>(
    presets[0] ? `preset:${presets[0].id}` : "blank",
  );
  const preset = source.startsWith("preset:")
    ? presets.find((p) => `preset:${p.id}` === source)
    : undefined;
  const copy = source.startsWith("copy:")
    ? roles.find((r) => `copy:${r.id}` === source)
    : undefined;
  const [name, setName] = useState(preset?.name ?? "");
  const [touchedName, setTouchedName] = useState(false);

  // Sem nome digitado, o nome acompanha o modelo escolhido
  const pick = (value: string) => {
    setSource(value);
    if (!touchedName) {
      const p = presets.find((x) => `preset:${x.id}` === value);
      const r = roles.find((x) => `copy:${x.id}` === value);
      setName(p?.name ?? (r ? `${r.name} (cópia)` : ""));
    }
  };

  const created = state.ok ? (state.data?.id as string | undefined) : undefined;
  useEffect(() => {
    if (created) {
      router.refresh();
      onCreated(created);
    }
  }, [created, router, onCreated]);

  const count = preset?.permissions.length ?? copy?.permissions.length ?? 0;

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">
          Começar a partir de
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.map((p) => (
            <SourceOption
              key={p.id}
              value={`preset:${p.id}`}
              current={source}
              onPick={pick}
              title={p.name}
              text={p.description}
              meta={`${p.permissions.length} permissões`}
            />
          ))}
          <SourceOption
            value="blank"
            current={source}
            onPick={pick}
            title="Em branco"
            text="Nenhuma permissão marcada. Você escolhe uma a uma."
            meta="0 permissões"
          />
        </div>
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Copy className="size-4 text-ink-soft" aria-hidden />
          <span className="font-semibold">Ou copiar de</span>
          <select
            value={source.startsWith("copy:") ? source : ""}
            onChange={(e) => (e.target.value ? pick(e.target.value) : null)}
            className="min-h-10 min-w-0 flex-1 rounded-xl bg-paper px-2 ring-1 ring-line"
            aria-label="Copiar permissões de um perfil existente"
          >
            <option value="">um perfil existente...</option>
            {roles.map((r) => (
              <option key={r.id} value={`copy:${r.id}`}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {preset ? <input type="hidden" name="preset" value={preset.id} /> : null}
      {copy ? (
        <>
          <input type="hidden" name="copyFrom" value={copy.id} />
          <input type="hidden" name="base" value={copy.base} />
        </>
      ) : null}
      {!preset && !copy ? (
        <input type="hidden" name="base" value="recepcao" />
      ) : null}
      <Field
        label="Nome do perfil"
        name="name"
        id="nr-name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setTouchedName(true);
        }}
        error={state.errors?.name}
        maxLength={60}
      />
      <input type="hidden" name="description" value="" />
      <p className="text-sm text-ink-soft">
        Vai começar com <strong className="text-ink">{count} permissões</strong>
        . Depois de criar, ajuste o que quiser no editor.
      </p>
      <SubmitButton pendingText="Criando...">Criar perfil</SubmitButton>
    </form>
  );
}

function SourceOption({
  value,
  current,
  onPick,
  title,
  text,
  meta,
}: {
  value: string;
  current: string;
  onPick: (v: string) => void;
  title: string;
  text: string;
  meta: string;
}) {
  const on = value === current;
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col rounded-xl p-3 ring-1",
        on
          ? "bg-crm-tint ring-2 ring-crm"
          : "bg-paper ring-line hover:ring-crm",
      )}
    >
      <input
        type="radio"
        name="source"
        value={value}
        checked={on}
        onChange={() => onPick(value)}
        className="sr-only"
      />
      <span className="font-semibold">{title}</span>
      <span className="mt-0.5 flex-1 text-xs text-ink-soft">{text}</span>
      <span className="mt-1.5 text-xs font-semibold text-crm">{meta}</span>
    </label>
  );
}

/* --------------------------------- Excluir --------------------------------- */

function DeleteRole({
  role,
  roles,
  onDone,
}: {
  role: RoleView;
  roles: RoleView[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(deleteRoleAction, {});
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (state.ok) {
      onDone();
      router.replace(path);
      router.refresh();
    }
  }, [state, router, path, onDone]);
  const others = roles.filter((r) => r.id !== role.id);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={role.id} />
      {role.people.length ? (
        <SelectField
          label={`Para qual perfil vão as ${role.people.length} pessoas?`}
          name="moveTo"
          id="del-move"
          defaultValue={
            others.find((r) => r.base === role.base)?.id ?? others[0]?.id
          }
        >
          {others.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <p className="text-sm text-ink-soft">
          Ninguém usa este perfil. Ele será removido.
        </p>
      )}
      <SubmitButton variant="danger" pendingText="Excluindo...">
        Excluir perfil
      </SubmitButton>
    </form>
  );
}

/* --------------------------------- Comparar -------------------------------- */

function Compare({ roles }: { roles: RoleView[] }) {
  return (
    <details className="group mt-6 rounded-2xl bg-paper ring-1 ring-line">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold sm:px-5">
        Comparar perfis lado a lado
        <span className="text-sm font-normal text-ink-soft group-open:hidden">
          Abrir tabela
        </span>
      </summary>
      <div className="thin-scroll relative overflow-x-auto border-t border-line px-4 pb-4 sm:px-5">
        <table
          className="w-full text-sm"
          style={{ minWidth: `${16 + roles.length * 7}rem` }}
        >
          <thead>
            <tr className="text-xs text-ink-soft">
              <th
                scope="col"
                className="sticky left-0 bg-paper py-2 pr-2 text-left font-semibold"
              >
                Permissão
              </th>
              {roles.map((r) => (
                <th
                  key={r.id}
                  scope="col"
                  className="w-28 px-1 py-2 text-center align-bottom font-semibold"
                >
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((g) => (
            <tbody key={g.category} className="divide-y divide-line">
              <tr>
                <th
                  colSpan={roles.length + 1}
                  scope="colgroup"
                  className="sticky left-0 bg-paper pt-4 pb-1 text-left text-xs font-semibold text-crm"
                >
                  {g.label}
                </th>
              </tr>
              {g.items.map((i) => (
                <tr key={i.key}>
                  <th
                    scope="row"
                    className="sticky left-0 bg-paper py-1.5 pr-2 text-left font-normal"
                  >
                    {i.label}
                  </th>
                  {roles.map((r) => (
                    <td key={r.id} className="px-1 py-1.5 text-center">
                      {r.permissions.includes(i.key) ? (
                        <Check
                          className="mx-auto size-4 text-pep-ink"
                          aria-label="sim"
                        />
                      ) : (
                        <Minus
                          className="mx-auto size-4 text-ink/25"
                          aria-label="não"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </details>
  );
}
