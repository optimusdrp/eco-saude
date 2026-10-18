import { MODULE_IDS, MODULE_LABEL, type ModuleId } from "@ecosaude/core";
import { Lock, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonStyles } from "@/components/ui/styles";
import { getEntitlements, requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Módulos" };

/** O que cada módulo resolve (texto da tela de "não contratado"). */
const PITCH: Record<ModuleId, { title: string; points: string[] }> = {
  crm: {
    title: "Atendimento e relacionamento",
    points: ["Conversas de WhatsApp, Telegram, Instagram e Messenger num só lugar", "Agenda com confirmação automática e lista de espera", "Jornada do paciente e radar de retornos"],
  },
  erp: {
    title: "Gestão financeira e operacional",
    points: ["Contas a pagar e receber, repasses e convênios", "Estoque de materiais com alerta de validade", "Faturamento TISS e notas fiscais"],
  },
  pep: {
    title: "Prontuário eletrônico",
    points: ["Evolução clínica com modelos por especialidade", "Prescrição e atestados com assinatura digital", "Histórico completo e seguro (LGPD/CFM)"],
  },
  bi: {
    title: "Indicadores e inteligência",
    points: ["Painéis de faturamento, ocupação e retorno", "Comparativos por profissional e por período", "Alertas automáticos quando um indicador sai do normal"],
  },
};

/**
 * Página de um módulo: se não está contratado, explica o que ele faz
 * (em vez de esconder); se está, avisa que o módulo chega nas próximas etapas.
 */
export default async function ModulePage({ params }: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await params;
  if (!(MODULE_IDS as readonly string[]).includes(modulo)) notFound();
  const id = modulo as ModuleId;
  const user = await requireUser();
  const ent = await getEntitlements(user.clinicId);
  const enabled = ent.modules.includes(id);
  const pitch = PITCH[id];

  return (
    <div className="mx-auto max-w-2xl py-6 text-center">
      <span className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-crm-tint text-crm">
        {enabled ? <Sparkles className="size-7" aria-hidden /> : <Lock className="size-7" aria-hidden />}
      </span>
      <p className="mt-4 text-sm font-semibold text-crm">{MODULE_LABEL[id]}</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{pitch.title}</h1>
      <p className="mt-2 text-ink-soft">
        {enabled
          ? "Este módulo já está no seu plano e está sendo preparado. Ele vai aparecer aqui, no mesmo ambiente, sem novo login."
          : "Este módulo não faz parte do plano da sua clínica. Ele funciona integrado aos demais, no mesmo ambiente."}
      </p>
      <ul className="mx-auto mt-5 max-w-md space-y-2 text-left">
        {pitch.points.map((p) => (
          <li key={p} className="rounded-xl bg-paper px-4 py-3 ring-1 ring-line">
            {p}
          </li>
        ))}
      </ul>
      {!enabled ? <p className="mt-5 text-sm text-ink-soft">Para contratar, fale com a equipe EcoSaúde ou com a gestão da clínica.</p> : null}
      {ent.modules.includes("crm") && id !== "crm" ? (
        <Link href="/hoje" className={buttonStyles("secondary", "mt-5")}>
          Voltar para o CRM
        </Link>
      ) : null}
    </div>
  );
}
