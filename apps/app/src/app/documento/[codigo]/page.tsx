import { DOCUMENT_KIND_LABEL, ROUTE_LABEL, type DocumentContent } from "@ecosaude/core/pep";
import { contentHash, normalizeVerificationCode } from "@ecosaude/core/pep/server";
import { db, eq, schema } from "@ecosaude/db";
import { BadgeCheck, CircleSlash, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Conferir documento" };

/** "Maria da Silva Costa" -> "M. S. C." (o nome completo não fica exposto na internet) */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(" ");
}

const dateBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** O que ajuda a conferir o papel, sem expor diagnóstico (o CID do atestado nunca aparece aqui) */
function summary(c: DocumentContent): string[] {
  switch (c.kind) {
    case "receita":
    case "receita_especial":
      return c.items.map((i) => `${i.medication}${i.quantity ? `, ${i.quantity}` : ""} (${ROUTE_LABEL[i.route].toLowerCase()})`);
    case "atestado":
      return [`${c.days} ${c.days === 1 ? "dia" : "dias"} de afastamento a partir de ${dateBr(c.startDate)}`];
    case "declaracao":
      return [`Comparecimento em ${dateBr(c.date)}, das ${c.from} às ${c.to}`];
    case "pedido_exames":
      return [`${c.items.length} ${c.items.length === 1 ? "exame" : "exames"}: ${c.items.join(", ")}`];
    case "encaminhamento":
      return [`Para: ${c.to}`];
  }
}

export default async function VerifyDocument({ params }: { params: Promise<{ codigo: string }> }) {
  const code = normalizeVerificationCode(decodeURIComponent((await params).codigo));
  // Consulta direta (sem a sessão de uma clínica): o código é único entre todas as clínicas
  const [doc] = code
    ? await db
        .select({ kind: schema.pepDocuments.kind, content: schema.pepDocuments.content, header: schema.pepDocuments.header, issuedAt: schema.pepDocuments.issuedAt, revokedAt: schema.pepDocuments.revokedAt, hash: schema.pepDocuments.hash, encounterId: schema.pepDocuments.encounterId, issuedBy: schema.pepDocuments.issuedBy, tz: schema.clinics.timeZone })
        .from(schema.pepDocuments)
        .innerJoin(schema.clinics, eq(schema.clinics.id, schema.pepDocuments.clinicId))
        .where(eq(schema.pepDocuments.verificationCode, code))
        .limit(1)
    : [];

  if (!doc) {
    return (
      <section className="rounded-3xl bg-paper p-5 ring-1 ring-line sm:p-7" aria-live="polite">
        <SearchX className="size-9 text-alert" aria-hidden />
        <h1 className="mt-3 text-2xl font-bold">Documento não encontrado</h1>
        <p className="mt-1 text-ink-soft">
          Nenhum documento tem o código <span className="font-mono font-semibold text-ink">{code || "informado"}</span>. Confira a digitação; se estiver certa, o documento não foi emitido pelo Tropi.
        </p>
        <Link href="/documento" className="mt-5 inline-block font-semibold text-pep underline underline-offset-4">
          Conferir outro código
        </Link>
      </section>
    );
  }

  // Integridade: recalcula o hash do conteúdo guardado (mesma fórmula da emissão). Diferente = alterado no banco.
  const intact = contentHash({ kind: doc.kind, content: doc.content, header: doc.header, encounterId: doc.encounterId, issuedAt: doc.issuedAt.toISOString(), issuedBy: doc.issuedBy }) === doc.hash;
  if (!intact) {
    return (
      <section className="rounded-3xl bg-paper p-5 ring-1 ring-line sm:p-7" aria-live="polite">
        <SearchX className="size-9 text-alert" aria-hidden />
        <h1 className="mt-3 text-2xl font-bold">Documento com divergência</h1>
        <p className="mt-1 text-ink-soft">O registro deste código não confere com o que foi emitido. Não aceite o documento e procure a clínica {doc.header.clinic.name}.</p>
      </section>
    );
  }
  const revoked = !!doc.revokedAt;
  const issued = new Intl.DateTimeFormat("pt-BR", { timeZone: doc.tz, dateStyle: "long", timeStyle: "short" }).format(doc.issuedAt);
  return (
    <section className="overflow-hidden rounded-3xl bg-paper ring-1 ring-line" aria-live="polite">
      <div className={revoked ? "bg-alert-tint px-5 py-5 sm:px-7" : "bg-pep-tint px-5 py-5 sm:px-7"}>
        {revoked ? <CircleSlash className="size-9 text-alert" aria-hidden /> : <BadgeCheck className="size-9 text-pep" aria-hidden />}
        <h1 className="mt-3 text-2xl font-bold">{revoked ? "Documento cancelado" : "Documento autêntico"}</h1>
        <p className={revoked ? "mt-1 font-semibold text-alert" : "mt-1 text-pep-ink"}>
          {revoked ? "O profissional cancelou este documento. Ele não deve ser aceito." : "Emitido pela clínica no Tropi e sem alterações desde a emissão."}
        </p>
      </div>
      <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-7">
        <div>
          <dt className="text-sm text-ink-soft">Documento</dt>
          <dd className="font-semibold">{DOCUMENT_KIND_LABEL[doc.kind]}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Emitido em</dt>
          <dd className="font-semibold">{issued}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Clínica</dt>
          <dd className="font-semibold">{doc.header.clinic.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Profissional</dt>
          <dd className="font-semibold">
            {doc.header.professional.name}
            {doc.header.professional.council ? <span className="block text-sm font-normal text-ink-soft">{doc.header.professional.council}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Paciente (iniciais)</dt>
          <dd className="font-semibold">{initials(doc.header.patient.name)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Código</dt>
          <dd className="font-mono font-semibold">{code}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-ink-soft">Confira com o papel</dt>
          <dd>
            <ul className="mt-1 space-y-1">
              {summary(doc.content).map((s) => (
                <li key={s} className="rounded-lg bg-fog px-3 py-2 text-sm">
                  {s}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </section>
  );
}
