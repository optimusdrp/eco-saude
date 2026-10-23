import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * EVOLUTION API DE MENTIRA PARA OS TESTES DE PONTA A PONTA
 *
 * Responde como a Evolution v2.3.7 (formatos conferidos no código-fonte: instance.controller.ts,
 * whatsapp.baileys.service.ts, webhook.controller.ts e src/main.ts para os erros) e chama o
 * webhook do Tropi como ela chama: mesmo corpo, mesmo cabeçalho secreto por instância.
 *
 * O teste controla o "celular": conectar (open), cair, sair pelo celular (401), mandar mensagens
 * e arquivos do paciente, confirmar entrega e leitura. É o ensaio do roteiro do piloto: o piloto
 * real só precisa confirmar o que o WhatsApp de verdade faz diferente.
 */

export const FAKE_EVOLUTION_PORT = Number(process.env.E2E_EVOLUTION_PORT || 3199);
export const FAKE_EVOLUTION_KEY = "e2e-evo-key";

type State = "open" | "connecting" | "close";
interface Instance {
  name: string;
  state: State;
  number: string | null;
  qrCount: number;
  pairingCode: string | null;
  webhook: { url: string; headers: Record<string, string> } | null;
}
export interface SentMessage {
  instance: string;
  route: "sendText" | "sendMedia" | "sendWhatsAppAudio";
  number: string;
  text?: string;
  mediatype?: string;
  fileName?: string;
  id: string;
  /** Quando chegou aqui (ms): o teste do ritmo mede o intervalo entre envios */
  at: number;
}

