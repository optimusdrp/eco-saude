/**
 * Nome amigável do aparelho a partir do "user agent" do navegador
 * (usado na lista de aparelhos conectados; roda no servidor).
 */
/** Ex.: "Mozilla/5.0 (Windows NT 10.0...) Chrome/131" -> "Chrome no Windows" */
export function describeDevice(ua: string | null): string {
  if (!ua) return "Navegador desconhecido";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "outro sistema";
  return `${browser} no ${os}`;
}
