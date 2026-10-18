/**
 * Utilidades de arquivos para os adaptadores (download com limite de tamanho).
 */
import { ChannelError, type FetchLike } from "./types";

/**
 * Baixa um arquivo respeitando o limite. Recusa ANTES de baixar quando o provedor
 * informa o tamanho (content-length) e confere de novo depois.
 *  - 429/5xx/rede: vale tentar de novo (retryable)
 *  - 4xx e grande demais: não adianta repetir
 */
export async function fetchBytes(fetchFn: FetchLike, url: string, headers: Record<string, string>, maxBytes: number): Promise<{ bytes: Uint8Array; mime?: string }> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, { method: "GET", headers });
  } catch (error) {
    throw new ChannelError(`Falha de rede ao baixar o arquivo: ${(error as Error).message}`, true);
  }
  if (!res.ok) throw new ChannelError(`O provedor recusou o download (HTTP ${res.status}).`, res.status === 429 || res.status >= 500);
  const declared = Number(res.headers?.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ChannelError("Arquivo maior que o limite.", false);
  if (!res.arrayBuffer) throw new ChannelError("Download não suportado neste ambiente.", false);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new ChannelError("Arquivo maior que o limite.", false);
  return { bytes, mime: res.headers?.get("content-type")?.split(";")[0]?.trim() || undefined };
}

/** Blob para envio em multipart (FormData) */
export function toBlob(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes as BlobPart], { type: mime });
}