const PNG_QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export class FakeEvolution {
  instances = new Map<string, Instance>();
  sent: SentMessage[] = [];
  /** Arquivos que o "WhatsApp" guarda (o Tropi pede pelo ID da mensagem) */
  media = new Map<string, { base64: string; mimetype: string; fileName?: string }>();
  /** Números que "não têm WhatsApp" */
  notOnWhatsApp = new Set<string>();
  private server: Server | null = null;
  private seq = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((ok, fail) => {
      this.server!.once("error", fail);
      this.server!.listen(FAKE_EVOLUTION_PORT, "127.0.0.1", () => ok());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((ok) => (this.server ? this.server.close(() => ok()) : ok()));
  }

  /** A única instância criada pelo Tropi neste teste */
  only(): Instance {
    const all = [...this.instances.values()];
    if (all.length !== 1) throw new Error(`esperava 1 instância na Evolution de teste, há ${all.length}`);
    return all[0]!;
  }

  /** Instância já conectada (o teste liga a clínica direto no banco) */
  addConnected(name: string, webhookUrl: string, headers: Record<string, string>): Instance {
    const i: Instance = { name, state: "open", number: null, qrCount: 0, pairingCode: null, webhook: { url: webhookUrl, headers } };
    this.instances.set(name, i);
    return i;
  }

  /* ------------------------- o que o "celular" faz ------------------------- */

  /** Chama o webhook do Tropi como a Evolution (webhook.controller.ts: emit) */
  async emit(instance: Instance, event: string, data: unknown): Promise<number> {
    if (!instance.webhook) throw new Error("instância sem webhook");
    const res = await fetch(instance.webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...instance.webhook.headers },
      body: JSON.stringify({
        event,
        instance: instance.name,
        data,
        destination: instance.webhook.url,
        date_time: new Date().toISOString(),
        sender: "555133330000@s.whatsapp.net",
        server_url: `http://127.0.0.1:${FAKE_EVOLUTION_PORT}`,
        apikey: null,
      }),
    });
    return res.status;
  }

  /** O celular leu o QR (ou digitou o código): conexão aberta */
  async connect(instance = this.only()) {
    instance.state = "open";
    return this.emit(instance, "connection.update", { instance: instance.name, wuid: "555133330000@s.whatsapp.net", profileName: "Clínica Exemplo", profilePictureUrl: null, state: "open", statusReason: 200 });
  }

  /** Queda que a Evolution tenta recuperar sozinha: só avisa "connecting" */
  async reconnecting(instance = this.only()) {
    instance.state = "connecting";
    return this.emit(instance, "connection.update", { instance: instance.name, state: "connecting", statusReason: 200 });
  }

  /** Saiu pelo celular (Aparelhos conectados > Sair): motivo 401, a Evolution não reconecta */
  async loggedOut(instance = this.only()) {
    instance.state = "close";
    return this.emit(instance, "connection.update", { instance: instance.name, state: "close", statusReason: 401 });
  }

  /** Mensagem do paciente (messages.upsert como o prepareMessage da Evolution monta) */
  async patientMessage(from: string, message: Record<string, unknown>, messageType: string, opts: { pushName?: string; media?: { base64: string; mimetype: string; fileName?: string } } = {}) {
    const instance = this.only();
    const id = `3EB0E2E${Date.now().toString(16).toUpperCase()}${++this.seq}`;
    if (opts.media) this.media.set(id, opts.media);
    const status = await this.emit(instance, "messages.upsert", {
      key: { remoteJid: `${from}@s.whatsapp.net`, fromMe: false, id },
      pushName: opts.pushName ?? "Paciente",
      status: "DELIVERY_ACK",
      message: { ...message, messageContextInfo: { deviceListMetadataVersion: 2 } },
      contextInfo: null,
      messageType,
      messageTimestamp: Math.floor(Date.now() / 1000),
      instanceId: "00000000-0000-4000-8000-0000000000e2",
      source: "android",
    });
    return { id, status };
  }

  /** Entregue / lida no celular do paciente (messages.update) */
  async ack(id: string, status: "DELIVERY_ACK" | "READ" | "PLAYED") {
    const instance = this.only();
    return this.emit(instance, "messages.update", { messageId: "cmh2k7x9a0001qz8f3b2c1d4e", keyId: id, remoteJid: "5551991110001@s.whatsapp.net", fromMe: true, participant: null, status, instanceId: "00000000-0000-4000-8000-0000000000e2" });
  }

  /* ------------------------------ servidor HTTP ------------------------------ */

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  /** Erro no formato da Evolution (src/main.ts) */
  private error(res: ServerResponse, status: number, message: unknown[]) {
    this.json(res, status, { status, error: status === 404 ? "Not Found" : status === 400 ? "Bad Request" : "Internal Server Error", response: { message } });
  }

  private qr(i: Instance) {
    i.qrCount += 1;
    // Igual à Evolution: um código de pareamento NOVO a cada QR quando há número
    i.pairingCode = i.number ? randomBytes(4).toString("hex").toUpperCase() : null;
    return { pairingCode: i.pairingCode, code: `2@e2e-${i.qrCount}`, base64: PNG_QR, count: i.qrCount };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.apikey !== FAKE_EVOLUTION_KEY) return this.json(res, 401, { status: 401, error: "Unauthorized", response: { message: "Unauthorized" } });
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
    const [, group, action, rawName] = url.pathname.split("/");
    const name = rawName ? decodeURIComponent(rawName) : "";
    const inst = this.instances.get(name);
    const missing = () => this.error(res, 404, [`The "${name}" instance does not exist`]);

    if (group === "instance" && action === "create") {
      const webhook = body.webhook as { url: string; headers: Record<string, string> };
      const i: Instance = { name: String(body.instanceName), state: "connecting", number: (body.number as string) ?? null, qrCount: 0, pairingCode: null, webhook: { url: webhook.url, headers: webhook.headers } };
      this.instances.set(i.name, i);
      return this.json(res, 201, { instance: { instanceName: i.name, status: "connecting" }, hash: "x", qrcode: this.qr(i) });
    }
    if (group === "instance" && action === "connect") {
      if (!inst) return missing();
      if (inst.state === "open") return this.json(res, 200, { instance: { instanceName: name, state: "open" } });
      // "connecting": devolve o QR atual (o número é ignorado, como na v2.3.7)
      if (inst.state === "connecting") return this.json(res, 200, { pairingCode: inst.pairingCode, code: `2@e2e-${inst.qrCount}`, base64: PNG_QR, count: inst.qrCount });
      inst.state = "connecting";
      inst.number = url.searchParams.get("number");
      return this.json(res, 200, this.qr(inst));
    }
    if (group === "instance" && action === "connectionState") {
      if (!inst) return missing();
      return this.json(res, 200, { instance: { instanceName: name, state: inst.state } });
    }
    if (group === "instance" && action === "fetchInstances") {
      const i = this.instances.get(url.searchParams.get("instanceName") ?? "");
      return this.json(res, 200, i ? [{ name: i.name, connectionStatus: i.state, ownerJid: i.state === "open" ? "555133330000@s.whatsapp.net" : null, profileName: "Clínica Exemplo", number: null }] : []);
    }
    if (group === "instance" && action === "logout") {
      if (!inst) return missing();
      if (inst.state === "close") return this.error(res, 400, [`The "${name}" instance is not connected`]);
      inst.state = "close";
      return this.json(res, 200, { status: "SUCCESS", error: false, response: { message: "Instance logged out" } });
    }
    if (group === "instance" && action === "delete") {
      if (!inst) return missing();
      this.instances.delete(name);
      return this.json(res, 200, { status: "SUCCESS", error: false, response: { message: "Instance deleted" } });
    }
    if (group === "webhook" && action === "set") {
      if (!inst) return missing();
      const w = body.webhook as { url: string; headers: Record<string, string> };
      inst.webhook = { url: w.url, headers: w.headers };
      return this.json(res, 201, { webhook: w });
    }
    if (group === "message" && (action === "sendText" || action === "sendMedia" || action === "sendWhatsAppAudio")) {
      if (!inst) return missing();
      if (inst.state !== "open") return this.error(res, 500, ["Error: Connection Closed"]);
      const number = String(body.number);
      if (this.notOnWhatsApp.has(number)) return this.error(res, 400, [{ jid: `${number}@s.whatsapp.net`, exists: false, number }]);
      const id = `3EB0OUT${Date.now().toString(16).toUpperCase()}${++this.seq}`;
      this.sent.push({ instance: name, route: action, number, id, at: Date.now(), ...(typeof body.text === "string" ? { text: body.text } : {}), ...(typeof body.caption === "string" ? { text: body.caption } : {}), ...(typeof body.mediatype === "string" ? { mediatype: body.mediatype } : {}), ...(typeof body.fileName === "string" ? { fileName: body.fileName } : {}) });
      return this.json(res, 201, { key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: true, id }, pushName: "Você", status: "PENDING", message: {}, messageType: action === "sendText" ? "conversation" : "imageMessage", messageTimestamp: Math.floor(Date.now() / 1000), instanceId: "00000000-0000-4000-8000-0000000000e2", source: "unknown" });
    }
    if (group === "chat" && action === "getBase64FromMediaMessage") {
      if (!inst) return missing();
      const id = String(((body.message as Record<string, unknown>)?.key as Record<string, unknown>)?.id ?? "");
      const m = this.media.get(id);
      if (!m) return this.error(res, 400, ["Message not found"]);
      return this.json(res, 201, { mediaType: "imageMessage", fileName: m.fileName ?? `${id}.bin`, caption: null, size: {}, mimetype: m.mimetype, base64: m.base64, buffer: null });
    }
    return this.error(res, 404, [`Cannot ${req.method} ${url.pathname}`]);
  }
}

/** Mesmo segredo que o Tropi configura na instância (para chamadas "de fora" do fake) */
export function evolutionHeader(serverSecret: string, instance: string) {
  return createHmac("sha256", serverSecret).update(`evolution:${instance}`).digest("hex");
}
