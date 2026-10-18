import { STAFF_ROLE_LABEL } from "@ecosaude/core";
import { db, desc, eq, schema } from "@ecosaude/db";
import type { Metadata } from "next";
import { DataList, PageHeader, Panel } from "@/components/ui/server";
import { requireUser } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { ChangePasswordForm } from "../../(auth)/forms";
import { TwoFactorPanel } from "./TwoFactorPanel";

export const metadata: Metadata = { title: "Minha conta" };
export const dynamic = "force-dynamic";

/** Minha conta: dados, verificação em duas etapas (opcional), troca de senha e sessões abertas. */
export default async function AccountPage() {
  const user = await requireUser();
  const sessions = await db.query.sessions.findMany({
    where: eq(schema.sessions.userId, user.id),
    orderBy: desc(schema.sessions.createdAt),
    columns: { id: true, createdAt: true, expiresAt: true, ip: true, userAgent: true },
  });

  return (
    <>
      <PageHeader title="Minha conta" />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Dados">
            <DataList
              items={[
                ["Nome", user.name],
                ["E-mail", user.email],
                ["Perfil", STAFF_ROLE_LABEL[user.role]],
                ["Verificação em duas etapas", user.totpEnabled ? "Ativa" : "Desativada"],
              ]}
            />
          </Panel>
          <Panel
            title="Verificação em duas etapas"
            description="Opcional. Protege a conta mesmo que alguém descubra a sua senha."
          >
            <TwoFactorPanel enabled={user.totpEnabled} />
          </Panel>
          <Panel title="Trocar senha" description="As outras sessões abertas serão encerradas.">
            <ChangePasswordForm from="conta" />
          </Panel>
        </div>
        <Panel title="Sessões abertas" description="Navegadores conectados com a sua conta.">
          <ul className="divide-y divide-line text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="py-2.5">
                <p className="font-semibold">
                  {s.id === user.sessionId ? "Esta sessão" : "Outra sessão"}
                  {s.ip ? `, IP ${s.ip}` : ""}
                </p>
                <p className="break-words text-ink-soft">{s.userAgent ?? "Navegador desconhecido"}</p>
                <p className="text-xs text-ink-soft">
                  Iniciada {formatDateTime(s.createdAt)}, expira {formatDateTime(s.expiresAt)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
