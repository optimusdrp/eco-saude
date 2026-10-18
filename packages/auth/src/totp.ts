import "server-only";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

/**
 * Verificação em duas etapas (2FA) por aplicativo autenticador
 * (Google Authenticator, Microsoft Authenticator, 1Password...).
 * Padrão TOTP: um código de 6 números que muda a cada 30 segundos.
 *
 * `issuer` é o nome que aparece no aplicativo (ex.: "EcoSaúde Backoffice",
 * "EcoSaúde Clínica"), para a pessoa saber qual código é de qual sistema.
 */
const PERIOD = 30;

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFor(secret: string, email: string, issuer: string) {
  return new TOTP({ issuer, label: email, secret: Secret.fromBase32(secret), digits: 6, period: PERIOD });
}

/** QR code (imagem em data URL) para cadastrar no aplicativo. */
export async function totpQrCode(secret: string, email: string, issuer: string): Promise<string> {
  return QRCode.toDataURL(totpFor(secret, email, issuer).toString(), { margin: 1, width: 220 });
}

/**
 * Confere o código. Aceita até 2 intervalos (60 segundos) de diferença,
 * para tolerar relógio do celular ou do servidor um pouco adiantado/atrasado.
 * Retorna o número do intervalo usado (para impedir que o mesmo código seja
 * reaproveitado) ou null se inválido. O issuer não entra no cálculo do código.
 */
export function verifyTotp(secret: string, email: string, code: string, lastStep: number | null): number | null {
  const totp = totpFor(secret, email, "EcoSaúde");
  const delta = totp.validate({ token: code.replace(/\s/g, ""), window: 2 });
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  if (lastStep !== null && step <= lastStep) return null; // código já usado
  return step;
}
