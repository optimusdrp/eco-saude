import { SchemaGuard } from "@/components/SchemaGuard";
import { can, STAFF_ROLE_LABEL } from "@ecosaude/core";
import { count, db, eq, pendingMigrations, schema } from "@ecosaude/db";
import { Shell, type NavLink } from "@/components/shell/Shell";
import { requireUser } from "@/lib/auth/dal";

/**
 * Layout das telas internas: exige login completo (senha + 2FA)
 * e monta o menu só com o que o perfil pode acessar.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // Banco sem as últimas migrações? Mostra o passo a passo em vez de quebrar
  if ((await pendingMigrations()).length) return <SchemaGuard>{children}</SchemaGuard>;

  const user = await requireUser();

  // Quantidade de leads novos, exibida ao lado do item "Leads"
  let newLeads = 0;
  if (can(user.role, "leads.view")) {
    const [row] = await db.select({ n: count() }).from(schema.leads).where(eq(schema.leads.stage, "novo"));
    newLeads = row?.n ?? 0;
  }

  const links: NavLink[] = [{ href: "/", label: "Painel", icon: "dashboard" }];
  if (can(user.role, "leads.view")) links.push({ href: "/leads", label: "Leads", icon: "leads", badge: newLeads });
  if (can(user.role, "clinics.view")) links.push({ href: "/clinicas", label: "Clínicas", icon: "clinics" });
  if (can(user.role, "catalog.view")) links.push({ href: "/catalogo", label: "Catálogo", icon: "catalog" });
  if (can(user.role, "staff.manage")) links.push({ href: "/equipe", label: "Equipe", icon: "staff" });
  if (can(user.role, "audit.view")) links.push({ href: "/auditoria", label: "Auditoria", icon: "audit" });

  return (
    <Shell links={links} user={{ name: user.name, roleLabel: STAFF_ROLE_LABEL[user.role] }}>
      {children}
    </Shell>
  );
}
