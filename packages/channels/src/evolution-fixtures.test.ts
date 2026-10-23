/**
 * WEBHOOKS DA EVOLUTION: FORMATO REAL
 *
 * Lê todos os arquivos de src/fixtures/evolution (os montados a partir do código-fonte da
 * Evolution v2.3.7 e os gravados no piloto) e confere três coisas em cada um:
 *  1. não tem dado pessoal (a anonimização da gravação funcionou);
 *  2. o Tropi lê sem erro e entende o tipo certo (texto, anexo, status, conexão);
 *  3. quando o arquivo traz `_espera`, o resultado é exatamente o esperado.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createEvolutionAnonymizer, evolutionConnectionStatus, findPersonalData, parseEvolutionWebhook, type EvolutionWebhook } from "./index";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "evolution");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

/** Tipo de anexo que cada tipo de mensagem do WhatsApp deve virar */
const MEDIA_KIND: Record<string, string> = {
  imageMessage: "image",
  stickerMessage: "image",
  videoMessage: "video",
  ptvMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
};
/** Tipos que não são mensagem do paciente (reação, apagada, edição, álbum) */
const NOT_A_MESSAGE = new Set(["reactionMessage", "protocolMessage", "editedMessage", "albumMessage", "pollUpdateMessage", "senderKeyDistributionMessage"]);

interface Expect {
  recebidas?: number;
  celular?: number;
  texto?: string;
  de?: string;
  nome?: string | null;
  anexo?: string;
  mime?: string;
  tamanho?: number;
  arquivo?: string;
  cloud?: string;
  status?: string;
  id?: string;
  conexao?: string;
  numero?: string;
  motivo?: number;
  tela?: string;
  aviso?: string;
}

function load(file: string): { body: Record<string, unknown>; expect: Expect | null } {
  const raw = JSON.parse(readFileSync(join(DIR, file), "utf8")) as Record<string, unknown>;
  const { _espera, ...body } = raw;
  return { body, expect: (_espera as Expect | undefined) ?? null };
}

function checkGeneric(body: Record<string, unknown>, r: EvolutionWebhook) {
  const data = (Array.isArray(body.data) ? body.data[0] : body.data) as Record<string, unknown> | undefined;
  const event = String(body.event).toLowerCase().replace(/_/g, ".");
  if (event === "messages.upsert" && data) {
    const type = String(data.messageType ?? "");
    const jid = String((data.key as Record<string, unknown>)?.remoteJid ?? "");
    const all = [...r.messages, ...r.sentFromPhone];
    if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter") || NOT_A_MESSAGE.has(type)) {
      assert.equal(all.length, 0, "grupo, status, reação, edição e álbum não viram mensagem");
      return;
    }
    assert.equal(all.length, 1, "uma mensagem por webhook");
    const m = all[0]!;
    assert.ok(m.externalMessageId, "tem o ID da mensagem");
    assert.ok(m.text.length > 0, "tem texto (ou o rótulo do anexo)");
    if (MEDIA_KIND[type]) assert.equal(m.attachments?.[0]?.kind, MEDIA_KIND[type], `anexo do tipo ${MEDIA_KIND[type]}`);
  }
  if (event === "messages.update" && data) {
    const known = ["SERVER_ACK", "DELIVERY_ACK", "DELIVERED", "READ", "PLAYED", "ERROR", "FAILED", "SENT"];
    if (known.includes(String(data.status).toUpperCase())) assert.equal(r.statuses.length, 1, "status conhecido vira atualização");
  }
  if (event === "connection.update") {
    assert.ok(r.connection, "estado da conexão lido");
    assert.ok(["conectado", "conectando", "desconectado"].includes(evolutionConnectionStatus(r.connection!).state));
  }
}

