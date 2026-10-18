import { CHANNEL_LABEL, formatWhen, JOURNEY_STAGE_LABEL } from "@ecosaude/core/crm";
import { compareContacts } from "@ecosaude/core/crm";
import { eq, inSequence, schema, withTenant } from "@ecosaude/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DismissPair, MergeForm, type MergeSide } from "@/components/crm/patients/MergeTools";
import { Badge, PageHeader, Panel } from "@/components/ui/server";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { formatPhone } from "@/modules/crm/format";
import { mergePreview } from "@/modules/crm/merge";

export const metadata: Metadata = { title: "Unificar cadastros" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Compara dois cadastros lado a lado e unifica. */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const ctx = await requireCrm("contatos.mesclar");
  const { a, b } = await searchParams;
  if (!a || !b || !UUID.test(a) || !UUID.test(b) || a === b) notFound();
  const current = now();

  const data = await withTenant(ctx.user.clinicId, async (tx) => {
    const load = async (id: string) => {
      const c = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, id), with: { identities: true } });
      if (!c) return null;
      const counts = await mergePreview(tx, id);
      return { c, counts };
    };
    const [x, y] = await inSequence([() => load(a), () => load(b)]);
    return x && y ? { x, y } : null;
  });
  if (!data) notFound();

  const side = ({ c, counts }: NonNullable<typeof data>["x"]): MergeSide => ({
    id: c.id,
    version: c.version,
    name: c.name,
    summary: [
      `Celular: ${formatPhone(c.phone)}`,
      `E-mail: ${c.email ?? "—"}`,
      `Nascimento: ${c.birthDate ? c.birthDate.split("-").reverse().join("/") : "—"}`,
      `Etapa: ${JOURNEY_STAGE_LABEL[c.stage]}`,
      `Canais: ${[...new Set(c.identities.map((i) => CHANNEL_LABEL[i.channel]))].join(", ") || "—"}`,
      `${counts.appointments} consulta(s), ${counts.conversations} conversa(s), ${counts.tasks} tarefa(s)`,
      `Cadastrado ${formatWhen(c.createdAt, current)}`,
      ...(c.optedOutAt ? ["Pediu SAIR"] : []),
    ],
  });
  const match = compareContacts(data.x.c, data.y.c);
  // Sugestão de principal: quem tem mais história (consultas + conversas); empate = o mais antigo
  const score = (s: NonNullable<typeof data>["x"]) => s.counts.appointments * 3 + s.counts.conversations + (s.c.phone ? 1 : 0);
  const suggested =
    score(data.x) === score(data.y) ? (data.x.c.createdAt <= data.y.c.createdAt ? data.x.c.id : data.y.c.id) : score(data.x) > score(data.y) ? data.x.c.id : data.y.c.id;

  return (
    <>
      <Link href="/crm/contatos/duplicados" className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Possíveis duplicados
      </Link>
      <PageHeader
        title="Unificar cadastros"
        description={
          match ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={match.strength === "forte" ? "alert" : "warning"}>{match.strength === "forte" ? "suspeita forte" : "nome parecido"}</Badge>
              {match.reasons.join(", ")}
            </span>
          ) : (
            "Os dados não batem: confira com atenção antes de unificar."
          )
        }
      />
      <Panel>
        <MergeForm a={side(data.x)} b={side(data.y)} suggested={suggested} />
        <div className="mt-4 border-t border-line pt-3">
          <DismissPair a={a} b={b} label="Não é a mesma pessoa (não sugerir de novo)" />
        </div>
      </Panel>
    </>
  );
}
