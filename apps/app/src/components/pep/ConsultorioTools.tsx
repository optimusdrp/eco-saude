"use client";

import { VITALS, vitalAlerts, type Vitals } from "@ecosaude/core/pep";
import { Activity, AlertTriangle, BellRing, RefreshCw, Undo2, UserCheck, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Dialog, FormMessage, SubmitButton, TextareaField } from "@/components/ui";
import { buttonStyles, cn } from "@/components/ui/styles";
import { emit } from "@/lib/events";
import { consultorioArrivalAction, saveTriageAction } from "@/modules/pep/actions";

/**
 * Peças do navegador do Consultório:
 *  - AutoRefresh: a lista se atualiza sozinha (a recepção marca a chegada em outra tela)
 *  - TriageButton: pré-consulta com sinais vitais, prioridade e alertas na hora
 *  - UrgentWatch: faixa vermelha com os pacientes de triagem urgente esperando, e som opcional
 *    quando aparece um novo
 */

/**
 * Recarrega os dados da tela a cada `seconds` enquanto a aba estiver visível.
 * A hora sai no fuso da CLÍNICA (`timeZone`, vindo do servidor): servidor e navegador
 * desenham o mesmo texto, sem erro de hidratação quando o servidor roda em UTC.
 */
export function AutoRefresh({ seconds = 30, timeZone }: { seconds?: number; timeZone: string }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setAt(new Date());
    };
    const t = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return (
    <button
      type="button"
      onClick={() => {
        router.refresh();
        setAt(new Date());
      }}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-ink-soft hover:bg-ink/5 hover:text-ink"
      title="Atualiza sozinho a cada 30 segundos"
    >
      <RefreshCw className="size-4" aria-hidden />
      {/* suppressHydrationWarning: o minuto pode virar entre o servidor e o navegador */}
      <span suppressHydrationWarning>Atualizado às {at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone })}</span>
    </button>
  );
}

const PRIORITIES = [
  { id: "normal", label: "Normal", tone: "ring-line" },
  { id: "prioritario", label: "Prioritário", tone: "ring-erp/50" },
  { id: "urgente", label: "Urgente", tone: "ring-alert/50" },
] as const;

export interface TriageInitial {
  complaint: string | null;
  vitals: Vitals;
  priority: "normal" | "prioritario" | "urgente";
  notes: string | null;
}

export function TriageButton({ appointmentId, patient, age, initial, compact = false }: { appointmentId: string; patient: string; age: number | null; initial: TriageInitial | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveTriageAction, {});
  const [vitals, setVitals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial?.vitals ?? {}).map(([k, v]) => [k, String(v).replace(".", ",")])));
  const [priority, setPriority] = useState<TriageInitial["priority"]>(initial?.priority ?? "normal");

  // Salvou: fecha (ajuste durante a renderização, sem efeito)
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    if (state.ok) setOpen(false);
  }

  const numeric = Object.fromEntries(
    Object.entries(vitals)
      .map(([k, v]) => [k, Number(v.replace(",", "."))] as const)
      .filter(([, n]) => Number.isFinite(n) && n > 0),
  ) as Vitals;
  const alerts = vitalAlerts(numeric, age);
  const urgentAlert = alerts.some((a) => a.level === "urgente");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonStyles(initial ? "ghost" : "secondary", compact ? "min-h-10 px-3" : undefined)}>
        <Activity className="size-4" aria-hidden />
        {initial ? "Triagem" : "Fazer triagem"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Triagem: ${patient}`} description="Pré-consulta. Os sinais vitais entram no atendimento do profissional." wide>
        <form action={action} className="space-y-4">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <label className="block">
            <span className="text-sm font-semibold">Queixa principal</span>
            <input name="complaint" defaultValue={state.values?.complaint ?? initial?.complaint ?? ""} maxLength={500} className="mt-1 block min-h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-pep" placeholder="Ex.: dor de cabeça há 3 dias" />
          </label>

          <fieldset>
            <legend className="text-sm font-semibold">Sinais vitais</legend>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {VITALS.map((v) => (
                <label key={v.id} className="block">
                  <span className="text-xs font-semibold text-ink-soft">{v.label.replace("Frequência", "Freq.").replace("Pressão sistólica", "PA sistólica").replace("Pressão diastólica", "PA diastólica")}</span>
                  <span className="relative block">
                    <input
                      name={`v_${v.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={vitals[v.id] ?? ""}
                      onChange={(e) => setVitals((s) => ({ ...s, [v.id]: e.target.value.replace(/[^0-9.,]/g, "") }))}
                      aria-invalid={!!state.errors?.[v.id]}
                      className="mt-0.5 block min-h-11 w-full rounded-xl bg-paper pr-12 pl-3 tabular ring-1 ring-line outline-none focus:ring-2 focus:ring-pep aria-[invalid=true]:ring-alert sm:min-h-10"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 text-xs text-ink-soft">{v.unit}</span>
                  </span>
                  {state.errors?.[v.id] ? <span className="mt-0.5 block text-xs font-semibold text-alert">{state.errors[v.id]}</span> : null}
                </label>
              ))}
            </div>
            {alerts.length ? (
              <ul className="mt-2 space-y-1" aria-live="polite">
                {alerts.map((a) => (
                  <li key={a.message} className={cn("flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold", a.level === "urgente" ? "bg-alert-tint text-alert" : "bg-erp-tint text-erp-ink")}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {a.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold">Prioridade</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {PRIORITIES.map((p) => (
                <label key={p.id} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 ring-1 has-[:checked]:font-semibold", p.tone, priority === p.id && (p.id === "urgente" ? "bg-alert-tint text-alert" : p.id === "prioritario" ? "bg-erp-tint text-erp-ink" : "bg-pep-tint text-pep-ink"))}>
                  <input type="radio" name="priority" value={p.id} checked={priority === p.id} onChange={() => setPriority(p.id)} className="size-4 accent-[var(--color-pep)]" />
                  {p.label}
                </label>
              ))}
            </div>
            {urgentAlert && priority !== "urgente" ? <p className="mt-1 text-sm font-semibold text-alert">Há sinal vital de urgência: considere prioridade urgente e avise o profissional agora.</p> : null}
          </fieldset>

          <TextareaField label="Observações" name="notes" id={`tr-notes-${appointmentId}`} defaultValue={state.values?.notes ?? initial?.notes ?? ""} rows={2} />
          <FormMessage state={state} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setOpen(false)} className={buttonStyles("ghost")}>
              Cancelar
            </button>
            <SubmitButton className="bg-pep hover:bg-pep-ink" pendingText="Salvando...">
              Salvar triagem
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* ------------------------------- Triagem urgente ------------------------------- */

const SOUND_KEY = "tropi:som-triagem-urgente";
const SEEN_KEY = "tropi:triagens-urgentes-vistas";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/**
 * Dois bipes curtos gerados no navegador (sem arquivo de áudio).
 * Navegadores só tocam som depois que a pessoa clicou em algo na página: se ainda não
 * clicou, o som é pulado sem erro (a faixa vermelha e o sino continuam avisando).
 */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    [0, 0.28].forEach((start) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.24);
    });
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1000);
  } catch {
    // Sem áudio neste aparelho: segue só com o aviso visual
  }
}

