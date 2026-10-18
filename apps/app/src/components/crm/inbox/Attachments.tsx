"use client";

/**
 * ANEXOS DENTRO DA MENSAGEM
 *  - imagem: miniatura (abre inteira em outra aba)
 *  - áudio e vídeo: player do navegador (carrega só ao tocar)
 *  - documento: cartão com nome, tamanho e "Abrir" (PDF) ou "Baixar" (Word, Excel, foto HEIC)
 *  - baixando / não deu: o estado aparece no lugar, sem quebrar a conversa
 * Todo link aponta para /api/anexos/<id>, que confere login e clínica a cada acesso.
 */
import { AlertTriangle, Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import type { AttachmentView } from "@/modules/crm/files/attachments";
import { cn } from "@/components/ui/styles";

export function MessageAttachments({ items, outgoing }: { items: AttachmentView[]; outgoing: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mb-1 flex flex-col gap-1.5">
      {items.map((a) => (
        <Attachment key={a.id} a={a} outgoing={outgoing} />
      ))}
    </div>
  );
}

function Attachment({ a, outgoing }: { a: AttachmentView; outgoing: boolean }) {
  if (a.status === "pendente") {
    return (
      <p className="flex items-center gap-1.5 rounded-xl bg-fog px-3 py-2 text-sm text-ink-soft" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Recebendo {a.label.replace(/^\[|\]$/g, "")}...
      </p>
    );
  }
  if (a.status !== "pronto") {
    return (
      <p className="flex items-start gap-1.5 rounded-xl bg-alert-tint px-3 py-2 text-sm text-alert">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {a.status === "recusado" ? "Arquivo não aceito" : "Não deu para receber o arquivo"}
          {a.error ? `: ${a.error}` : "."}
        </span>
      </p>
    );
  }
  if (a.kind === "image" && a.preview) {
    return (
      <a href={a.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-xl ring-1 ring-line" title="Abrir a imagem inteira">
        {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota autenticada */}
        <img src={a.url} alt={a.fileName ? `Imagem: ${a.fileName}` : "Imagem enviada na conversa"} loading="lazy" className="max-h-72 w-full max-w-xs object-cover" />
      </a>
    );
  }
  if (a.kind === "audio" && a.preview) {
    return <audio controls preload="none" src={a.url} className="h-10 w-64 max-w-full" aria-label={a.fileName ? `Áudio: ${a.fileName}` : "Áudio enviado na conversa"} />;
  }
  if (a.kind === "video" && a.preview) {
    return <video controls preload="metadata" src={a.url} className="max-h-72 w-full max-w-xs rounded-xl bg-ink" aria-label={a.fileName ? `Vídeo: ${a.fileName}` : "Vídeo enviado na conversa"} />;
  }
  // Documento (ou mídia que o navegador não mostra): cartão
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 ring-1", outgoing ? "bg-paper/70 ring-crm/20" : "bg-fog ring-line")}>
      <FileText className="size-8 shrink-0 text-crm" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={a.fileName ?? undefined}>
          {a.fileName ?? a.label}
        </p>
        <p className="text-xs text-ink-soft">{[a.mime === "application/pdf" ? "PDF" : a.kind === "document" ? "Documento" : "Arquivo", a.size].filter(Boolean).join(", ")}</p>
      </div>
      <a
        href={a.url}
        {...(a.preview ? { target: "_blank", rel: "noopener" } : { download: a.fileName ?? true })}
        className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-crm hover:bg-crm-tint"
      >
        {a.preview ? <ExternalLink className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
        {a.preview ? "Abrir" : "Baixar"}
      </a>
    </div>
  );
}
