/**
 * AVISOS ATIVOS DO PRONTUÁRIO (regras puras, sem banco)
 *
 * Dois eventos que não podem ficar só no registro de acessos:
 *  1. ACESSO DE EMERGÊNCIA: alguém abriu um prontuário fora da regra de sigilo. A gestão do
 *     prontuário precisa saber NA HORA (quem, qual paciente, por quê) para conferir se foi devido.
 *  2. TRIAGEM URGENTE: a enfermagem/recepção classificou o paciente como urgente. O profissional
 *     da consulta precisa saber NA HORA, esteja na tela que estiver.
 *
 * Aqui ficam: quem recebe, o texto do aviso (sino) e o texto do e-mail.
 * Regra de LGPD do e-mail: e-mail não é canal seguro e pode cair em caixa compartilhada.
 * Por isso ele NUNCA leva nome do paciente, motivo ou queixa, só que houve o evento e o link.
 */

/** Permissão de quem recebe o aviso de acesso de emergência (gestão do prontuário: modelos, ajustes e registro de acessos) */
export const EMERGENCY_NOTICE_PERMISSION = "prontuario.modelos";

/** Avisos lidos ou não somem depois deste prazo (o registro permanente é a auditoria do prontuário) */
export const NOTICE_RETENTION_DAYS = 90;

/** Tamanho máximo do texto citado no aviso (motivo, queixa) */
const QUOTE_MAX = 200;

/** Corta textos longos no fim de uma palavra, com reticências */
export function shortQuote(text: string | null | undefined, max = QUOTE_MAX): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, "")}...`;
}

/* ------------------------------ Destinatários ------------------------------ */

export interface NoticeCandidate {
  id: string;
  active: boolean;
  permissions: readonly string[];
}

/**
 * Quem recebe o aviso de acesso de emergência: pessoas ativas com a gestão do prontuário,
 * menos quem fez o acesso (não faz sentido avisar a própria pessoa).
 * Se ninguém sobrar (ex.: a única gestora fez o acesso), o evento continua no registro de acessos.
 */
export function emergencyRecipients(users: readonly NoticeCandidate[], actorId: string): string[] {
  return users.filter((u) => u.active && u.id !== actorId && u.permissions.includes(EMERGENCY_NOTICE_PERMISSION)).map((u) => u.id);
}

/**
 * A triagem gera aviso? Só quando PASSA a ser urgente (nova ou corrigida para urgente).
 * Corrigir a queixa de uma triagem que já era urgente não repete o aviso.
 */
export function shouldNoticeTriage(previous: string | null | undefined, next: string): boolean {
  return next === "urgente" && previous !== "urgente";
}

/**
 * Quem recebe o aviso de triagem urgente: o acesso ligado ao profissional da consulta,
 * se existir, estiver ativo e não for quem registrou a triagem.
 */
export function triageRecipients(professionalUser: { id: string; active: boolean } | null, actorId: string): string[] {
  return professionalUser && professionalUser.active && professionalUser.id !== actorId ? [professionalUser.id] : [];
}

/* --------------------------------- Textos --------------------------------- */

export interface NoticeText {
  title: string;
  body: string;
}

export function emergencyNoticeText(p: { actorName: string; patientName: string; reason: string }): NoticeText {
  return {
    title: "Acesso de emergência ao prontuário",
    body: `${p.actorName} abriu o prontuário de ${p.patientName}. Motivo: ${shortQuote(p.reason)}`,
  };
}

export function urgentTriageNoticeText(p: { patientName: string; time: string | null; complaint: string | null; recordedByName: string }): NoticeText {
  const when = p.time ? ` (consulta das ${p.time})` : "";
  const complaint = shortQuote(p.complaint);
  return {
    title: "Triagem urgente",
    body: `${p.patientName}${when}: ${complaint || "sem queixa registrada"}. Registrada por ${p.recordedByName}.`,
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * E-mail para a gestão sobre o acesso de emergência. SEM dado do paciente (ver o topo do arquivo).
 * `when` já vem formatado no fuso da clínica (ex.: "22/10/2026 às 10:32").
 */
export function emergencyEmail(p: { clinicName: string; when: string; link: string }): { subject: string; text: string; html: string } {
  const subject = `Tropi: acesso de emergência a um prontuário (${p.clinicName})`;
  const lines = [
    `Houve um acesso de emergência a um prontuário da ${p.clinicName} em ${p.when}.`,
    "Por segurança, o nome do paciente, quem acessou e o motivo não vão por e-mail.",
    `Confira no Tropi, em Prontuário > Ajustes > Registro de acessos: ${p.link}`,
    "Você recebe este e-mail porque cuida da gestão do prontuário. A clínica pode desligar o aviso por e-mail em Prontuário > Ajustes.",
  ];
  const html =
    `<p>${escapeHtml(lines[0]!)}</p><p>${escapeHtml(lines[1]!)}</p>` +
    `<p><a href="${escapeHtml(p.link)}">Ver o registro de acessos no Tropi</a></p>` +
    `<p style="color:#5B5A74;font-size:13px">${escapeHtml(lines[3]!)}</p>`;
  return { subject, text: lines.join("\n\n"), html };
}
