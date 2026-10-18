"use client";

/**
 * DIRETÓRIO DA EQUIPE: busca por nome/e-mail, filtro por perfil e por situação
 * (pendências de segurança, desativados). As ações de cada pessoa (perfil,
 * senha temporária, 2 etapas, desativar) continuam em UserActions.
 */
import type { ClinicRole } from "@ecosaude/core/crm";
import { KeyRound, Search } from "lucide-react";
import { useCallback, useState } from "react";
import { Dialog } from "@/components/ui";
import { Avatar, Badge } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { UserActions } from "../forms";
import { AccessForm, type AccessRole } from "./AccessDialog";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  /** Nível de referência (gestão, recepção, profissional) */
  role: ClinicRole;
  roleId: string | null;
  roleName: string;
  grants: string[];
  revokes: string[];
  permissionCount: number;
  active: boolean;
  temp: boolean;
  totp: boolean;
  locked: boolean;
  lastLogin: string;
  isMe: boolean;
  /** Algo a resolver: sem 2 etapas, senha temporária ou bloqueado */
  attention: boolean;
}

type Status = "" | "atencao" | "desativados";
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function TeamDirectory({ members, roles, canAccess }: { members: TeamMember[]; roles: AccessRole[]; canAccess: boolean }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const closeAccess = useCallback(() => setEditing(null), []);
  const [status, setStatus] = useState<Status>("");
  const term = plain(q.trim());

  const shown = members.filter(
    (m) =>
      (!term || plain(`${m.name} ${m.email}`).includes(term)) &&
      (!role || m.roleId === role) &&
      (status === "desativados" ? !m.active : status === "atencao" ? m.active && m.attention : m.active),
  );
  const inactive = members.filter((m) => !m.active).length;
  const attention = members.filter((m) => m.active && m.attention).length;

  return (
    <section aria-labelledby="pessoas-t">
      <h2 id="pessoas-t" className="sr-only">
        Pessoas
      </h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <label htmlFor="equipe-q" className="sr-only">
            Buscar pessoa
          </label>
          <input id="equipe-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail" className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm" />
        </div>
        <select aria-label="Perfil" value={role} onChange={(e) => setRole(e.target.value)} className="min-h-10 max-w-56 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
          <option value="">Todos os perfis</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div role="group" aria-label="Situação" className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={status === ""} onClick={() => setStatus("")}>
          Ativos
        </Chip>
        <Chip on={status === "atencao"} onClick={() => setStatus("atencao")}>
          Precisam de atenção <span className="tabular opacity-70">{attention}</span>
        </Chip>
        <Chip on={status === "desativados"} onClick={() => setStatus("desativados")}>
          Desativados <span className="tabular opacity-70">{inactive}</span>
        </Chip>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">Ninguém com estes filtros.</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {shown.map((u) => (
            <li key={u.id} className={cn("rounded-2xl bg-paper p-4 ring-1 ring-line", !u.active && "opacity-70")}>
              <div className="flex items-start gap-3">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {u.name} {u.isMe ? <span className="text-sm font-normal text-ink-soft">(você)</span> : null}
                  </p>
                  <p className="truncate text-sm text-ink-soft">{u.email}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone="crm">{u.roleName}</Badge>
                    {u.grants.length + u.revokes.length ? (
                      <Badge tone="dark" className="tabular">
                        ajuste individual {u.grants.length ? `+${u.grants.length}` : ""} {u.revokes.length ? `−${u.revokes.length}` : ""}
                      </Badge>
                    ) : null}
                    {!u.active ? <Badge tone="alert">desativado</Badge> : null}
                    {u.temp ? <Badge tone="warning">senha temporária</Badge> : null}
                    {u.totp ? <Badge tone="success">2 etapas</Badge> : u.active ? <Badge tone={u.role === "gestor" ? "alert" : "warning"}>sem 2 etapas</Badge> : null}
                    {u.locked ? <Badge tone="alert">bloqueado por tentativas</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {u.lastLogin}. {u.permissionCount} permissões.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-start gap-1 border-t border-line pt-2">
                {canAccess ? (
                  <button type="button" onClick={() => setEditing(u)} className={buttonStyles("ghost")}>
                    <KeyRound className="size-4" aria-hidden /> Acesso
                  </button>
                ) : null}
                {!u.isMe ? (
                  <div className="min-w-0 flex-1">
                    <UserActions id={u.id} name={u.name} active={u.active} roleId={u.roleId} roles={roles} totpEnabled={u.totp} />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onClose={closeAccess} title={editing ? `Acesso de ${editing.name}` : "Acesso"} description="Escolha o perfil e, se precisar, libere ou bloqueie algo só para esta pessoa." wide>
        {editing ? <AccessForm key={editing.id} person={{ id: editing.id, name: editing.name, roleId: editing.roleId, grants: editing.grants, revokes: editing.revokes, isMe: editing.isMe }} roles={roles} onSaved={closeAccess} /> : null}
      </Dialog>
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold ring-1", on ? "bg-ink text-white ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink")}>
      {children}
    </button>
  );
}
