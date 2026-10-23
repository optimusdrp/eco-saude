import "server-only";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { bmi, DOCUMENT_KIND_LABEL, ROUTE_LABEL, VITALS, type DocumentContent, type TemplateField } from "@ecosaude/core/pep";
import type { DocumentHeader } from "@ecosaude/db/schema-pep";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * PDF DOS DOCUMENTOS CLÍNICOS (A4) e da CÓPIA DO PRONTUÁRIO.
 *
 * Fase 1 (sem certificado ICP-Brasil): o documento sai para ASSINATURA À MÃO, com linha de
 * assinatura e carimbo. Mesmo assim leva o código de verificação: quem recebe confere em
 * /documento/<código> que ele foi emitido pela clínica e não foi alterado.
 * Na fase 3 a assinatura digital (ICP-Brasil em nuvem) substitui a assinatura à mão.
 *
 * Receita de controle especial (Portaria SVS/MS 344/1998): sai em DUAS VIAS (farmácia e
 * paciente), com os quadros de identificação do comprador e do fornecedor.
 * Receitas A e B (notificação) não são emitidas pelo sistema: usam talonário oficial.
 *
 * Fonte Instrument Sans (da marca, licença OFL) embutida: sai igual em qualquer leitor.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 48;
const INK = rgb(0.11, 0.11, 0.2);
const SOFT = rgb(0.36, 0.35, 0.45);
const LINE = rgb(0.85, 0.86, 0.9);
const PEP = rgb(0.165, 0.447, 0.741); // --color-pep #2a72bd
const ALERT = rgb(0.75, 0.16, 0.24);
const FOOTER_H = 46;

let fontCache: Promise<[Buffer, Buffer] | null> | undefined;
function brandFonts() {
  fontCache ??= Promise.all([
    readFile(new URL("./fonts/instrument-sans-latin-400-normal.woff", import.meta.url)),
    readFile(new URL("./fonts/instrument-sans-latin-700-normal.woff", import.meta.url)),
  ]).catch((e) => {
    console.error("[prontuário] fonte não encontrada, usando Helvetica:", (e as Error).message);
    return null;
  });
  return fontCache;
}

/** Troca o que a fonte não tem (cobre só o alfabeto latino) */
function cleaner(font: PDFFont) {
  const set = new Set(font.getCharacterSet());
  const map: Record<string, string> = { "≤": "<=", "≥": ">=", "→": "->", "–": "-", "—": "-", " ": " ", "\t": " ", "“": '"', "”": '"', "‘": "'", "’": "'", "µ": "u", "μ": "u", "³": "3", "²": "2", "₂": "2", "°": "o", "±": "+/-", "×": "x", "•": "-" };
  return (s: string) =>
    [...(s ?? "")]
      .map((c) => {
        if (c === "\n" || set.has(c.codePointAt(0)!)) return c;
        if (map[c] !== undefined) return map[c];
        const base = c.normalize("NFD")[0]!;
        return set.has(base.codePointAt(0)!) ? base : "?";
      })
      .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        let rest = w;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
          out.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

const dateBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function fmtDate(d: Date, tz: string, withTime = false) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(d);
}
function longDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "numeric", month: "long", year: "numeric" }).format(d);
}

/* ------------------------------- Base de desenho ------------------------------- */

