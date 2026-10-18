import { CHANNELS, type Channel } from "@ecosaude/core/crm";
import { defaultSort, INBOX_FILTERS, INBOX_PAGE, INBOX_SORTS, type InboxFilter, type InboxSort } from "@/modules/crm/inbox";

/**
 * Lê os filtros da URL com valores seguros:
 *   ?filtro=abertas&canal=whatsapp&q=ana&ordem=recentes&mais=2
 * (q = busca por nome/telefone; ordem = espera|recentes; mais = quantas "páginas" carregar)
 */
export interface InboxSearchParams {
  filtro?: string;
  canal?: string;
  q?: string;
  mais?: string;
  ordem?: string;
}

export function inboxParams(sp: InboxSearchParams): { filter: InboxFilter; channel?: Channel; q?: string; limit: number; sort: InboxSort } {
  const filter = sp.filtro && sp.filtro in INBOX_FILTERS ? (sp.filtro as InboxFilter) : "esperando";
  const channel = CHANNELS.includes(sp.canal as Channel) ? (sp.canal as Channel) : undefined;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const pages = Math.min(20, Math.max(1, Number(sp.mais) || 1));
  const sort = sp.ordem && sp.ordem in INBOX_SORTS ? (sp.ordem as InboxSort) : defaultSort(filter);
  return { filter, channel, q, limit: pages * INBOX_PAGE, sort };
}
