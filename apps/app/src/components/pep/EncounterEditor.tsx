"use client";

import { bmi, VITALS, vitalAlerts, type Answers, type Diagnosis, type TemplateField, type VitalId } from "@ecosaude/core/pep";
import { AlertTriangle, Check, CloudOff, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { finalizeEncounterAction, saveDraftAction, type DraftPayload } from "@/modules/pep/actions";
import { CidPicker } from "./CidPicker";

/**
 * TELA DO ATENDIMENTO (rascunho)
 *
 * - Salva sozinho 1,5 s depois da última alteração (e ao sair da aba). O indicador mostra
 *   "Salvando / Salvo às 10:42 / Não salvo"; sem conexão, guarda e tenta de novo.
 * - Sinais vitais mostram IMC e alertas na hora (faixas de adulto).
 * - Finalizar: confirma, confere os obrigatórios do modelo e trava o registro (CFM 1.821).
 */

export interface EditorProps {
  id: string;
  version: number;
  fields: TemplateField[];
  answers: Answers;
  vitals: Record<string, number>;
  diagnoses: Diagnosis[];
  conduct: string | null;
  returnDays: number | null;
  returnNote: string | null;
  defaultReturnDays: number | null;
  age: number | null;
  sex: "F" | "M" | null;
  /** Regras da área do profissional (psicologia, por exemplo, não usa sinais vitais) */
  showVitals?: boolean;
  diagnosisLabel?: string;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error"; message: string };

const inputBase = "mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-pep aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-alert sm:min-h-10";

export function EncounterEditor(props: EditorProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(props.answers);
  const [vitals, setVitals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(props.vitals).map(([k, v]) => [k, String(v).replace(".", ",")])));
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>(props.diagnoses);
  const [conduct, setConduct] = useState(props.conduct ?? "");
  const [returnDays, setReturnDays] = useState(props.returnDays ? String(props.returnDays) : "");
  const [returnNote, setReturnNote] = useState(props.returnNote ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirm, setConfirm] = useState(false);
  const [finalMsg, setFinalMsg] = useState<string | null>(null);
  const [finishing, startFinish] = useTransition();

  const version = useRef(props.version);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const payload = useCallback(
    (): DraftPayload => ({
      answers,
      vitals,
      diagnoses,
      conduct: conduct || null,
      returnDays: returnDays ? Number(returnDays) : null,
      returnNote: returnNote || null,
    }),
    [answers, vitals, diagnoses, conduct, returnDays, returnNote],
  );
  const latest = useRef(payload);
  useEffect(() => {
    latest.current = payload;
  }, [payload]);

  const flush = useCallback(async () => {
    if (saving.current) await saving.current; // um salvamento por vez (a versão muda a cada um)
    if (!dirty.current) return;
    dirty.current = false;
    setSave({ kind: "saving" });
    const run = (async () => {
      const r = await saveDraftAction(props.id, version.current, latest.current()).catch(() => ({ ok: false, message: "Sem conexão. Tentando de novo..." }) as const);
      if (r.ok && "version" in r && r.version) {
        version.current = r.version;
        setErrors(r.errors ?? {});
        setSave({ kind: "saved", at: new Date() });
      } else {
        dirty.current = true;
        setSave({ kind: "error", message: r.message ?? "Não foi possível salvar." });
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [props.id]);

  // Toda alteração agenda um salvamento
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      touched.current = true;
      return;
    }
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1500);
  }, [answers, vitals, diagnoses, conduct, returnDays, returnNote, flush]);

  // Erro de conexão: tenta de novo a cada 8 s
  useEffect(() => {
    if (save.kind !== "error") return;
    const t = setTimeout(() => void flush(), 8000);
    return () => clearTimeout(t);
  }, [save, flush]);

  // Sair com alteração não salva: avisa o navegador; trocar de aba: salva na hora
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && dirty.current && void flush();
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [flush]);

  const numericVitals = Object.fromEntries(
    Object.entries(vitals)
      .map(([k, v]) => [k, Number(String(v).replace(",", "."))] as const)
      .filter(([, n]) => Number.isFinite(n) && n > 0),
  ) as Partial<Record<VitalId, number>>;
  const alerts = vitalAlerts(numericVitals, props.age);
  const imc = bmi(numericVitals);

  const finalize = () =>
    startFinish(async () => {
      if (timer.current) clearTimeout(timer.current);
      if (saving.current) await saving.current;
      const r = await finalizeEncounterAction(props.id, version.current, latest.current());
      if (r.ok) {
        dirty.current = false;
        setConfirm(false);
        router.refresh();
      } else {
        setErrors(r.errors ?? {});
        setFinalMsg(r.message ?? "Não foi possível finalizar.");
        if (r.errors && Object.keys(r.errors).length) setConfirm(false);
      }
    });

  const setAnswer = (id: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [id]: v }));

  return (
    <div className="space-y-5">
      {/* --------------------------- Anamnese / modelo --------------------------- */}
      <section aria-labelledby="sec-anamnese" className="rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
        <h2 id="sec-anamnese" className="sr-only">
          Anamnese e exame
        </h2>
        <div className="space-y-4">
          {props.fields.map((f) => (
            <TemplateInput key={f.id} field={f} value={answers[f.id]} error={errors[f.id]} onChange={(v) => setAnswer(f.id, v)} />
          ))}
        </div>
      </section>

      {/* ------------------------------ Sinais vitais ------------------------------ */}
      {props.showVitals !== false ? (
      <section aria-labelledby="sec-vitais" className="rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
        <h2 id="sec-vitais" className="text-lg font-bold">
          Sinais vitais
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {VITALS.map((v) => (
            <label key={v.id} className="block">
              <span className="text-sm font-semibold">
                {v.label.replace("Frequência", "Freq.").replace("Pressão sistólica", "PA sistólica").replace("Pressão diastólica", "PA diastólica")}
              </span>
              <span className="relative block">
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={vitals[v.id] ?? ""}
                  onChange={(e) => setVitals((s) => ({ ...s, [v.id]: e.target.value.replace(/[^0-9.,]/g, "") }))}
                  aria-invalid={!!errors[v.id]}
                  className={cn(inputBase, "pr-14 tabular")}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 text-xs text-ink-soft">{v.unit}</span>
              </span>
              {errors[v.id] ? <span className="mt-1 block text-xs font-semibold text-alert">{errors[v.id]}</span> : null}
            </label>
          ))}
          <div className="flex flex-col justify-end rounded-xl bg-fog px-3 py-2">
            <span className="text-sm font-semibold">IMC</span>
            <span className="tabular">{imc ? `${imc.value.toLocaleString("pt-BR")} ${imc.label.charAt(0).toLowerCase()}${imc.label.slice(1)}` : "Peso e altura"}</span>
          </div>
        </div>
        {alerts.length ? (
          <ul className="mt-3 space-y-1.5" aria-live="polite">
            {alerts.map((a) => (
              <li key={a.message} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-semibold", a.level === "urgente" ? "bg-alert-tint text-alert" : "bg-erp-tint text-erp-ink")}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {a.message}
              </li>
            ))}
          </ul>
        ) : null}
        {props.age !== null && props.age < 18 ? <p className="mt-2 text-xs text-ink-soft">Paciente menor de 18 anos: alertas automáticos desligados (faixas variam com a idade).</p> : null}
      </section>
      ) : null}

      {/* ------------------------------- Diagnóstico ------------------------------- */}
      <section aria-labelledby="sec-cid" className="rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
        <h2 id="sec-cid" className="text-lg font-bold">
          {props.diagnosisLabel ?? "Hipóteses diagnósticas (CID-10)"}
        </h2>
        <div className="mt-3">
          <CidPicker value={diagnoses} onChange={setDiagnoses} sex={props.sex} />
          {errors.diagnoses ? <p className="mt-1 text-sm font-semibold text-alert">{errors.diagnoses}</p> : null}
        </div>
      </section>

      {/* -------------------------------- Conduta -------------------------------- */}
      <section aria-labelledby="sec-conduta" className="rounded-2xl bg-paper p-4 ring-1 ring-line sm:p-5">
        <h2 id="sec-conduta" className="text-lg font-bold">
          Conduta e plano
        </h2>
        <label htmlFor="conduct" className="sr-only">
          Conduta
        </label>
        <textarea id="conduct" value={conduct} onChange={(e) => setConduct(e.target.value)} rows={5} className={cn(inputBase, "py-2.5")} placeholder="Orientações, prescrições, exames pedidos, encaminhamentos." />
        <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <label className="block">
            <span className="text-sm font-semibold">Retorno em (dias)</span>
            <input inputMode="numeric" value={returnDays} onChange={(e) => setReturnDays(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder={props.defaultReturnDays ? String(props.defaultReturnDays) : "Sem retorno"} className={cn(inputBase, "tabular")} aria-invalid={!!errors.returnDays} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Observação do retorno</span>
            <input value={returnNote} onChange={(e) => setReturnNote(e.target.value)} maxLength={300} placeholder="Ex.: trazer exames" className={inputBase} />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[7, 15, 30, 60, 90, 180, 365].map((d) => (
            <button key={d} type="button" onClick={() => setReturnDays(String(d))} className={cn("min-h-9 rounded-full px-3 text-sm ring-1 tabular", returnDays === String(d) ? "bg-pep text-white ring-pep" : "ring-line hover:ring-ink/30")}>
              {d < 30 ? `${d} dias` : d === 365 ? "1 ano" : `${d / 30} ${d === 30 ? "mês" : "meses"}`}
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------ Barra de salvar e finalizar ------------------------ */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 rounded-2xl bg-night px-4 py-3 text-white shadow-xl lg:bottom-4">
        <SaveIndicator state={save} />
        <button type="button" onClick={() => (setFinalMsg(null), setConfirm(true))} className={buttonStyles("sun", "ml-auto")}>
          <Lock className="size-4" aria-hidden />
          Finalizar atendimento
        </button>
      </div>

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Finalizar atendimento?">
        <div className="space-y-4">
          <p>Depois de finalizado, o registro não pode mais ser alterado (Resolução CFM 1.821/2007). Correções e complementos entram como adendo, com data e autor.</p>
          {returnDays ? <p className="text-sm text-ink-soft">O retorno em {returnDays} dias vira uma tarefa para a recepção agendar.</p> : null}
          {finalMsg ? (
            <p role="alert" className="rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
              {finalMsg}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setConfirm(false)} className={buttonStyles("ghost")}>
              Continuar editando
            </button>
            <button type="button" onClick={finalize} disabled={finishing} aria-busy={finishing} className={buttonStyles("sun")}>
              {finishing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
              {finishing ? "Finalizando..." : "Finalizar e travar"}
            </button>
          </div>
        </div>
      </Dialog>
      {finalMsg && !confirm ? (
        <p role="alert" className="rounded-xl bg-alert-tint px-3 py-2 text-sm font-semibold text-alert">
          {finalMsg}
        </p>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-white/80">
      {state.kind === "saving" ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Salvando...
        </>
      ) : state.kind === "saved" ? (
        <>
          <Check className="size-4 text-ok-tint" aria-hidden />
          Salvo às {state.at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </>
      ) : state.kind === "error" ? (
        <>
          <CloudOff className="size-4 text-sun" aria-hidden />
          <span className="truncate">{state.message}</span>
        </>
      ) : (
        <span className="hidden sm:inline">Rascunho salvo automaticamente</span>
      )}
    </p>
  );
}

/* --------------------------- Campo do modelo --------------------------- */

function TemplateInput({ field: f, value, error, onChange }: { field: TemplateField; value: Answers[string] | undefined; error?: string; onChange: (v: Answers[string]) => void }) {
  const id = `f-${f.id}`;
  if (f.type === "titulo") return <h3 className="border-t border-line pt-4 text-lg font-bold first:border-0 first:pt-0">{f.label}</h3>;
  const label = (
    <span className="text-sm font-semibold">
      {f.label}
      {f.required ? <span className="text-alert"> *</span> : null}
      {f.unit ? <span className="font-normal text-ink-soft"> ({f.unit})</span> : null}
    </span>
  );
  const hint = f.hint && !error ? <span className="mt-1 block text-xs text-ink-soft">{f.hint}</span> : null;
  const err = error ? (
    <span id={`${id}-erro`} className="mt-1 block text-sm font-semibold text-alert">
      {error}
    </span>
  ) : null;
  const aria = { "aria-invalid": !!error, "aria-describedby": error ? `${id}-erro` : undefined };

  switch (f.type) {
    case "texto":
    case "numero":
      return (
        <label htmlFor={id} className="block">
          {label}
          <input id={id} inputMode={f.type === "numero" ? "decimal" : undefined} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} className={inputBase} {...aria} />
          {hint}
          {err}
        </label>
      );
    case "texto_longo":
      return (
        <label htmlFor={id} className="block">
          {label}
          <textarea id={id} rows={4} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={cn(inputBase, "field-sizing-content min-h-24 py-2.5")} {...aria} />
          {hint}
          {err}
        </label>
      );
    case "escolha":
    case "sim_nao": {
      const opts = f.type === "sim_nao" ? ["Sim", "Não"] : (f.options ?? []);
      const cur = f.type === "sim_nao" ? (value === true ? "Sim" : value === false ? "Não" : "") : ((value as string) ?? "");
      return (
        <fieldset {...aria}>
          <legend>{label}</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {opts.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={cur === o}
                onClick={() => onChange(cur === o ? null : f.type === "sim_nao" ? o === "Sim" : o)}
                className={cn("min-h-10 rounded-full px-3.5 text-sm font-semibold ring-1", cur === o ? "bg-pep text-white ring-pep" : "bg-paper ring-line hover:ring-ink/30")}
              >
                {o}
              </button>
            ))}
          </div>
          {hint}
          {err}
        </fieldset>
      );
    }
    case "multipla": {
      const cur = Array.isArray(value) ? value : [];
      return (
        <fieldset {...aria}>
          <legend>{label}</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(f.options ?? []).map((o) => {
              const on = cur.includes(o);
              return (
                <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? cur.filter((x) => x !== o) : [...cur, o])} className={cn("min-h-10 rounded-full px-3.5 text-sm font-semibold ring-1", on ? "bg-pep-tint text-pep-ink ring-pep/40" : "bg-paper ring-line hover:ring-ink/30")}>
                  {o}
                </button>
              );
            })}
          </div>
          {hint}
          {err}
        </fieldset>
      );
    }
    case "escala": {
      const cur = typeof value === "number" ? value : value === undefined || value === null || value === "" ? null : Number(value);
      return (
        <fieldset {...aria}>
          <legend>{label}</legend>
          <div className="mt-1 grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" aria-pressed={cur === n} onClick={() => onChange(cur === n ? null : n)} className={cn("min-h-10 rounded-lg text-sm font-semibold tabular ring-1", cur === n ? "bg-pep text-white ring-pep" : "bg-paper ring-line hover:ring-ink/30")}>
                {n}
              </button>
            ))}
          </div>
          {hint}
          {err}
        </fieldset>
      );
    }
  }
}