async function createWriter(title: string, author: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor(author);
  pdf.setCreator("Tropi Prontuário");
  pdf.setProducer("Tropi");
  const files = await brandFonts();
  let regular: PDFFont;
  let bold: PDFFont;
  if (files) {
    pdf.registerFontkit(fontkit);
    regular = await pdf.embedFont(files[0], { subset: true });
    bold = await pdf.embedFont(files[1], { subset: true });
  } else {
    regular = await pdf.embedFont(StandardFonts.Helvetica);
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  const clean = cleaner(regular);
  const width = A4.w - 2 * M;
  const w = {
    pdf,
    regular,
    bold,
    width,
    page: null as unknown as PDFPage,
    y: 0,
    text(s: string, x: number, y: number, size = 10, font = regular, color = INK) {
      w.page.drawText(clean(s), { x, y, size, font, color });
    },
    right(s: string, xr: number, y: number, size = 10, font = regular, color = INK) {
      w.text(s, xr - font.widthOfTextAtSize(clean(s), size), y, size, font, color);
    },
    line(y: number, color = LINE, thickness = 0.6) {
      w.page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness, color });
    },
    /** Parágrafo com quebra automática; devolve a altura usada */
    para(s: string, opts: { size?: number; font?: PDFFont; color?: typeof INK; x?: number; width?: number; leading?: number; onBreak?: () => void } = {}) {
      const size = opts.size ?? 10.5;
      const font = opts.font ?? regular;
      const x = opts.x ?? M;
      const leading = opts.leading ?? size * 1.45;
      for (const l of wrap(clean(s), font, size, opts.width ?? width - (x - M))) {
        if (w.y - leading < M + FOOTER_H) opts.onBreak?.();
        w.text(l, x, w.y, size, font, opts.color ?? INK);
        w.y -= leading;
      }
    },
  };
  return w;
}
type Writer = Awaited<ReturnType<typeof createWriter>>;

function drawHeader(w: Writer, h: DocumentHeader, title: string, sub?: string) {
  w.page = w.pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  w.text(h.clinic.name, M, y - 14, 15, w.bold, PEP);
  const lines = [[h.clinic.address, h.clinic.phone ? `Tel. ${h.clinic.phone}` : null].filter(Boolean).join("  |  "), h.clinic.document ?? "", h.clinic.note ?? ""].filter(Boolean);
  lines.forEach((l, i) => w.text(l, M, y - 30 - i * 11, 8.5, w.regular, SOFT));
  w.right(title.toUpperCase(), A4.w - M, y - 14, 10.5, w.bold);
  if (sub) w.right(sub, A4.w - M, y - 28, 8.5, w.bold, PEP);
  y = y - 38 - lines.length * 11;
  w.page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1.2, color: PEP });
  w.y = y - 22;
}

function drawPatient(w: Writer, h: DocumentHeader) {
  const p = h.patient;
  w.text("Paciente", M, w.y, 8, w.regular, SOFT);
  w.text(p.name, M, w.y - 13, 12, w.bold);
  const meta = [p.cpf ? `CPF ${p.cpf}` : null, p.birthDate ? `Nascimento ${dateBr(p.birthDate)}${p.age !== null && p.age !== undefined ? ` (${p.age} anos)` : ""}` : null].filter(Boolean).join("   ");
  if (meta) w.text(meta, M, w.y - 27, 9, w.regular, SOFT);
  w.y -= meta ? 42 : 30;
  w.line(w.y + 6);
  w.y -= 16;
}

/** Local, data, linha de assinatura e carimbo (assinatura à mão na fase 1) */
function drawSignature(w: Writer, h: DocumentHeader, issuedAt: Date, tz: string, city: string | null, brk: () => void) {
  // Sem espaço: a assinatura vai para a página seguinte junto com o cabeçalho
  if (w.y < M + FOOTER_H + 120) brk();
  const y = w.y - 70;
  w.text(`${city ? `${city}, ` : ""}${longDate(issuedAt, tz)}`, M, y + 40, 10);
  const cx = A4.w / 2 + 40;
  const lw = 200;
  w.page.drawLine({ start: { x: cx - lw / 2, y }, end: { x: cx + lw / 2, y }, thickness: 0.8, color: INK });
  const center = (s: string, yy: number, size: number, font: PDFFont, color = INK) => w.text(s, cx - font.widthOfTextAtSize(cleaner(font)(s), size) / 2, yy, size, font, color);
  center(h.professional.name, y - 13, 10, w.bold);
  center([h.professional.council, h.professional.specialty].filter(Boolean).join("  |  "), y - 25, 8.5, w.regular, SOFT);
  center("Assinatura e carimbo", y - 37, 7.5, w.regular, SOFT);
}

