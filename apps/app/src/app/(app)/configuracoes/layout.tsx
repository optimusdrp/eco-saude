import { getEntitlements, requireUser } from "@/lib/auth/dal";
import { visibleGroups } from "./catalog";
import { SettingsTabs } from "./SettingsTabs";

/**
 * AJUSTES: todas as configurações do sistema num lugar só.
 * Menu lateral agrupado (Você, Clínica, Atendimento, Gestão), mostrando só o que
 * o perfil pode usar. Cada página continua conferindo a permissão no servidor.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { modules } = await getEntitlements(user.clinicId);
  const groups = visibleGroups((p) => user.permissions.includes(p), modules);
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
      <SettingsTabs groups={groups} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
