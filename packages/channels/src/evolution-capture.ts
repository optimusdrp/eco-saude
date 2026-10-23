/**
 * GRAVAÇÃO DOS WEBHOOKS REAIS DA EVOLUTION (para o piloto), SEM DADOS PESSOAIS
 *
 * No piloto com servidor e celular reais, o Tropi pode gravar cada webhook recebido
 * (EVOLUTION_CAPTURE_DIR). Os arquivos viram fixtures dos testes de packages/channels: assim os
 * testes passam a usar o formato REAL da Evolution, não o que a gente imagina.
 *
 * Nada pessoal chega ao disco: a anonimização acontece ANTES de gravar.
 *  - telefones e JIDs (5551...@s.whatsapp.net, ...@lid) viram números falsos estáveis
 *    (o mesmo número real vira sempre o mesmo falso durante a execução);
 *  - textos, legendas, nomes, nomes de arquivo e contatos (vCard) viram textos de teste;
 *  - chaves de criptografia, links e miniaturas dos arquivos, foto de perfil e apikey saem;
 *  - localização vira 0,0.
 * A estrutura (campos, tipos, aninhamento) fica igual: é isso que os testes precisam.
 */

type Json = Record<string, unknown>;

/** Campos que saem inteiros (segredos, links de arquivo, miniaturas, imagens de QR) */
const DROP = new Set([
  "mediaKey",
  "mediaKeyTimestamp",
  "fileSha256",
  "fileEncSha256",
  "sha256",
  "jpegThumbnail",
  "thumbnail",
  "thumbnailDirectPath",
  "thumbnailSha256",
  "thumbnailEncSha256",
  "directPath",
  "url",
  "staticUrl",
  "mediaUrl",
  "base64",
  "code",
  "pairingCode",
  "messageSecret",
  "deviceListMetadata",
  "senderKeyHash",
  "recipientKeyHash",
  "apikey",
  "api_key",
  "profilePictureUrl",
  "profilePicUrl",
  "server_url",
  "destination",
  "waveform",
  "streamingSidecar",
  "midQualityFileSha256",
  "scansSidecar",
  "scanLengths",
  "firstScanSidecar",
  "firstScanLength",
  "token",
]);

/** Campos de texto livre: o conteúdo some, o tipo fica */
const TEXT = new Set([
  "conversation",
  "text",
  "caption",
  "title",
  "description",
  "body",
  "comment",
  "footer",
  "contentText",
  "matchedText",
  "selectedDisplayText",
  "speechToText",
  "vcard",
  "address",
]);

/** Nomes de pessoas ou da clínica */
const NAMES = new Set(["pushName", "profileName", "name", "notifyName", "verifiedBizName", "displayName", "verifiedName"]);