function drawFooters(w: Writer, verify: { url: string; code: string } | null, note?: string) {
  const pages = w.pdf.getPages();
  pages.forEach((pg, i) => {
    w.page = pg;
    const top = M + FOOTER_H - 12;
    pg.drawLine({ start: { x: M, y: top + 6 }, end: { x: A4.w - M, y: top + 6 }, thickness: 0.5, color: LINE });
    if (verify) {
      w.text(`Confira a autenticidade em ${verify.url} com o código`, M, top - 6, 8, w.regular, SOFT);
      w.text(verify.code, M, top - 18, 10, w.bold, PEP);
    }
    if (note) w.text(note, M, top - 30, 7, w.regular, SOFT);
    w.right(`Página ${i + 1} de ${pages.length}`, A4.w - M, top - 6, 8, w.regular, SOFT);
  });
}

/* --------------------------------- Documentos --------------------------------- */

export interface DocumentPdfInput {
  kind: DocumentContent["kind"];
  content: DocumentContent;
  header: DocumentHeader;
  issuedAt: Date;
  timeZone: string;
  city: string | null;
  verifyUrl: string;
  code: string;
  revoked: boolean;
}

export async function renderDocumentPdf(d: DocumentPdfInput): Promise<Uint8Array> {
  const w = await createWriter(`${DOCUMENT_KIND_LABEL[d.kind]} - ${d.header.patient.name}`, d.header.clinic.name);
  const title = DOCUMENT_KIND_LABEL[d.kind];
  const copies = d.content.kind === "receita_especial" ? ["1ª via: retenção da farmácia", "2ª via: orientação ao paciente"] : [undefined];

  for (const copy of copies) {
    drawHeader(w, d.header, title, copy);
    const brk = () => {
      drawHeader(w, d.header, title, copy);
      w.y -= 4;
    };
    drawPatient(w, d.header);
    drawBody(w, d, brk);
    if (d.content.kind === "receita_especial") drawSpecialBoxes(w);
    drawSignature(w, d.header, d.issuedAt, d.timeZone, d.city, brk);
  }
  // Documento cancelado: a marca d'água aparece em todas as páginas (o PDF ainda pode ser consultado)
  if (d.revoked) for (const pg of w.pdf.getPages()) pg.drawText("CANCELADO", { x: 120, y: 330, size: 72, font: w.bold, color: ALERT, opacity: 0.22, rotate: degrees(30) });
  drawFooters(w, { url: `${d.verifyUrl}/documento`, code: d.code }, d.content.kind === "receita_especial" ? "Receita de controle especial (Portaria SVS/MS 344/1998). Validade: 30 dias a partir da emissão." : undefined);
  return w.pdf.save();
}

