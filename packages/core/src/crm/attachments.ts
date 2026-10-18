/**
 * ANEXOS DAS CONVERSAS (regras puras)
 *
 * Pacientes mandam foto de exame, receita, comprovante, áudio. Isso é dado de saúde:
 *  - O TIPO do arquivo é decidido pelo CONTEÚDO (os primeiros bytes), nunca pelo nome
 *    ou pelo que o remetente diz. "exame.pdf" que na verdade é um executável é recusado.
 *  - Lista FECHADA de tipos: imagem, PDF, áudio, vídeo e documentos do Office.
 *    Fora dela (SVG, HTML, executáveis, compactados...) é recusado: SVG e HTML podem
 *    carregar script; executável não tem por que chegar a uma clínica.
 *  - Limite de 16 MB por arquivo (o limite de áudio e vídeo do WhatsApp).
 *  - O nome original é só um rótulo: limpo, curto e nunca usado como caminho.
 */

export const ATTACHMENT_KINDS = ["image", "audio", "video", "document"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  image: "imagem",
  audio: "áudio",
  video: "vídeo",
  document: "documento",
};

/** Limite por arquivo: 16 MB */
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

export interface DetectedFile {
  mime: string;
  kind: AttachmentKind;
  ext: string;
  /**
   * Pode abrir no navegador (imagem, áudio, vídeo, PDF)? Os demais só baixam,
   * para o navegador nunca "interpretar" um documento de terceiros.
   */
  inline: boolean;
}

const at = (b: Uint8Array, offset: number, sig: number[]) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, offset: number, len: number) => String.fromCharCode(...b.slice(offset, offset + len));

/**
 * Tipo REAL do arquivo pelos primeiros bytes ("assinatura"). Null = não aceito.
 * `declaredMime` só desempata casos ambíguos do mesmo formato (MP4 de áudio x vídeo;
 * ZIP do Word x Excel), nunca transforma um tipo recusado em aceito.
 */
export function detectFileType(bytes: Uint8Array, declaredMime?: string | null, fileName?: string | null): DetectedFile | null {
  const b = bytes;
  if (b.length < 4) return null;
  const decl = (declaredMime ?? "").toLowerCase();
  const name = (fileName ?? "").toLowerCase();

  // Imagens
  if (at(b, 0, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", kind: "image", ext: "jpg", inline: true };
  if (at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", kind: "image", ext: "png", inline: true };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { mime: "image/webp", kind: "image", ext: "webp", inline: true };
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return { mime: "image/gif", kind: "image", ext: "gif", inline: true };

  // PDF
  if (ascii(b, 0, 5) === "%PDF-") return { mime: "application/pdf", kind: "document", ext: "pdf", inline: true };

  // Áudio
  if (ascii(b, 0, 4) === "OggS") return { mime: "audio/ogg", kind: "audio", ext: "ogg", inline: true }; // nota de voz do WhatsApp (opus)
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0)) return { mime: "audio/mpeg", kind: "audio", ext: "mp3", inline: true };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return { mime: "audio/wav", kind: "audio", ext: "wav", inline: true };
  if (ascii(b, 0, 5) === "#!AMR") return { mime: "audio/amr", kind: "audio", ext: "amr", inline: false };
  if (at(b, 0, [0xff, 0xf1]) || at(b, 0, [0xff, 0xf9])) return { mime: "audio/aac", kind: "audio", ext: "aac", inline: true };

  // MP4/M4A/MOV/HEIC (caixa "ftyp" no byte 4)
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4).toLowerCase();
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1") || brand.startsWith("heif")) {
      // Foto de iPhone: guardamos, mas a maioria dos navegadores não mostra; vai para baixar
      return { mime: "image/heic", kind: "image", ext: "heic", inline: false };
    }
    if (brand.startsWith("m4a") || decl.startsWith("audio/")) return { mime: "audio/mp4", kind: "audio", ext: "m4a", inline: true };
    if (brand.startsWith("qt")) return { mime: "video/quicktime", kind: "video", ext: "mov", inline: false };
    return { mime: "video/mp4", kind: "video", ext: "mp4", inline: true };
  }

  // Word/Excel/PowerPoint novos (ZIP) e antigos (OLE): só para baixar
  if (at(b, 0, [0x50, 0x4b, 0x03, 0x04])) {
    const hint = decl + " " + name;
    if (/wordprocessingml|\.docx\b/.test(hint)) return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document", ext: "docx", inline: false };
    if (/spreadsheetml|\.xlsx\b/.test(hint)) return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document", ext: "xlsx", inline: false };
    if (/presentationml|\.pptx\b/.test(hint)) return { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document", ext: "pptx", inline: false };
    return null; // ZIP genérico: pode conter qualquer coisa
  }
  if (at(b, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const hint = decl + " " + name;
    if (/msword|\.doc\b/.test(hint)) return { mime: "application/msword", kind: "document", ext: "doc", inline: false };
    if (/ms-excel|\.xls\b/.test(hint)) return { mime: "application/vnd.ms-excel", kind: "document", ext: "xls", inline: false };
    return null;
  }
  return null;
}

/** Explicação para quem tentou enviar um arquivo recusado */
export const REJECTED_FILE_MESSAGE = "Tipo de arquivo não aceito. Envie imagem (JPG, PNG), PDF, áudio, vídeo ou documento do Word/Excel.";

/**
 * Nome de arquivo seguro para mostrar e para o download: sem pastas, sem caracteres
 * de controle, sem aspas, até 120 caracteres, sempre com a extensão REAL do conteúdo.
 */
export function safeFileName(original: string | null | undefined, ext: string): string {
  const base =
    (original ?? "")
      .split(/[\\/]/)
      .pop()!
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .slice(0, 110) || "anexo";
  return `${base}.${ext}`;
}

/** Texto da mensagem quando o anexo vem sem legenda: "[imagem]", "[documento: exame.pdf]" */
export function attachmentLabel(kind: AttachmentKind, fileName?: string | null): string {
  if (kind === "document" && fileName) return `[documento: ${fileName}]`;
  return `[${ATTACHMENT_KIND_LABEL[kind]}]`;
}

/** "1,2 MB", "830 KB" */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Filtro do seletor de arquivos (só ajuda quem escolhe; quem decide é detectFileType
 * no servidor, pelo conteúdo).
 */
export const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,audio/*,video/mp4,video/quicktime,.doc,.docx,.xls,.xlsx,.pptx,.heic";
