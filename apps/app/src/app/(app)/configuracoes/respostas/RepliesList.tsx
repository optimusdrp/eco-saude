"use client";

/**
 * RESPOSTAS RÁPIDAS com busca (atalho, título, texto), filtro "modelo aprovado"
 * e prévia como bolha de mensagem, do jeito que o paciente vai ler.
 */
import { Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";
import { DeleteQuickReply, QuickReplyButton, type QuickReplyValues } from "../forms";

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function RepliesList({ replies }: { replies: (QuickReplyValues & { id: string })[] }) {
  const [q, setQ] = useState("");
  const [onlyApproved, setOnlyApproved] = useState(false);
  const term = plain(q.trim().replace(/^\//, ""));
  const shown = replies.filter((r) => (!onlyApproved || r.approvedTemplate) && (!term || plain(`${r.shortcut} ${r.title} ${r.body}`).includes(term)));
  const approved = replies.filter((r) => r.approvedTemplate).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <label htmlFor="respostas-q" className="sr-only">
            Buscar resposta
          </label>
          <input id="respostas-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por atalho, título ou texto" className="block min-h-10 w-full rounded-xl bg-paper pr-3 pl-9 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-crm" />
        </div>
        <button
          type="button"
          aria-pressed={onlyApproved}
          onClick={() => setOnlyApproved((v) => !v)}
          className={cn("inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold ring-1", onlyApproved ? "bg-ink text-white ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink")}
        >
          Modelos aprovados <span className="tabular opacity-70">{approved}</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-ink-soft">Nenhuma resposta com estes filtros.</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col rounded-2xl bg-paper p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-crm-tint px-2 py-0.5 font-semibold text-crm">/{r.shortcut}</code>
                <span className="min-w-0 font-semibold">{r.title}</span>
                {r.approvedTemplate ? <Badge tone="success">modelo aprovado</Badge> : null}
              </div>
              {/* Prévia: como a mensagem chega ao paciente */}
              <div className="mt-3 flex-1 rounded-xl bg-fog p-3">
                <p className="ml-auto w-fit max-w-[92%] rounded-2xl rounded-br-sm bg-crm-tint px-3 py-2 text-sm break-words whitespace-pre-line text-ink">{r.body}</p>
                <p className="mt-1 text-right text-[0.68rem] text-ink-soft tabular">{r.body.length} caracteres</p>
              </div>
              <div className="mt-2 flex gap-1">
                <QuickReplyButton initial={{ id: r.id, shortcut: r.shortcut, title: r.title, body: r.body, approvedTemplate: r.approvedTemplate }} />
                <DeleteQuickReply id={r.id} shortcut={r.shortcut} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
