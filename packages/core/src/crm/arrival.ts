/**
 * CHEGADA PELO CONSULTÓRIO (regras puras)
 *
 * Clínica sem recepção: o próprio profissional marca que o paciente chegou, no Consultório.
 * O efeito é o mesmo da agenda (status "compareceu" + hora de chegada) e as travas também:
 * só a partir de ATTENDANCE_TOLERANCE_MIN minutos antes do horário (evita toque errado
 * em consulta futura, que dispararia a pesquisa de satisfação antes da hora).
 */
import { ATTENDANCE_TOLERANCE_MIN } from "./constants";

/** Situação da consulta no Consultório (a mesma de apps/app/src/modules/pep/consultorio.ts) */
export type ConsultorioFlow = "aguardando" | "chegou" | "triado" | "em_atendimento" | "finalizado" | "faltou";

/** A partir de quando dá para marcar "Chegou" e se já dá agora */
export function arrivalWindow(startsAt: Date, now: Date): { open: boolean; opensAt: Date } {
  const opensAt = new Date(startsAt.getTime() - ATTENDANCE_TOLERANCE_MIN * 60_000);
  return { open: now.getTime() >= opensAt.getTime(), opensAt };
}

/**
 * Qual botão de chegada a linha do Consultório mostra:
 *  - "chegou": consulta de hoje, ainda aguardando, e a pessoa pode marcar comparecimento;
 *  - "desfazer": marcou por engano e nada clínico começou (sem triagem e sem atendimento);
 *  - null: nenhum (outro dia, sem permissão, paciente anonimizado, já em triagem/atendimento).
 */
export function arrivalAction(input: { flow: ConsultorioFlow; isToday: boolean; canMark: boolean; anonymized: boolean }): "chegou" | "desfazer" | null {
  if (!input.isToday || !input.canMark || input.anonymized) return null;
  if (input.flow === "aguardando") return "chegou";
  if (input.flow === "chegou") return "desfazer";
  return null;
}
