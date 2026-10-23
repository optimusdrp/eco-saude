/**
 * 2FA (TOTP): implementada no pacote compartilhado @ecosaude/auth.
 * Aqui só fixamos o nome que aparece no aplicativo autenticador.
 */
import { totpQrCode as qr } from "@ecosaude/auth/totp";

export { newTotpSecret, verifyTotp } from "@ecosaude/auth/totp";

export function totpQrCode(secret: string, email: string): Promise<string> {
  return qr(secret, email, "Tropi Backoffice");
}
