import { MessagesSquare, UserSearch } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui/styles";

/** Abas "Conversas | Leads" (os leads ficam dentro de Conversas) */
export function ConversasTabs({ active }: { active: "conversas" | "leads" }) {
  const tab = (on: boolean) => cn("inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap", on ? "bg-crm text-white" : "text-ink-soft hover:text-ink");
  return (
    <nav aria-label="Conversas e leads" className="mb-4">
      <ul className="inline-flex gap-1 rounded-full bg-paper p-1 ring-1 ring-line">
        <li>
          <Link href="/crm/conversas" aria-current={active === "conversas" ? "page" : undefined} className={tab(active === "conversas")}>
            <MessagesSquare className="size-4" aria-hidden />
            Conversas
          </Link>
        </li>
        <li>
          <Link href="/crm/conversas/leads" aria-current={active === "leads" ? "page" : undefined} className={tab(active === "leads")}>
            <UserSearch className="size-4" aria-hidden />
            Leads
          </Link>
        </li>
      </ul>
    </nav>
  );
}
