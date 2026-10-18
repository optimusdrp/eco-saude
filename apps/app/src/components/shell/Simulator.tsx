"use client";

import { ATTACHMENT_ACCEPT, CHANNEL_LABEL, formatBytes, type Channel } from "@ecosaude/core/crm";
import { Radio, Smartphone, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Field, FormMessage, SelectField, TextareaField } from "@/components/ui";
import { channelDot } from "@/components/ui/server";
import { buttonStyles, cn } from "@/components/ui/styles";
import { useAppEvent } from "@/lib/hooks";
import { simulateInboundAction } from "@/modules/crm/actions/simulator";
import { ago } from "@/modules/crm/format";

/**
 * SIMULADOR DE CANAIS (só aparece com canais em modo simulação)
 *
 * Lado "paciente" da conversa: manda mensagens como se fosse alguém no
 * WhatsApp, Telegram, Instagram ou Messenger, e mostra o que o paciente
 * "recebeu" da clínica, com respostas rápidas (SIM, 1, 2, nota...).
 * Tudo passa pelo mesmo caminho da integração real (ver actions/simulator.ts).
 */
interface SimData {
  channels: { channel: Channel; displayName: string | null }[];
  identities: { channel: Channel; externalId: string; name: string; contactId: string }[];
  outbound: { id: string; channel: Channel; body: string; status: string; kind: string | null; at: string; contactName: string; externalId: string | null }[];
}

/** Respostas prontas conforme o tipo de mensagem recebida */
const QUICK: Record<string, string[]> = {
  slot_offer: ["SIM", "Não posso"],
  confirmation: ["1", "2"],
  nps: ["10", "8", "4"],
  default: ["Obrigado!", "SAIR"],
};

