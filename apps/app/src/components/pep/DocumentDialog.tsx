"use client";

import { DOCUMENT_KIND_LABEL, ROUTE_LABEL, searchText, type Diagnosis, type DocumentContent, type DocumentKind } from "@ecosaude/core/pep";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckboxField, Dialog, Field, FormMessage, SelectField, TextareaField } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { issueDocumentAction } from "@/modules/pep/actions";

/**
 * EMISSÃO DE DOCUMENTOS DO ATENDIMENTO
 * Receita, receita de controle especial (2 vias), atestado, declaração de comparecimento,
 * pedido de exames e encaminhamento. O documento é congelado na emissão (PDF sempre igual)
 * e ganha código de verificação. Errou? Cancele e emita outro.
 *
 * Segurança na prescrição: se o nome do medicamento lembra uma ALERGIA registrada, a tela
 * avisa e pede confirmação explícita antes de emitir.
 */

type Route = keyof typeof ROUTE_LABEL;
interface Item {
  medication: string;
  instructions: string;
  quantity: string;
  route: Route;
}

const COMMON_EXAMS = [
  "Hemograma completo",
  "Glicemia de jejum",
  "Hemoglobina glicada (HbA1c)",
  "Colesterol total e frações",
  "Triglicerídeos",
  "Creatinina",
  "Ureia",
  "TGO (AST)",
  "TGP (ALT)",
  "TSH",
  "T4 livre",
  "Urina tipo 1 (EAS)",
  "Urocultura com antibiograma",
  "Vitamina D (25-OH)",
  "Vitamina B12",
  "Ferritina",
  "PSA total",
  "Beta-HCG",
];

const today = () => new Date().toLocaleDateString("sv-SE");
const nowTime = () => new Date().toTimeString().slice(0, 5);
const emptyItem = (): Item => ({ medication: "", instructions: "", quantity: "", route: "oral" });

export function DocumentButtons({ encounterId, diagnoses, allergies, startedAt }: { encounterId: string; diagnoses: Diagnosis[]; allergies: string[]; startedAt: string }) {
  const [kind, setKind] = useState<DocumentKind | null>(null);
  return (
    <>
      {/* Duas colunas no celular (largura toda); uma coluna na lateral estreita do computador */}
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {(Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[]).map((k) => (
          <li key={k} className={k === "receita_especial" ? "col-span-2 lg:col-span-1" : undefined}>
            <button type="button" onClick={() => setKind(k)} className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-fog px-3 text-left text-sm font-semibold hover:bg-pep-tint hover:text-pep-ink">
              <FileText className="size-4 shrink-0" aria-hidden />
              {k === "declaracao" ? "Declaração" : DOCUMENT_KIND_LABEL[k]}
            </button>
          </li>
        ))}
      </ul>
      {kind ? <DocumentForm key={kind} kind={kind} encounterId={encounterId} diagnoses={diagnoses} allergies={allergies} startedAt={startedAt} onClose={() => setKind(null)} /> : null}
    </>
  );
}

