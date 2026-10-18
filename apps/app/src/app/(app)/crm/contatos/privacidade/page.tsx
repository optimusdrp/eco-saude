import {
  clinicTimeZone,
  PRIVACY_REFUSAL_LABEL,
  PRIVACY_REQUEST_CHANNEL_LABEL,
  PRIVACY_REQUEST_KIND_LABEL,
  PRIVACY_REQUEST_STATUS_LABEL,
  privacyDeadlineState,
  type PrivacyRefusalReason,
  type PrivacyRequestChannel,
  type PrivacyRequestKind,
  type PrivacyRequestStatus,
} from "@ecosaude/core/crm";
import { withTenant } from "@ecosaude/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { listPrivacyRequests } from "@/modules/crm/privacy";

export const metadata: Metadata = { title: "Pedidos LGPD" };
export const dynamic = "force-dynamic";

/**
 * PEDIDOS DO TITULAR (LGPD)
 * Registro de todos os pedidos de exclusão e de cópia dos dados, com protocolo e prazo.
 * É a prova de que a clínica atende os direitos do titular (prestação de contas).
 * Pedido atendido não mostra o paciente: os dados dele já não existem.
 */
const RESULT_LABEL: Record<string, string> = {
  mensagens: "mensagens",
  anexos: "anexos (arquivos)",
  conversas: "conversas",
  leituras_ia: "leituras da IA",
  tarefas: "tarefas",
  consultas: "consultas (só observações)",
  eventos: "registros da linha do tempo",
  identificadores: "identificadores de canal",
  envios_cancelados: "envios cancelados",
};

const date = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: clinicTimeZone() });

export default async function PrivacyRequestsPage() {
  const ctx = await requireCrm("pacientes.anonimizar");
  const current = now();
  const rows = await withTenant(ctx.user.clinicId, (tx) => listPrivacyRequests(tx));
  const open = rows.filter((r) => r.status === "aberta");
  const late = open.filter((r) => r.dueAt < current).length;

  return (
    <>
      <Link href="/crm/contatos" className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Contatos
      </Link>
      <PageHeader
        title="Pedidos LGPD"
        description={
          open.length
            ? `${open.length} ${open.length === 1 ? "pedido aberto" : "pedidos abertos"}${late ? `, ${late} com prazo vencido` : ""}. O prazo é de 15 dias a partir do pedido.`
            : "Nenhum pedido aguardando. O prazo para responder é de 15 dias a partir do pedido."
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="Nenhum pedido ainda">Pedidos de exclusão são registrados na ficha do paciente. Cada exportação de dados também fica aqui, com protocolo.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const st = r.status === "aberta" ? privacyDeadlineState(r.dueAt, current) : null;
            const result = r.result
              ? Object.entries(r.result)
                  .filter(([k, v]) => v > 0 && RESULT_LABEL[k])
                  .map(([k, v]) => `${v} ${RESULT_LABEL[k]}`)
                  .join(", ")
              : "";
            return (
              <li key={r.id} className="rounded-2xl bg-paper p-4 ring-1 ring-line">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular">{r.protocol}</span>
                  <Badge tone={r.kind === "exclusao" ? "crm" : "neutral"}>{PRIVACY_REQUEST_KIND_LABEL[r.kind as PrivacyRequestKind]}</Badge>
                  <Badge tone={r.status === "aberta" ? (st?.tone === "alert" ? "alert" : st?.tone === "warning" ? "warning" : "neutral") : r.status === "concluida" ? "success" : "dark"}>
                    {r.status === "aberta" ? st!.label : PRIVACY_REQUEST_STATUS_LABEL[r.status as PrivacyRequestStatus]}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  Pedido em {date(r.requestedAt)} ({PRIVACY_REQUEST_CHANNEL_LABEL[r.channel as PrivacyRequestChannel]?.toLowerCase()}).
                  {r.status === "aberta" ? ` Responder até ${date(r.dueAt)}.` : r.decidedAt ? ` Decidido em ${date(r.decidedAt)}${r.decidedByName ? ` por ${r.decidedByName}` : ""}.` : ""}
                </p>
                {r.status === "aberta" && r.contactId && !r.anonymizedAt ? (
                  <Link href={`/crm/contatos/${r.contactId}`} className="mt-1 inline-flex min-h-9 items-center text-sm font-semibold text-crm hover:underline">
                    Abrir a ficha de {r.contactName} para decidir
                  </Link>
                ) : null}
                {r.status === "recusada" && r.refusalReason ? <p className="mt-1 text-sm">Motivo: {PRIVACY_REFUSAL_LABEL[r.refusalReason as PrivacyRefusalReason]}</p> : null}
                {r.status === "concluida" && r.kind === "exclusao" && result ? <p className="mt-1 text-xs text-ink-soft">Apagados: {result}.</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-6 max-w-3xl rounded-2xl bg-fog p-4 text-sm text-ink-soft">
        <h2 className="font-semibold text-ink">Como funciona</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>A recepção registra o pedido na ficha; a gestão confere a identidade e apaga, ou recusa por um motivo da lista.</li>
          <li>Apagar é definitivo: nome, contatos, mensagens, anotações e leituras da IA somem. Ficam números sem identificação para os relatórios.</li>
          <li>O prontuário não é apagado pelo CRM: a lei obriga a guardá-lo por 20 anos.</li>
          <li>Este registro não guarda nome nem telefone, só um código que permite conferir depois se um número já pediu exclusão.</li>
          <li>Responda o paciente pelo mesmo canal do pedido, informando o protocolo.</li>
        </ul>
      </section>
    </>
  );
}