function drawBody(w: Writer, d: DocumentPdfInput, brk: () => void) {
  const c = d.content;
  const para = (s: string, o: Parameters<Writer["para"]>[1] = {}) => w.para(s, { onBreak: brk, ...o });
  const name = d.header.patient.name;
  const cpf = d.header.patient.cpf ? `, CPF ${d.header.patient.cpf}` : "";
  switch (c.kind) {
    case "receita":
    case "receita_especial": {
      // Agrupa por via de administração ("Uso oral", "Uso tópico"), como na receita de papel
      const routes = [...new Set(c.items.map((i) => i.route))];
      let n = 1;
      for (const r of routes) {
        if (w.y < M + FOOTER_H + 160) brk();
        w.text(ROUTE_LABEL[r], M, w.y, 10.5, w.bold, PEP);
        w.y -= 20;
        for (const it of c.items.filter((i) => i.route === r)) {
          if (w.y < M + FOOTER_H + 150) brk();
          const label = `${n++}. ${it.medication}`;
          w.text(label, M, w.y, 11, w.bold);
          if (it.quantity) {
            const lw = w.bold.widthOfTextAtSize(label, 11);
            const qw = w.regular.widthOfTextAtSize(it.quantity, 10);
            // Linha pontilhada entre o nome e a quantidade (estilo receituário)
            const from = M + lw + 6;
            const to = A4.w - M - qw - 6;
            if (to > from) w.page.drawLine({ start: { x: from, y: w.y + 2 }, end: { x: to, y: w.y + 2 }, thickness: 0.6, color: LINE, dashArray: [1.5, 2.5] });
            w.right(it.quantity, A4.w - M, w.y, 10);
          }
          w.y -= 15;
          para(it.instructions, { x: M + 16, size: 10.5, color: INK });
          w.y -= 8;
        }
        w.y -= 6;
      }
      if (c.notes) {
        w.y -= 4;
        para(c.notes, { size: 9.5, color: SOFT });
      }
      break;
    }
    case "atestado": {
      const start = dateBr(c.startDate);
      para(
        `Atesto, para os devidos fins, que ${name}${cpf}, esteve sob meus cuidados profissionais nesta data e necessita de ${c.days} ${c.days === 1 ? "dia" : "dias"} de afastamento de suas atividades, a partir de ${start}.`,
        { size: 12, leading: 20 },
      );
      if (c.includeCid && c.cid) {
        w.y -= 8;
        para(`CID-10: ${c.cid} (informado a pedido e com autorização do paciente).`, { size: 10.5 });
      }
      if (c.notes) {
        w.y -= 8;
        para(c.notes, { size: 10.5 });
      }
      break;
    }
    case "declaracao": {
      para(
        `Declaro, para os devidos fins, que ${name}${cpf}, esteve neste estabelecimento em ${dateBr(c.date)}, das ${c.from} às ${c.to}, para atendimento em saúde.`,
        { size: 12, leading: 20 },
      );
      if (c.companion) {
        w.y -= 8;
        para(`Acompanhante: ${c.companion}.`, { size: 11 });
      }
      break;
    }
    case "pedido_exames": {
      w.text("Solicito:", M, w.y, 11, w.bold);
      w.y -= 20;
      c.items.forEach((it, i) => {
        if (w.y < M + FOOTER_H + 140) brk();
        para(`${i + 1}. ${it}`, { size: 11 });
      });
      if (c.indication) {
        w.y -= 10;
        w.text("Indicação clínica", M, w.y, 9, w.bold, SOFT);
        w.y -= 14;
        para(c.indication, { size: 10.5 });
      }
      break;
    }
    case "encaminhamento": {
      const urg = { eletivo: "Eletivo", prioritario: "Prioritário", urgente: "Urgente" }[c.urgency];
      w.text(`Ao(À): ${c.to}`, M, w.y, 12, w.bold);
      w.right(`Caráter: ${urg}`, A4.w - M, w.y, 10, w.bold, c.urgency === "urgente" ? ALERT : SOFT);
      w.y -= 24;
      para(`Encaminho ${name}${cpf}, para avaliação e conduta.`, { size: 11 });
      w.y -= 8;
      w.text("Motivo", M, w.y, 9, w.bold, SOFT);
      w.y -= 14;
      para(c.reason, { size: 10.5 });
      break;
    }
  }
}

/** Quadros do comprador e do fornecedor (preenchidos à mão na farmácia) */
function drawSpecialBoxes(w: Writer) {
  const h = 92;
  const minTop = M + FOOTER_H + 160 + h;
  if (w.y < minTop) w.y = minTop;
  const top = w.y - 6;
  const half = (w.width - 12) / 2;
  const box = (x: number, title: string, rows: string[]) => {
    w.page.drawRectangle({ x, y: top - h, width: half, height: h, borderColor: LINE, borderWidth: 0.8 });
    w.text(title, x + 8, top - 13, 8.5, w.bold);
    rows.forEach((r, i) => w.text(r, x + 8, top - 30 - i * 15, 8, w.regular, SOFT));
  };
  box(M, "Identificação do comprador", ["Nome:", "RG:                         Órgão emissor:", "Endereço:", "Telefone:", "Cidade:                               UF:"]);
  box(M + half + 12, "Identificação do fornecedor", ["", "", "Assinatura do farmacêutico", "", "Data: ____/____/______"]);
  w.y = top - h - 10;
}

/* --------------------------- Cópia do prontuário --------------------------- */

export interface RecordCopyInput {
  header: DocumentHeader;
  timeZone: string;
  generatedAt: Date;
  generatedBy: string;
  summary: { allergies: string[]; medications: string[]; problems: string[]; history: string | null };
  encounters: {
    startedAt: Date;
    finishedAt: Date | null;
    professional: string;
    templateName: string | null;
    fields: TemplateField[];
    answers: Record<string, unknown>;
    vitals: Record<string, number>;
    diagnoses: { code: string; name: string }[];
    conduct: string | null;
    returnDays: number | null;
    hash: string | null;
    addenda: { text: string; authorName: string; createdAt: Date }[];
  }[];
  documents: { kind: DocumentContent["kind"]; issuedAt: Date; code: string; revoked: boolean }[];
}

