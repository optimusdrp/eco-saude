import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * ENVIO DE E-MAIL (com plano B)
 *
 * Usado só para e-mails da conta (recuperação de senha e aviso de senha alterada).
 * NUNCA leva dado de paciente.
 *
 *  - EMAIL_DRIVER: provedor principal
 *      ses     = Amazon SES (região de São Paulo por padrão; mesma conta AWS dos anexos)
 *      resend  = Resend (API HTTP)
 *      arquivo = só desenvolvimento: grava o e-mail em apps/app/.data/emails (nada sai)
 *  - EMAIL_FALLBACK: provedor reserva. Se o principal falhar (fora do ar, cota, credencial),
 *    o mesmo e-mail sai pelo reserva, sem a pessoa perceber.
 *  - Sem provedor em produção: a recuperação por e-mail fica desligada e a tela de login
 *    orienta a pedir a redefinição para a gestão da clínica (o caminho que já existia).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Rótulo para o registro (nunca o conteúdo) */
  tag: string;
}

type DriverName = "ses" | "resend" | "arquivo";
interface Driver {
  name: DriverName;
  send(msg: EmailMessage, from: string): Promise<void>;
}

const TIMEOUT_MS = 8000;
const isProd = () => process.env.NODE_ENV === "production";

function driverName(raw: string | undefined): DriverName | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "ses" || v === "resend" || v === "arquivo" ? v : null;
}

/** O provedor tem o que precisa para funcionar? (sem chamar a rede) */
function driverReady(name: DriverName): boolean {
  if (name === "arquivo") return !isProd();
  if (name === "resend") return !!process.env.RESEND_API_KEY;
  return true; // SES: credenciais pelo padrão da AWS (variáveis ou papel IAM)
}

function from(): string {
  return process.env.EMAIL_FROM || "Tropi <nao-responda@tropi.local>";
}

/* --------------------------------- Drivers --------------------------------- */

function sesDriver(): Driver {
  return {
    name: "ses",
    async send(msg, sender) {
      const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
      const client = new SESv2Client({
        region: process.env.SES_REGION || "sa-east-1",
        // Só para testes com um SES simulado; em produção fica vazio
        ...(process.env.SES_ENDPOINT ? { endpoint: process.env.SES_ENDPOINT } : {}),
      });
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: sender,
          Destination: { ToAddresses: [msg.to] },
          Content: {
            Simple: {
              Subject: { Data: msg.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: msg.html, Charset: "UTF-8" },
                Text: { Data: msg.text, Charset: "UTF-8" },
              },
            },
          },
          ...(process.env.SES_CONFIGURATION_SET ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET } : {}),
        }),
        { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      );
    },
  };
}

function resendDriver(): Driver {
  return {
    name: "resend",
    async send(msg, sender) {
      const res = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: sender,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Resend respondeu ${res.status}`);
    },
  };
}

function fileDriver(): Driver {
  return {
    name: "arquivo",
    async send(msg, sender) {
      if (isProd()) throw new Error("O envio para arquivo é só para desenvolvimento.");
      // Só desenvolvimento: o comentário evita que o build "rastreie" o projeto inteiro para a Vercel
      const dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.EMAIL_FILE_DIR || ".data/emails");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${msg.tag}.json`;
      await writeFile(path.join(dir, name), JSON.stringify({ from: sender, ...msg }, null, 2), { mode: 0o600 });
      console.info(`[e-mail] gravado em ${path.join(dir, name)} (desenvolvimento: nada foi enviado)`);
    },
  };
}

const DRIVERS: Record<DriverName, () => Driver> = {
  ses: sesDriver,
  resend: resendDriver,
  arquivo: fileDriver,
};

/* ---------------------------------- Uso ------------------------------------ */

/** Provedores na ordem de tentativa (principal, reserva), só os que estão prontos. */
function chain(): Driver[] {
  const primary = driverName(process.env.EMAIL_DRIVER) ?? (isProd() ? null : "arquivo");
  const fallback = driverName(process.env.EMAIL_FALLBACK);
  const names = [primary, fallback].filter((n, i, a): n is DriverName => !!n && a.indexOf(n) === i && driverReady(n));
  return names.map((n) => DRIVERS[n]());
}

export function emailStatus(): { configured: boolean; drivers: DriverName[] } {
  const drivers = chain().map((d) => d.name);
  return { configured: drivers.length > 0, drivers };
}

export type SendResult = { ok: true; via: DriverName; usedFallback: boolean } | { ok: false; errors: string[] };

/** Envia pelo principal; se falhar, pelo reserva. Nunca lança erro: devolve o resultado. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const drivers = chain();
  if (!drivers.length) return { ok: false, errors: ["Nenhum provedor de e-mail configurado."] };
  const errors: string[] = [];
  for (const [i, d] of drivers.entries()) {
    try {
      await d.send(msg, from());
      if (i > 0) console.warn(`[e-mail] ${msg.tag}: enviado pelo reserva (${d.name}) após falha do principal.`);
      return { ok: true, via: d.name, usedFallback: i > 0 };
    } catch (error) {
      // Só o motivo técnico; nunca o destinatário nem o conteúdo no log
      const reason = `${d.name}: ${(error as Error).name === "TimeoutError" ? "tempo esgotado" : (error as Error).message}`.slice(0, 200);
      errors.push(reason);
      console.error(`[e-mail] ${msg.tag}: falhou (${reason}).`);
    }
  }
  return { ok: false, errors };
}

/**
 * Endereço do app para os links dos e-mails. Vem SEMPRE da configuração (APP_URL),
 * nunca do cabeçalho Host da requisição: um Host forjado faria o link do e-mail
 * apontar para o site de um atacante (e o token iria junto).
 */
export function appUrl(): string | null {
  const raw = process.env.APP_URL || (isProd() ? "" : `http://localhost:${process.env.PORT || 3002}`);
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && isProd()) return null;
    return u.origin;
  } catch {
    return null;
  }
}