/**
 * Faixa de triagem urgente no Consultório. Recebe do servidor os pacientes urgentes que ainda
 * esperam atendimento (a tela se atualiza a cada 30 s). Quando aparece um que esta aba ainda
 * não tinha visto: bipe (se o som estiver ligado neste aparelho) e o sino consulta na hora.
 */
export function UrgentWatch({ patients }: { patients: { appointmentId: string; name: string; time: string; professional: string | null }[] }) {
  const [sound, setSound] = useState(false);
  const first = useRef(true);
  const ids = patients.map((p) => p.appointmentId).join(",");

  useEffect(() => {
    // Preferência do aparelho (lida depois de montar: o servidor não conhece o localStorage)
    const on = readFlag(SOUND_KEY);
    let seen: string[] = [];
    try {
      seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[];
    } catch {
      seen = [];
    }
    const current = ids ? ids.split(",") : [];
    const fresh = current.filter((id) => !seen.includes(id));
    if (fresh.length) {
      if (on) beep();
      emit("eco:notices-refresh");
    }
    try {
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen, ...current])].slice(-200)));
    } catch {
      // Navegação privada: sem memória entre recargas, só repete o bipe
    }
    if (first.current) {
      first.current = false;
      if (on) window.setTimeout(() => setSound(true), 0);
    }
  }, [ids]);

  function toggle() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    } catch {
      // Sem armazenamento: vale só até recarregar
    }
    if (next) beep(); // o clique libera o áudio e confirma o volume
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      {patients.length ? (
        <section role="alert" aria-label="Triagem urgente" className="rounded-2xl bg-alert-tint p-3 ring-1 ring-alert/40 sm:p-4">
          <p className="flex items-center gap-2 font-semibold text-alert">
            <BellRing className="size-5 shrink-0 motion-safe:animate-pulse" aria-hidden />
            {patients.length === 1 ? "Paciente com triagem urgente esperando" : `${patients.length} pacientes com triagem urgente esperando`}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {patients.map((p) => (
              <li key={p.appointmentId}>
                <span className="font-semibold">{p.name}</span>
                <span className="text-ink-soft">
                  {" "}
                  {p.time}
                  {p.professional ? `, ${p.professional}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <button type="button" onClick={toggle} aria-pressed={sound} className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-sm text-ink-soft hover:bg-ink/5 hover:text-ink">
        {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
        {sound ? "Som de triagem urgente ligado neste aparelho" : "Ligar som para triagem urgente"}
      </button>
    </div>
  );
}

/* ------------------------------ Chegada (sem recepção) ------------------------------ */

/**
 * "Chegou" na linha do paciente (clínica sem recepção) e "Desfazer" para um toque errado.
 * Antes de 30 min do horário o botão aparece desabilitado, dizendo a partir de quando vale.
 * A mensagem de erro (ex.: alguém mudou a consulta ao mesmo tempo) aparece logo abaixo.
 */
export function ArrivalButton({ mode, appointmentId, version, patient, opensAt }: { mode: "chegou" | "desfazer"; appointmentId: string; version: number; patient: string; opensAt: string | null }) {
  const [state, action] = useActionState(consultorioArrivalAction, {});
  const undo = mode === "desfazer";
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={appointmentId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="undo" value={undo ? "1" : "0"} />
      {undo ? (
        <SubmitButton variant="ghost" pendingText="Desfazendo..." className="min-h-10 px-3 text-ink-soft" aria-label={`Desfazer chegada de ${patient}`}>
          <Undo2 className="size-4" aria-hidden />
          Desfazer
        </SubmitButton>
      ) : (
        <SubmitButton variant="secondary" pendingText="Marcando..." disabled={!!opensAt} className="min-h-10 px-3" aria-label={`Marcar que ${patient} chegou`}>
          <UserCheck className="size-4" aria-hidden />
          Chegou
        </SubmitButton>
      )}
      {opensAt && !undo ? <span className="text-xs text-ink-soft">a partir das {opensAt}</span> : null}
      {state.ok === false && state.message ? (
        <span role="alert" className="max-w-56 text-right text-xs font-semibold text-alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
