import "server-only";
import type { EmailMessage } from "./index";

/**
 * MODELOS DOS E-MAILS DA CONTA
 * HTML simples com estilos no próprio elemento (clientes de e-mail ignoram CSS externo)
 * e sempre uma versão em texto puro. Nada de imagens remotas (rastreamento) e nada de
 * dado de paciente. Todo texto variável passa por `esc` (um nome com "<script>" vira texto).
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "16/10/2026 às 09:12" no fuso da clínica */
function when(date: Date, timeZone: string): string {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f2f8;font-family:Arial,Helvetica,sans-serif;color:#18203a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2f8;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px 24px">
<tr><td style="font-size:18px;font-weight:bold;color:#1f1842;padding-bottom:16px">EcoSaúde</td></tr>
<tr><td style="font-size:16px;line-height:1.55">${bodyHtml}</td></tr>
</table>
<p style="font-size:12px;color:#4f5873;max-width:520px;margin:16px auto 0;line-height:1.5">E-mail automático do EcoSaúde. Não responda: esta caixa não é lida.</p>
</td></tr></table>
</body></html>`;
}

export function passwordResetEmail(opts: { to: string; name: string; clinicName: string; link: string; minutes: number; requestedAt: Date; timeZone: string }): EmailMessage {
  const first = opts.name.split(" ")[0] || opts.name;
  const subject = "Redefinir sua senha do EcoSaúde";
  const html = layout(
    subject,
    `<p style="margin:0 0 12px">Olá, ${esc(first)}!</p>
<p style="margin:0 0 20px">Recebemos um pedido para criar uma nova senha do seu acesso à <strong>${esc(opts.clinicName)}</strong> no EcoSaúde.</p>
<p style="margin:0 0 20px"><a href="${esc(opts.link)}" style="display:inline-block;background:#6d4ae0;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Criar nova senha</a></p>
<p style="margin:0 0 12px;font-size:14px;color:#4f5873">O link vale por ${opts.minutes} minutos e só pode ser usado uma vez. Pedido feito em ${when(opts.requestedAt, opts.timeZone)}.</p>
<p style="margin:0 0 12px;font-size:14px;color:#4f5873">Se o botão não abrir, copie e cole este endereço no navegador:<br><span style="word-break:break-all;color:#18203a">${esc(opts.link)}</span></p>
<p style="margin:16px 0 0;font-size:14px">Não pediu? Pode ignorar este e-mail: sua senha continua a mesma. Ninguém da equipe do EcoSaúde vai pedir este link para você.</p>`,
  );
  const text = `Olá, ${first}!

Recebemos um pedido para criar uma nova senha do seu acesso à ${opts.clinicName} no EcoSaúde.

Crie a nova senha neste link (vale por ${opts.minutes} minutos e só pode ser usado uma vez):
${opts.link}

Pedido feito em ${when(opts.requestedAt, opts.timeZone)}.

Não pediu? Pode ignorar este e-mail: sua senha continua a mesma. Ninguém da equipe do EcoSaúde vai pedir este link para você.`;
  return { to: opts.to, subject, html, text, tag: "recuperacao-senha" };
}

export function passwordChangedEmail(opts: { to: string; name: string; clinicName: string; changedAt: Date; timeZone: string; loginUrl: string | null; how: "link" | "conta" }): EmailMessage {
  const first = opts.name.split(" ")[0] || opts.name;
  const subject = "Sua senha do EcoSaúde foi alterada";
  const how = opts.how === "link" ? "pelo link de recuperação enviado para este e-mail" : "em Minha conta";
  const html = layout(
    subject,
    `<p style="margin:0 0 12px">Olá, ${esc(first)}!</p>
<p style="margin:0 0 12px">A senha do seu acesso à <strong>${esc(opts.clinicName)}</strong> foi alterada em ${when(opts.changedAt, opts.timeZone)}, ${how}.</p>
<p style="margin:0 0 12px">Por segurança, os outros aparelhos conectados foram desconectados.</p>
<p style="margin:16px 0 0;padding:12px 14px;background:#fdecec;border-radius:10px;font-size:15px"><strong>Não foi você?</strong> Fale agora com a gestão da clínica para bloquear o acesso e criar uma senha nova.</p>`,
  );
  const text = `Olá, ${first}!

A senha do seu acesso à ${opts.clinicName} foi alterada em ${when(opts.changedAt, opts.timeZone)}, ${how}.
Por segurança, os outros aparelhos conectados foram desconectados.

Não foi você? Fale agora com a gestão da clínica para bloquear o acesso e criar uma senha nova.${opts.loginUrl ? `\n\nEntrar: ${opts.loginUrl}/login` : ""}`;
  return { to: opts.to, subject, html, text, tag: "senha-alterada" };
}