/** Cópia integral (pedido do paciente, LGPD art. 18 e CFM): só registros finalizados */
export async function renderRecordCopy(r: RecordCopyInput): Promise<Uint8Array> {
  const w = await createWriter(`Prontuário - ${r.header.patient.name}`, r.header.clinic.name);
  const title = "Cópia do prontuário";
  const brk = () => {
    drawHeader(w, r.header, title);
  };
  drawHeader(w, r.header, title);
  drawPatient(w, r.header);
  const section = (s: string) => {
    if (w.y < M + FOOTER_H + 60) brk();
    w.text(s, M, w.y, 11, w.bold, PEP);
    w.y -= 16;
  };
  const kv = (k: string, v: string) => {
    if (!v.trim()) return;
    if (w.y < M + FOOTER_H + 30) brk();
    w.text(k, M, w.y, 8.5, w.bold, SOFT);
    w.y -= 12;
    w.para(v, { size: 10, onBreak: brk });
    w.y -= 4;
  };

  section("Resumo");
  kv("Alergias", r.summary.allergies.join("; ") || "Nenhuma registrada");
  kv("Medicamentos em uso", r.summary.medications.join("; "));
  kv("Problemas", r.summary.problems.join("; "));
  kv("Antecedentes", r.summary.history ?? "");
  w.y -= 8;

  section(`Atendimentos (${r.encounters.length})`);
  for (const e of r.encounters) {
    if (w.y < M + FOOTER_H + 90) brk();
    w.line(w.y + 8);
    w.text(`${fmtDate(e.startedAt, r.timeZone, true)}  |  ${e.professional}${e.templateName ? `  |  ${e.templateName}` : ""}`, M, w.y - 6, 10, w.bold);
    w.y -= 22;
    for (const f of e.fields) {
      if (f.type === "titulo") continue;
      const v = e.answers[f.id];
      if (v === undefined || v === null || v === "") continue;
      kv(f.label, Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Sim" : "Não") : `${String(v)}${f.unit ? ` ${f.unit}` : ""}`);
    }
    const vit = VITALS.filter((v) => e.vitals[v.id] !== undefined).map((v) => `${v.label}: ${e.vitals[v.id]} ${v.unit}`);
    const b = bmi(e.vitals);
    if (b) vit.push(`IMC: ${b.value} (${b.label})`);
    kv("Sinais vitais", vit.join("; "));
    kv("Diagnósticos (CID-10)", e.diagnoses.map((d) => `${d.code} ${d.name}`).join("; "));
    kv("Conduta", e.conduct ?? "");
    if (e.returnDays) kv("Retorno", `${e.returnDays} dias`);
    for (const a of e.addenda) kv(`Adendo de ${a.authorName} em ${fmtDate(a.createdAt, r.timeZone, true)}`, a.text);
    if (e.hash && e.finishedAt) {
      if (w.y < M + FOOTER_H + 20) brk();
      w.text(`Finalizado em ${fmtDate(e.finishedAt, r.timeZone, true)}  |  integridade ${e.hash.slice(0, 16)}`, M, w.y, 7.5, w.regular, SOFT);
      w.y -= 18;
    }
  }

  if (r.documents.length) {
    section(`Documentos emitidos (${r.documents.length})`);
    for (const d of r.documents) {
      if (w.y < M + FOOTER_H + 16) brk();
      w.text(`${fmtDate(d.issuedAt, r.timeZone, true)}  ${DOCUMENT_KIND_LABEL[d.kind]}  ${d.code}${d.revoked ? "  (cancelado)" : ""}`, M, w.y, 9.5);
      w.y -= 14;
    }
  }
  drawFooters(w, null, `Gerada em ${fmtDate(r.generatedAt, r.timeZone, true)} por ${r.generatedBy}. Documento confidencial (sigilo profissional).`);
  return w.pdf.save();
}
