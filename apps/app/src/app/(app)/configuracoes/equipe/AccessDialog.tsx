"use client";

/**
 * ACESSO DE UMA PESSOA: perfil + ajuste fino.
 *
 * Cada chave mostra o que a pessoa PODE no final. Quando difere do perfil,
 * aparece "só para esta pessoa" e o botão para voltar ao que o perfil define.
 * O servidor grava apenas as diferenças (liberadas e bloqueadas): se o perfil
 * mudar depois, a pessoa acompanha, mantendo só os ajustes individuais.
 */
import { CLINIC_PERMISSIONS, permissionsByCategory } from "@ecosaude/core/crm";
import { RotateCcw, Search, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { FormMessage, SelectField, SubmitButton } from "@/components/ui";
import { cn } from "@/components/ui/styles";
import { setUserAccessAction } from "@/modules/crm/actions/permissions";

export interface AccessRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

const GROUPS = permissionsByCategory();
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function AccessForm({
  person,
  roles,
  onSaved,
}: {
  person: { id: string; name: string; roleId: string | null; grants: string[]; revokes: string[]; isMe: boolean };
  roles: AccessRole[];
  onSaved: () => void;
}) {
  const router = useRouter();
  const [state, action] = useActionState(setUserAccessAction, {});
  const [roleId, setRoleId] = useState(person.roleId ?? roles[0]?.id ?? "");
  // Ajustes individuais: permissão -> pode (true) ou não pode (false)
  const [overrides, setOverrides] = useState<Map<string, boolean>>(
    () => new Map([...person.grants.map((g) => [g, true] as const), ...person.revokes.map((r) => [r, false] as const)]),
  );
  const [q, setQ] = useState("");
  const [onlyAdjusted, setOnlyAdjusted] = useState(false);

  const role = roles.find((r) => r.id === roleId);
  const fromRole = new Set(role?.permissions ?? []);
  const can = (key: string) => overrides.get(key) ?? fromRole.has(key);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onSaved();
    }
  }, [state, router, onSaved]);

  const setPerm = (key: string, value: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      if (value === fromRole.has(key)) next.delete(key);
      else next.set(key, value);
      return next;
    });
  const changeRole = (id: string) => {
    setRoleId(id);
    // Ajustes que passaram a ser iguais ao novo perfil deixam de ser ajustes
    const perms = new Set(roles.find((r) => r.id === id)?.permissions ?? []);
    setOverrides((prev) => new Map([...prev].filter(([k, v]) => v !== perms.has(k))));
  };

  const total = CLINIC_PERMISSIONS.filter(can).length;
  const granted = [...overrides.values()].filter(Boolean).length;
  const revoked = overrides.size - granted;
  const term = plain(q.trim());

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={person.id} />
      {[...overrides].map(([k, v]) => (
        <input key={k} type="hidden" name={`access.${k}`} value={v ? "permitir" : "bloquear"} />
      ))}

      <div>
        <SelectField label="Perfil" name="roleId" id={`acc-role-${person.id}`} value={roleId} onChange={(e) => changeRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        {role?.description ? <p className="mt-1 text-xs text-ink-soft">{role.description}</p> : null}
      </div>

      <p className="rounded-xl bg-fog p-3 text-sm" role="status">
        <strong>{total}</strong> de {CLINIC_PERMISSIONS.length} permissões.{" "}
        {overrides.size ? (
          <>
            Só para {person.name.split(" ")[0]}: <strong>{granted} liberada{granted === 1 ? "" : "s"}</strong> e <strong>{revoked} bloqueada{revoked === 1 ? "" : "s"}</strong> além do perfil.
          </>
        ) : (
          "Igual ao perfil, sem ajustes individuais."
        )}
        {person.isMe ? " Cuidado: este é o seu acesso." : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar permissão" aria-label="Buscar permissão" className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm" />
        </div>
        <button
          type="button"
          aria-pressed={onlyAdjusted}
          onClick={() => setOnlyAdjusted((v) => !v)}
          className={cn("min-h-10 rounded-full px-3 text-sm font-semibold ring-1", onlyAdjusted ? "bg-ink text-white ring-ink" : "bg-paper text-ink-soft ring-line")}
        >
          Só ajustes ({overrides.size})
        </button>
      </div>

      {GROUPS.map((g) => {
        const items = g.items.filter((i) => (!onlyAdjusted || overrides.has(i.key)) && (!term || plain(`${i.label} ${i.hint}`).includes(term)));
        if (!items.length) return null;
        return (
          <section key={g.category} aria-label={g.label}>
            <h3 className="mb-1 text-sm font-semibold text-crm">{g.label}</h3>
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {items.map((i) => {
                const on = can(i.key);
                const adjusted = overrides.has(i.key);
                return (
                  <li key={i.key} className={cn("flex items-center gap-3 px-3 py-2", adjusted && "bg-erp-tint/50")}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input type="checkbox" checked={on} onChange={(e) => setPerm(i.key, e.target.checked)} className="peer sr-only" />
                      <span
                        aria-hidden
                        className="relative h-6 w-10 shrink-0 rounded-full bg-ink/20 transition-colors peer-checked:bg-crm peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-crm after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
                      />
                      <span className="min-w-0 text-sm">
                        <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                          {i.label}
                          {"sensitive" in i && i.sensitive ? <ShieldAlert className="size-3.5 text-erp-ink" aria-label="acesso amplo" /> : null}
                        </span>
                        <span className="block text-xs text-ink-soft">{adjusted ? (on ? "Liberada só para esta pessoa" : "Bloqueada só para esta pessoa") : `Como no perfil (${on ? "pode" : "não pode"})`}</span>
                      </span>
                    </label>
                    {adjusted ? (
                      <button type="button" onClick={() => setPerm(i.key, fromRole.has(i.key))} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-paper hover:text-ink" aria-label={`Voltar ao perfil: ${i.label}`} title="Voltar ao perfil">
                        <RotateCcw className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-2 border-t border-line bg-paper px-5 pt-3">
        {overrides.size ? (
          <button type="button" onClick={() => setOverrides(new Map())} className="min-h-10 rounded-lg px-2 text-sm font-semibold text-ink-soft hover:bg-fog">
            Tirar todos os ajustes
          </button>
        ) : null}
        <SubmitButton className="ml-auto" pendingText="Salvando...">
          Salvar acesso
        </SubmitButton>
      </div>
    </form>
  );
}