function checkExpected(r: EvolutionWebhook, e: Expect) {
  if (e.recebidas !== undefined) assert.equal(r.messages.length, e.recebidas, "mensagens do paciente");
  if (e.celular !== undefined) assert.equal(r.sentFromPhone.length, e.celular, "enviadas pelo celular");
  const m = r.messages[0] ?? r.sentFromPhone[0];
  if (e.texto !== undefined) assert.equal(m?.text, e.texto);
  if (e.de !== undefined) assert.equal(m?.from.externalId, e.de);
  if (e.nome !== undefined) assert.equal(m?.from.name, e.nome ?? undefined);
  const a = m?.attachments?.[0];
  if (e.anexo !== undefined) assert.equal(a?.kind, e.anexo);
  if (e.mime !== undefined) assert.equal(a?.mime, e.mime);
  if (e.tamanho !== undefined) assert.equal(a?.sizeBytes, e.tamanho);
  if (e.arquivo !== undefined) assert.equal(a?.fileName, e.arquivo);
  if (e.cloud !== undefined) assert.equal(a?.ref.provider === "evolution" ? a.ref.cloud?.mediaId : undefined, e.cloud);
  if (e.status !== undefined) assert.equal(r.statuses[0]?.status, e.status);
  if (e.id !== undefined) assert.equal(r.statuses[0]?.externalMessageId, e.id);
  if (e.conexao !== undefined) assert.equal(r.connection?.state, e.conexao);
  if (e.numero !== undefined) assert.equal(r.connection?.number, e.numero);
  if (e.motivo !== undefined) assert.equal(r.connection?.reason, e.motivo);
  if (e.tela !== undefined || e.aviso !== undefined) {
    const s = evolutionConnectionStatus(r.connection!);
    if (e.tela !== undefined) assert.equal(s.state, e.tela);
    if (e.aviso !== undefined) assert.match(s.error ?? "", new RegExp(e.aviso));
  }
}

describe("Webhooks da Evolution (fixtures)", () => {
  it("há fixtures para os principais formatos", () => {
    assert.ok(files.length >= 20, `esperava pelo menos 20 arquivos, há ${files.length}`);
  });
  for (const file of files) {
    it(file, () => {
      const { body, expect } = load(file);
      assert.deepEqual(findPersonalData(body), [], "sem dados pessoais");
      const r = parseEvolutionWebhook(body);
      assert.equal(r.instance, body.instance);
      checkGeneric(body, r);
      if (expect) checkExpected(r, expect);
    });
  }
});

describe("Gravação do piloto: anonimização", () => {
  it("troca telefones, LID, nomes, textos e IDs da API oficial; tira chaves e links do arquivo", () => {
    const real = {
      event: "messages.upsert",
      instance: "tropi-1a2b3c4d-abcdef",
      data: {
        key: { remoteJid: "5551987654321@s.whatsapp.net", remoteJidAlt: "123456789012345@lid", fromMe: false, id: "3EB0REAL" },
        pushName: "Maria da Silva",
        message: {
          imageMessage: { url: "https://mmg.whatsapp.net/x", mimetype: "image/jpeg", caption: "meu exame, CPF 123.456.789-00, tel 51987654321", fileName: "exame-maria.PDF", mediaKey: "abc", jpegThumbnail: "/9j/4AAQ", directPath: "/v/t62" },
          messageContextInfo: { messageSecret: "segredo" },
        },
        messageType: "imageMessage",
      },
      sender: "555133334444@s.whatsapp.net",
      apikey: "chave-da-instancia",
      server_url: "https://evolution.clinica.com.br",
    };
    const a = createEvolutionAnonymizer();
    const clean = a.anonymize(real) as typeof real;
    const text = JSON.stringify(clean);
    for (const leak of ["5551987654321", "51987654321", "123456789012345", "Maria", "CPF", "exame-maria", "mmg.whatsapp", "segredo", "chave-da-instancia", "555133334444", "clinica.com.br", "1a2b3c4d"]) {
      assert.ok(!text.includes(leak), `vazou: ${leak}`);
    }
    assert.deepEqual(findPersonalData(clean), []);
    // A estrutura continua a mesma: o Tropi lê igual
    const r = parseEvolutionWebhook(clean);
    assert.equal(r.messages[0]!.attachments![0]!.kind, "image");
    assert.equal(r.messages[0]!.attachments![0]!.fileName, "arquivo-teste.pdf");
    // O mesmo número real vira sempre o mesmo falso (status e mensagem continuam ligados)
    const again = a.anonymize({ event: "messages.update", instance: "tropi-1a2b3c4d-abcdef", data: { remoteJid: "5551987654321@s.whatsapp.net", keyId: "wamid.HBgMNTU1MTk4NzY1NDMyMRUCABIYFjNFQjA", status: "READ" } }) as { data: { remoteJid: string; keyId: string }; instance: string };
    assert.equal(again.data.remoteJid, clean.data.key.remoteJid);
    assert.equal(again.instance, "tropi-piloto");
    assert.match(again.data.keyId, /^wamid\.teste-\d+$/);
  });

  it("aponta o que sobrou de pessoal", () => {
    assert.equal(findPersonalData({ data: { key: { remoteJid: "5551987654321@s.whatsapp.net" } } }).length, 1);
    assert.equal(findPersonalData({ data: { message: { imageMessage: { mediaKey: "x" } } } }).length, 1);
    assert.equal(findPersonalData({ data: { keyId: "wamid.HBgMNTU1" } }).length, 1);
  });
});