function DocumentForm({ kind, encounterId, diagnoses, allergies, startedAt, onClose }: { kind: DocumentKind; encounterId: string; diagnoses: Diagnosis[]; allergies: string[]; startedAt: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok?: boolean; message?: string; errors?: Record<string, string>; data?: Record<string, unknown> }>({});
  const issued = state.ok ? (state.data as { id: string; code: string }) : null;

  // Receitas
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [notes, setNotes] = useState("");
  const [allergyOk, setAllergyOk] = useState(false);
  // Atestado
  const [days, setDays] = useState("1");
  const [startDate, setStartDate] = useState(today());
  const [includeCid, setIncludeCid] = useState(false);
  const [cid, setCid] = useState(diagnoses.find((d) => d.principal)?.code ?? diagnoses[0]?.code ?? "");
  // Declaração
  const started = new Date(startedAt);
  const [date, setDate] = useState(today());
  const [from, setFrom] = useState(started.toTimeString().slice(0, 5));
  const [to, setTo] = useState(nowTime());
  const [companion, setCompanion] = useState("");
  // Exames
  const [exams, setExams] = useState("");
  const [indication, setIndication] = useState(diagnoses.map((d) => `${d.code} ${d.name}`).join("; "));
  // Encaminhamento
  const [refTo, setRefTo] = useState("");
  const [reason, setReason] = useState("");
  const [urgency, setUrgency] = useState<"eletivo" | "prioritario" | "urgente">("eletivo");

  // Alergia x medicamento (comparação sem acento, nos dois sentidos: "dipirona" x "Dipirona sódica 500mg")
  const allergyHits =
    kind === "receita" || kind === "receita_especial"
      ? allergies.filter((a) => {
          const an = searchText(a).trim();
          return an.length >= 3 && items.some((i) => {
            const m = searchText(i.medication);
            return m.length >= 3 && (m.includes(an) || an.includes(m.split(/\s+/)[0] ?? "~"));
          });
        })
      : [];

  const content = (): DocumentContent => {
    const its = items.filter((i) => i.medication.trim()).map((i) => ({ medication: i.medication, instructions: i.instructions, quantity: i.quantity || undefined, route: i.route }));
    switch (kind) {
      case "receita":
        return { kind, items: its, notes: notes || undefined };
      case "receita_especial":
        return { kind, items: its, notes: notes || undefined };
      case "atestado":
        return { kind, days: Number(days), startDate, includeCid, cid: includeCid ? cid : undefined, notes: notes || undefined };
      case "declaracao":
        return { kind, date, from, to, companion: companion || undefined };
      case "pedido_exames":
        return { kind, items: exams.split("\n").map((s) => s.trim()).filter(Boolean), indication: indication || undefined };
      case "encaminhamento":
        return { kind, to: refTo, reason, urgency };
    }
  };

  const submit = () =>
    start(async () => {
      if (allergyHits.length && !allergyOk) {
        setState({ ok: false, message: "Confirme que viu o alerta de alergia antes de emitir." });
        return;
      }
      const r = await issueDocumentAction(encounterId, content());
      setState(r);
      if (r.ok) router.refresh();
    });

  const addExam = (e: string) => setExams((cur) => (cur.split("\n").map((s) => s.trim()).includes(e) ? cur : `${cur.trim() ? `${cur.trim()}\n` : ""}${e}`));

  return (
    <Dialog open onClose={onClose} title={DOCUMENT_KIND_LABEL[kind]} wide description={kind === "receita_especial" ? "Controle especial (lista C1, C5 e adendos): sai em 2 vias, até 3 medicamentos. Receitas A e B usam o talonário oficial." : undefined}>
      {issued ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto size-10 text-ok" aria-hidden />
          <p className="text-lg font-bold">Documento emitido</p>
          <p className="text-ink-soft">
            Código de verificação <span className="font-mono font-semibold text-ink">{issued.code}</span>
          </p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <a href={`/api/prontuario/documentos/${issued.id}/pdf`} target="_blank" rel="noopener" className={buttonStyles("primary", "bg-pep hover:bg-pep-ink")}>
              <ExternalLink className="size-4" aria-hidden />
              Abrir PDF para imprimir
            </a>
            <button type="button" onClick={onClose} className={buttonStyles("secondary")}>
              Fechar
            </button>
          </div>
          <p className="text-sm text-ink-soft">Imprima e assine. A assinatura digital (ICP-Brasil) chega numa próxima etapa.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(kind === "receita" || kind === "receita_especial") && (
            <>
              <ol className="space-y-3">
                {items.map((it, i) => (
                  <li key={i} className="rounded-xl bg-fog p-3">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_auto]">
                      <Field label={`Medicamento ${i + 1}`} name={`med-${i}`} id={`med-${i}`} value={it.medication} placeholder="Nome, concentração e forma (ex.: Amoxicilina 500 mg cápsula)" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, medication: e.target.value } : x)))} />
                      <Field label="Quantidade" name={`qty-${i}`} id={`qty-${i}`} value={it.quantity} placeholder="21 cápsulas" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                      <SelectField label="Via" name={`route-${i}`} id={`route-${i}`} value={it.route} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, route: e.target.value as Route } : x)))}>
                        {(Object.keys(ROUTE_LABEL) as Route[]).map((r) => (
                          <option key={r} value={r}>
                            {ROUTE_LABEL[r]}
                          </option>
                        ))}
                      </SelectField>
                      <button
                        type="button"
                        onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : [emptyItem()])}
                        aria-label={`Remover medicamento ${i + 1}`}
                        className="inline-flex size-11 items-center justify-center self-end rounded-xl text-ink-soft hover:bg-alert-tint hover:text-alert"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                    <Field className="mt-2" label="Como usar" name={`ins-${i}`} id={`ins-${i}`} value={it.instructions} placeholder="Tomar 1 cápsula de 8 em 8 horas por 7 dias" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)))} />
                  </li>
                ))}
              </ol>
              {items.length < (kind === "receita_especial" ? 3 : 20) ? (
                <button type="button" onClick={() => setItems([...items, emptyItem()])} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-pep hover:bg-pep-tint">
                  <Plus className="size-4" aria-hidden />
                  Medicamento
                </button>
              ) : null}
              <TextareaField label="Orientações" name="notes" id="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              {allergyHits.length ? (
                <div role="alert" className="rounded-xl bg-alert-tint p-3 text-alert">
                  <p className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="size-4" aria-hidden />
                    Paciente com alergia registrada: {allergyHits.join(", ")}
                  </p>
                  <CheckboxField label="Vi o alerta e mantenho a prescrição" checked={allergyOk} onChange={(e) => setAllergyOk(e.target.checked)} />
                </div>
              ) : null}
            </>
          )}

          {kind === "atestado" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Dias de afastamento" name="days" id="at-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
                <Field label="A partir de" name="startDate" id="at-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              {diagnoses.length ? (
                <div className="rounded-xl bg-fog p-3">
                  <CheckboxField
                    label="Incluir o CID no atestado"
                    hint="Só com autorização expressa do paciente (Resolução CFM 1.658/2002). Sem ela, o atestado sai sem diagnóstico."
                    checked={includeCid}
                    onChange={(e) => setIncludeCid(e.target.checked)}
                  />
                  {includeCid ? (
                    <SelectField label="CID" name="cid" id="at-cid" value={cid} onChange={(e) => setCid(e.target.value)}>
                      {diagnoses.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.code} {d.name}
                        </option>
                      ))}
                    </SelectField>
                  ) : null}
                </div>
              ) : null}
              <TextareaField label="Observação" name="notes" id="at-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </>
          )}

          {kind === "declaracao" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Data" name="date" id="dc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <Field label="Das" name="from" id="dc-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Field label="Às" name="to" id="dc-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              <Field label="Acompanhante (opcional)" name="companion" id="dc-comp" value={companion} onChange={(e) => setCompanion(e.target.value)} className="sm:col-span-3" hint="Nome de quem acompanhou, quando a declaração for também para ele." />
            </div>
          )}

          {kind === "pedido_exames" && (
            <>
              <TextareaField label="Exames (um por linha)" name="exams" id="ex-items" value={exams} onChange={(e) => setExams(e.target.value)} rows={6} />
              <div>
                <p className="text-sm font-semibold">Mais pedidos</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {COMMON_EXAMS.map((e) => (
                    <li key={e}>
                      <button type="button" onClick={() => addExam(e)} className={cn("min-h-9 rounded-full px-3 text-sm ring-1", exams.includes(e) ? "bg-pep-tint text-pep-ink ring-pep/30" : "ring-line hover:ring-ink/30")}>
                        {e}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <TextareaField label="Indicação clínica" name="indication" id="ex-ind" value={indication} onChange={(e) => setIndication(e.target.value)} rows={2} hint="Convênios costumam exigir. Vem dos diagnósticos do atendimento." />
            </>
          )}

          {kind === "encaminhamento" && (
            <>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Field label="Para" name="to" id="en-to" value={refTo} onChange={(e) => setRefTo(e.target.value)} placeholder="Cardiologia, ou Dra. Ana Lima (cardiologista)" />
                <SelectField label="Caráter" name="urgency" id="en-urg" value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)}>
                  <option value="eletivo">Eletivo</option>
                  <option value="prioritario">Prioritário</option>
                  <option value="urgente">Urgente</option>
                </SelectField>
              </div>
              <TextareaField label="Motivo e resumo do caso" name="reason" id="en-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={5} />
            </>
          )}

          <FormMessage state={state} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={buttonStyles("ghost")}>
              Cancelar
            </button>
            <button type="button" onClick={submit} disabled={pending} aria-busy={pending} className={buttonStyles("primary", "bg-pep hover:bg-pep-ink")}>
              {pending ? "Emitindo..." : "Emitir documento"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