const JID = /^(\d+(?:-\d+)?)(:\d+)?@(s\.whatsapp\.net|lid|c\.us|g\.us)$/;
const DIGITS = /^\+?\d{10,15}$/;
/** IDs internos da Evolution (UUID) não são dado pessoal */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anonimizador com memória: o mesmo número real vira sempre o mesmo número falso */
export function createEvolutionAnonymizer() {
  const phones = new Map<string, string>();
  const lids = new Map<string, string>();
  const instances = new Map<string, string>();
  // IDs da API oficial (wamid.HBgM...) levam o telefone codificado em base64: viram IDs de teste
  const wamids = new Map<string, string>();
  const fakePhone = (real: string) => {
    if (!phones.has(real)) phones.set(real, `555199000${String(phones.size + 1).padStart(4, "0")}`);
    return phones.get(real)!;
  };
  const groups = new Map<string, string>();
  const fakeGroup = (real: string) => {
    if (!groups.has(real)) groups.set(real, `90000000000000${String(groups.size + 1).padStart(4, "0")}`);
    return groups.get(real)!;
  };
  const fakeLid = (real: string) => {
    if (!lids.has(real)) lids.set(real, `9000000000${String(lids.size + 1).padStart(4, "0")}`);
    return lids.get(real)!;
  };

  function str(key: string, v: string): string {
    if (TEXT.has(key)) return v ? "texto de teste" : v;
    if (NAMES.has(key)) return v === "Você" ? v : v ? "Nome de teste" : v;
    if (key === "fileName" || key === "filename") {
      const ext = /\.[a-z0-9]{1,5}$/i.exec(v)?.[0] ?? "";
      return `arquivo-teste${ext.toLowerCase()}`;
    }
    if (key === "instance" || key === "instanceName") {
      if (!instances.has(v)) instances.set(v, instances.size ? `tropi-piloto-${instances.size + 1}` : "tropi-piloto");
      return instances.get(v)!;
    }
    if (v.startsWith("wamid.")) {
      if (!wamids.has(v)) wamids.set(v, `wamid.teste-${wamids.size + 1}`);
      return wamids.get(v)!;
    }
    if (UUID.test(v)) return v;
    const jid = JID.exec(v);
    if (jid) return `${jid[3] === "lid" ? fakeLid(jid[1]!) : jid[3] === "g.us" ? fakeGroup(jid[1]!) : fakePhone(jid[1]!)}${jid[2] ?? ""}@${jid[3]}`;
    if (DIGITS.test(v)) return fakePhone(v.replace(/\D/g, ""));
    // Números de telefone no meio de outro texto (ex.: "sender": "5551...@s.whatsapp.net" já foi acima)
    return v.replace(/\b\d{10,15}\b/g, (d) => fakePhone(d));
  }

  function walk(value: unknown, key = ""): unknown {
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === "object") {
      const out: Json = {};
      for (const [k, v] of Object.entries(value as Json)) {
        if (DROP.has(k)) continue;
        if (k === "degreesLatitude" || k === "degreesLongitude") {
          out[k] = 0;
          continue;
        }
        out[k] = walk(v, k);
      }
      return out;
    }
    if (typeof value === "string") return str(key, value);
    return value;
  }

  return { anonymize: (body: unknown) => walk(body) };
}

/**
 * Confere se sobrou algo que parece dado pessoal num webhook já anonimizado.
 * Devolve a lista de problemas (vazia = pode virar fixture).
 */
export function findPersonalData(body: unknown): string[] {
  const problems: string[] = [];
  const visit = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${path}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Json)) {
        if (DROP.has(k)) problems.push(`${path}.${k}: campo que deveria ter saído`);
        visit(x, `${path}.${k}`);
      }
      return;
    }
    if (typeof v !== "string" || UUID.test(v)) return;
    for (const d of v.match(/\d{10,15}/g) ?? []) {
      // Os falsos começam com 555199000 (telefone) ou 9000000000 (LID)
      if (!d.startsWith("555199000") && !d.startsWith("9000000000")) problems.push(`${path}: número que parece telefone (${d.slice(0, 4)}…)`);
    }
    if (/^data:image\//.test(v)) problems.push(`${path}: imagem embutida`);
    if (v.startsWith("wamid.") && !v.startsWith("wamid.teste-")) problems.push(`${path}: ID da API oficial (leva o telefone)`);
  };
  visit(body, "$");
  return problems;
}

/** Nome do arquivo de uma captura: evento, tipo e direção (ex.: messages.upsert-audioMessage-paciente) */
export function captureName(body: unknown): string {
  const root = (body && typeof body === "object" ? body : {}) as Json;
  const event = String(root.event ?? "evento").toLowerCase().replace(/_/g, ".");
  const data = (Array.isArray(root.data) ? root.data[0] : root.data) as Json | undefined;
  const type = typeof data?.messageType === "string" ? data.messageType : typeof data?.state === "string" ? data.state : typeof data?.status === "string" ? data.status : "";
  const key = (data?.key ?? {}) as Json;
  const who = event === "messages.upsert" ? (key.fromMe === true ? "celular" : "paciente") : "";
  return [event, type, who].filter(Boolean).join("-").replace(/[^a-zA-Z0-9.-]/g, "_");
}