export function Simulator() {
  const inThread = /^\/crm\/conversas\/[0-9a-f-]{36}/.test(usePathname() ?? "");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SimData | null>(null);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [who, setWho] = useState("novo");
  const [state, action] = useActionState(simulateInboundAction, {});
  const [pending, startTransition] = useTransition();
  // Anexo OPCIONAL: fica no estado para não sumir se o envio der erro (ex.: telefone inválido)
  const [simFile, setSimFile] = useState<File | null>(null);
  const [simFileKey, setSimFileKey] = useState(0);
  // A cada envio bem-sucedido, o campo de mensagem é recriado (fica vazio)
  const [lastState, setLastState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (state !== lastState) {
    setLastState(state);
    if (state.ok) {
      setFormKey((k) => k + 1);
      setSimFile(null);
      setSimFileKey((k) => k + 1);
    }
  }

  useAppEvent("eco:open-simulator", () => setOpen(true));

  const load = useCallback(() => {
    fetch("/api/simulador")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SimData | null) => d && setData(d))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load, state]);

  // Depois de cada envio: atualiza a tela do atendente
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const people = data?.identities.filter((i) => i.channel === channel) ?? [];
  const selected = people.find((p) => p.externalId === who);

  /** Responde como o paciente com um clique (SIM, 1, nota...). */
  const quickReply = (msg: SimData["outbound"][number], text: string) => {
    if (!msg.externalId) return;
    const form = new FormData();
    form.set("channel", msg.channel);
    form.set("externalId", msg.externalId);
    form.set("name", msg.contactName);
    form.set("text", text);
    startTransition(() => action(form));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Simulador de canais"
        className={cn(
          "fixed z-30 hidden items-center gap-2 rounded-full bg-night text-sm font-semibold text-white shadow-xl hover:bg-night-soft lg:inline-flex",
          // Dentro de uma conversa: só o ícone, acima da caixa de resposta (não cobre o "Enviar")
          inThread ? "right-5 bottom-40 p-3" : "right-5 bottom-5 px-4 py-3",
        )}
      >
        <Radio className="size-4" aria-hidden />
        <span className={inThread ? "sr-only" : undefined}>Simulador de canais</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-labelledby="sim-title">
          <button type="button" aria-label="Fechar simulador" className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-3xl bg-night text-white sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[26rem] sm:rounded-none">
            <header className="flex items-start gap-3 border-b border-white/10 p-4">
              <Smartphone className="mt-1 size-5 text-erp" aria-hidden />
              <div className="flex-1">
                <h2 id="sim-title" className="text-lg font-bold">
                  Simulador de canais
                </h2>
                <p className="text-sm text-white/70">Você é o paciente. A mensagem passa pelo mesmo caminho da integração real.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="inline-flex size-10 items-center justify-center rounded-xl hover:bg-white/10">
                <X aria-hidden />
              </button>
            </header>

            <div className="thin-scroll flex-1 space-y-5 overflow-y-auto p-4">
              <form
                // Envio manual: o anexo escolhido não some se o envio der erro
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  if (simFile) fd.set("file", simFile);
                  startTransition(() => action(fd));
                }}
                className="space-y-3 rounded-2xl bg-white p-4 text-ink"
                noValidate
              >
                <FormMessage state={state} />
                <SelectField
                  label="Canal"
                  name="channel"
                  id="sim-channel"
                  value={channel}
                  onChange={(e) => {
                    setChannel(e.target.value as Channel);
                    setWho("novo");
                  }}
                >
                  {(data?.channels.length ? data.channels : [{ channel: "whatsapp" as Channel, displayName: null }]).map((c) => (
                    <option key={c.channel} value={c.channel}>
                      {CHANNEL_LABEL[c.channel]}
                      {c.displayName ? ` (${c.displayName})` : ""}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Quem envia" name="_who" id="sim-who" value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="novo">Uma pessoa nova</option>
                  {people.map((p) => (
                    <option key={p.externalId} value={p.externalId}>
                      {p.name}
                    </option>
                  ))}
                </SelectField>
                {selected ? (
                  <>
                    <input type="hidden" name="externalId" value={selected.externalId} />
                    <input type="hidden" name="name" value={selected.name} />
                  </>
                ) : (
                  <div key={`novo-${formKey}`} className="grid grid-cols-2 gap-3">
                    <Field
                      label={channel === "whatsapp" ? "Telefone" : "Usuário"}
                      name="externalId"
                      id="sim-external"
                      placeholder={channel === "whatsapp" ? "5551999990000" : "@usuario"}
                      defaultValue={state.ok ? "" : state.values?.externalId}
                      error={state.errors?.externalId}
                    />
                    <Field label="Nome no perfil" name="name" id="sim-name" defaultValue={state.ok ? "" : state.values?.name} />
                  </div>
                )}
                <TextareaField
                  label="Mensagem"
                  name="text"
                  id="sim-text"
                  key={`texto-${formKey}`}
                  placeholder="Ex.: Oi, queria marcar uma consulta"
                  hint="Pode ficar vazia se for mandar só um arquivo."
                  error={state.errors?.text}
                />
                {/* Anexo opcional: foto de exame, PDF, áudio... (passa pela mesma conferência do canal real) */}
                <div>
                  <label htmlFor="sim-file" className="block text-sm font-semibold">
                    Anexo (opcional)
                  </label>
                  <input
                    key={`arquivo-${simFileKey}`}
                    id="sim-file"
                    type="file"
                    accept={ATTACHMENT_ACCEPT}
                    onChange={(e) => setSimFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-sm file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-fog file:px-3 file:font-semibold file:text-ink hover:file:bg-crm-tint"
                  />
                  {simFile ? (
                    <p className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
                      {simFile.name}, {formatBytes(simFile.size)}
                      <button
                        type="button"
                        onClick={() => {
                          setSimFile(null);
                          setSimFileKey((k) => k + 1);
                        }}
                        className="font-semibold text-crm hover:underline"
                      >
                        Tirar
                      </button>
                    </p>
                  ) : null}
                </div>
                <button type="submit" disabled={pending} className={cn(buttonStyles("primary"), "w-full")}>
                  {pending ? "Enviando..." : "Enviar como paciente"}
                </button>
              </form>

              <section>
                <h3 className="font-display font-bold">Celular do paciente</h3>
                <p className="text-sm text-white/65">O que a clínica enviou. Responda com um toque.</p>
                <ul className="mt-3 space-y-2">
                  {data?.outbound.length === 0 ? <li className="text-sm text-white/60">Nenhuma mensagem enviada ainda.</li> : null}
                  {data?.outbound.map((m) => (
                    <li key={m.id} className="rounded-2xl bg-white/8 p-3">
                      <p className="flex items-center gap-2 text-xs text-white/70">
                        <span className={cn("size-2 rounded-full", channelDot[m.channel])} aria-hidden />
                        Para {m.contactName}, {CHANNEL_LABEL[m.channel]}, {ago(new Date(m.at))}
                      </p>
                      <p className="mt-1 text-sm">{m.body}</p>
                      {m.externalId ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(QUICK[m.kind ?? "default"] ?? QUICK.default!).map((t) => (
                            <button
                              key={t}
                              type="button"
                              disabled={pending}
                              onClick={() => quickReply(m, t)}
                              className="min-h-9 rounded-full bg-white px-3 text-sm font-semibold text-night hover:bg-crm-tint disabled:opacity-50"
                            >
                              Responder “{t}”
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
