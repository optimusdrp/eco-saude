import { bmi, DOCUMENT_KIND_LABEL, VITALS, vitalAlerts, type Diagnosis, type TemplateField, type Vitals } from "@ecosaude/core/pep";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/server";
import { cn } from "@/components/ui/styles";

/**
 * Leitura de um atendimento (sem edição): respostas do modelo, sinais vitais com alertas,
 * diagnósticos, conduta e retorno. Usado na linha do tempo e no atendimento finalizado.
 */
export function EncounterContent({
  fields,
  answers,
  vitals,
  diagnoses,
  conduct,
  returnDays,
  returnNote,
  age,
}: {
  fields: TemplateField[];
  answers: Record<string, unknown>;
  vitals: Vitals;
  diagnoses: Diagnosis[];
  conduct: string | null;
  returnDays: number | null;
  returnNote: string | null;
  age: number | null;
}) {
  const vit = VITALS.filter((v) => vitals[v.id] !== undefined);
  const b = bmi(vitals);
  const alerts = vitalAlerts(vitals, age);
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        if (f.type === "titulo") {
          const hasAny = fields.slice(fields.indexOf(f) + 1).some((x) => x.type !== "titulo" && answers[x.id] !== undefined);
          return hasAny ? (
            <h4 key={f.id} className="pt-1 text-sm font-bold text-pep">
              {f.label}
            </h4>
          ) : null;
        }
        const v = answers[f.id];
        if (v === undefined || v === null || v === "") return null;
        const text = Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Sim" : "Não") : `${String(v)}${f.unit ? ` ${f.unit}` : ""}`;
        return (
          <div key={f.id}>
            <p className="text-xs font-semibold text-ink-soft">{f.label}</p>
            <p className="whitespace-pre-wrap">{text}</p>
          </div>
        );
      })}

      {vit.length ? (
        <div>
          <p className="text-xs font-semibold text-ink-soft">Sinais vitais</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {vit.map((v) => (
              <li key={v.id} className="rounded-lg bg-fog px-2 py-1 text-sm tabular">
                <span className="text-ink-soft">{v.label.replace("Frequência", "Freq.").replace("Pressão", "PA")}</span> {vitals[v.id]?.toLocaleString("pt-BR")} {v.unit}
              </li>
            ))}
            {b ? (
              <li className="rounded-lg bg-fog px-2 py-1 text-sm tabular">
                <span className="text-ink-soft">IMC</span> {b.value.toLocaleString("pt-BR")} ({b.label.charAt(0).toLowerCase() + b.label.slice(1)})
              </li>
            ) : null}
          </ul>
          {alerts.length ? (
            <ul className="mt-2 space-y-1">
              {alerts.map((a) => (
                <li key={a.message} className={cn("text-sm font-semibold", a.level === "urgente" ? "text-alert" : "text-erp-ink")}>
                  {a.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {diagnoses.length ? (
        <div>
          <p className="text-xs font-semibold text-ink-soft">Diagnósticos (CID-10)</p>
          <ul className="mt-1 space-y-1">
            {diagnoses.map((d) => (
              <li key={d.code}>
                <span className="font-semibold tabular">{d.code}</span> {d.name}
                {d.principal ? <Badge className="ml-2">principal</Badge> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conduct ? (
        <div>
          <p className="text-xs font-semibold text-ink-soft">Conduta</p>
          <p className="whitespace-pre-wrap">{conduct}</p>
        </div>
      ) : null}
      {returnDays ? (
        <p className="text-sm">
          <span className="font-semibold">Retorno em {returnDays} dias</span>
          {returnNote ? <span className="text-ink-soft">: {returnNote}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export function DocumentLinks({ documents }: { documents: { id: string; kind: keyof typeof DOCUMENT_KIND_LABEL; verificationCode: string; revokedAt: Date | null; issuedAt: Date }[] }) {
  if (!documents.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {documents.map((d) => (
        <li key={d.id}>
          <a
            href={`/api/prontuario/documentos/${d.id}/pdf`}
            target="_blank"
            rel="noopener"
            className={cn("inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold ring-1", d.revokedAt ? "text-ink-soft line-through ring-line" : "text-pep ring-pep/30 hover:bg-pep-tint")}
          >
            <FileText className="size-4" aria-hidden />
            {DOCUMENT_KIND_LABEL[d.kind]}
            {d.revokedAt ? <span className="sr-only">(cancelado)</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
