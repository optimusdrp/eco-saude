/**
 * Eventos do navegador para componentes conversarem sem estado global.
 * Ex.: um botão em qualquer tela abre o trilho do paciente ou o simulador.
 */
/** Horário livre já formatado (o mesmo formato de /api/agenda/horarios) */
export interface FreeSlot {
  startsAt: string;
  date: string;
  time: string;
  label: string;
}

/**
 * "Agendar pelo pedido": o que foi entendido da conversa e os horários livres
 * que batem com o pedido (calculados pela agenda real, nunca pela IA).
 */
export interface ScheduleSuggestion {
  id: string;
  source: "ia" | "regras";
  fallbackReason: string | null;
  /** "quinta, 15/10", "à tarde", "Dra. Beatriz Lemos", "Clareamento" */
  chips: string[];
  /** Trecho da mensagem que decidiu */
  quote: string | null;
  warnings: string[];
  /** Profissional dos horários abaixo */
  professionalId: string;
  period: "manha" | "tarde" | "qualquer";
  /** Procedimento pedido ("Clareamento") */
  service: string | null;
  slots: FreeSlot[];
  /** Horário exato pedido e livre: já vem marcado (a recepção ainda confirma) */
  preselect: { date: string; time: string } | null;
}

export interface AppEvents {
  "eco:open-patient": string;
  "eco:open-commands": undefined;
  "eco:open-simulator": undefined;
  "eco:open-schedule": { contactId?: string; contactName?: string; conversationId?: string; professionalId?: string; service?: string; date?: string; time?: string; suggestion?: ScheduleSuggestion };
  "eco:fill-composer": { body: string; templateId?: string };
}

export function emit<K extends keyof AppEvents>(name: K, detail?: AppEvents[K]) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function listen<K extends keyof AppEvents>(name: K, handler: (detail: AppEvents[K]) => void): () => void {
  const wrapped = (event: Event) => handler((event as CustomEvent<AppEvents[K]>).detail);
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}
