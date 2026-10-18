"use client";

/**
 * ATIVIDADE DA EQUIPE: as últimas ações (quem, o quê, quando, com qual contato),
 * com filtro por categoria, por pessoa e busca. Clique no contato abre o trilho.
 */
import { Search } from "lucide-react";
import { useState } from "react";
import { PatientLink } from "@/components/crm/widgets";
import { initials } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { CATEGORY_LABEL, type ActivityCategory } from "@/modules/crm/activity";

export interface ActivityItem {
  id: string;
  text: string;
  when: string;
  actorId: string | null;
  actor: string;
  contactId: string | null;
  contactName: string | null;
  category: ActivityCategory;
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ActivityLog({ items, team }: { items: ActivityItem[]; team: { id: string; name: string }[] }) {
  const [cat, setCat] = useState<ActivityCategory | "">("");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const term = plain(q.trim());
  const shown = items.filter(
    (i) =>
      (!cat || i.category === cat) &&
      (!who || (who === "-" ? !i.actorId : i.actorId === who)) &&
      (!term || plain(`${i.text} ${i.contactName ?? ""} ${i.actor}`).includes(term)),
  );

  return (
    <section aria-labelledby="atividade-t" className="rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
      <h2 id="atividade-t" className="text-lg font-bold">
        Atividade recente
      </h2>
      <p className="mb-3 text-sm text-ink-soft">As últimas {items.length} ações da equipe e das automações.</p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <label htmlFor="atividade-q" className="sr-only">
            Buscar na atividade
          </label>
          <input id="atividade-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ação, contato ou pessoa" className="block min-h-10 w-full rounded-xl bg-fog pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:bg-paper focus:ring-2 focus:ring-crm" />
        </div>
        <select aria-label="Quem" value={who} onChange={(e) => setWho(e.target.value)} className="min-h-10 max-w-52 rounded-xl bg-paper px-2 text-sm ring-1 ring-line">
          <option value="">Todas as pessoas</option>
          <option value="-">Automático</option>
          {team.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div role="group" aria-label="Categoria" className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={cat === ""} onClick={() => setCat("")}>
          Tudo
        </Chip>
        {(Object.keys(CATEGORY_LABEL) as ActivityCategory[]).map((c) => (
          <Chip key={c} on={cat === c} onClick={() => setCat(cat === c ? "" : c)}>
            {CATEGORY_LABEL[c]} <span className="tabular opacity-70">{items.filter((i) => i.category === c).length}</span>
          </Chip>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">Nada com estes filtros.</p>
      ) : (
        <ol className="divide-y divide-line">
          {shown.slice(0, limit).map((i) => (
            <li key={i.id} className="flex items-start gap-3 py-2.5">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold", i.actorId ? "bg-ink text-white" : "bg-bi-tint text-bi")} aria-hidden>
                {i.actorId ? initials(i.actor) : "A"}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  <strong>{i.actor}</strong>: {i.text}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
                  <span className="first-letter:uppercase">{i.when}</span>
                  {i.contactId && i.contactName ? <PatientLink id={i.contactId} name={i.contactName} className="text-xs" /> : null}
                  <span className="rounded-full bg-fog px-2 py-0.5">{CATEGORY_LABEL[i.category]}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {shown.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + 40)} className="mt-2 min-h-10 text-sm font-semibold text-crm hover:underline">
          Mostrar mais {Math.min(40, shown.length - limit)}
        </button>
      ) : null}
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
