import { CLINIC_ROLE_LABEL, clinicTimeZone } from "@ecosaude/core/crm";
import { db, desc, eq, schema } from "@ecosaude/db";
import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui/server";
import { requireUser } from "@/lib/auth/dal";
import { ChangePasswordForm } from "../../../(auth)/forms";
import { describeDevice } from "./device";
import { EndSessions } from "./SessionTools";
import { TwoFactorPanel } from "./TwoFactorPanel";

export const metadata: Metadata = { title: "Minha conta" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: clinicTimeZone() });

/** Minha conta: dados, 2FA opcional, troca de senha e aparelhos conectados. */
export default async function AccountPage() {
  const user = await requireUser();
  // Sessões ficam fora do papel da clínica (RLS): consulta direta, filtrada pelo próprio usuário
  const sessions = await db.query.clinicSessions.findMany({
    where: eq(schema.clinicSessions.userId, user.id),
    orderBy: desc(schema.clinicSessions.createdAt),
    columns: { id: true, createdAt: true, expiresAt: true, ip: true, userAgent: true },
  });

  return (
    <>
      <PageHeader title="Minha conta" description={`${user.name}, ${CLINIC_ROLE_LABEL[user.role]} na ${user.clinicName}. Login: ${user.email}`} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Panel title="Verificação em duas etapas" description="Opcional. Protege a conta mesmo que alguém descubra a sua senha.">
            <TwoFactorPanel enabled={user.totpEnabled} />
          </Panel>
          <Panel title="Trocar senha" description="Os outros aparelhos conectados serão desconectados.">
            <ChangePasswordForm from="conta" />
          </Panel>
        </div>
        <Panel title="Aparelhos conectados" description="Não reconhece algum? Desconecte e troque a senha." actions={sessions.length > 1 ? <EndSessions label="Desconectar os outros" /> : null}>
          <ul className="divide-y divide-line text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {describeDevice(s.userAgent)}
                    {s.id === user.sessionId ? <span className="ml-1.5 rounded-full bg-pep-tint px-2 py-0.5 text-xs text-pep-ink">este aparelho</span> : null}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {s.ip ? `IP ${s.ip}. ` : ""}Desde {fmt(s.createdAt)}, expira {fmt(s.expiresAt)}
                  </p>
                </div>
                {s.id !== user.sessionId ? <EndSessions id={s.id} label="Desconectar" /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
