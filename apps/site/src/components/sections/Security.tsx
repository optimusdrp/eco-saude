import { Building2, FileClock, KeyRound, Lock, ShieldCheck, Workflow } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { moduleColor } from "@/components/ui/ModuleTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { modules } from "@/content/modules";
import { cn } from "@/lib/cn";

/**
 * Seção "Segurança".
 * Lista os compromissos de arquitetura em linguagem do usuário.
 * Importante: descreve como o sistema é projetado, sem citar certificações
 * que ainda não existem.
 */
const items = [
  {
    Icon: Building2,
    title: "Cada clínica isolada",
    text: "Os dados de cada clínica são separados no próprio banco de dados. Mesmo um erro de programação não mostra informações de outra clínica.",
  },
  {
    Icon: KeyRound,
    title: "Permissão por perfil e por ação",
    text: "A recepção não vê o prontuário, o financeiro não vê a evolução clínica. Ações sensíveis, como excluir ou mesclar pacientes, têm permissão própria.",
  },
  {
    Icon: FileClock,
    title: "Trilha de auditoria",
    text: "Quem viu, quem alterou e quando. O registro não pode ser editado nem apagado, nem pelo administrador.",
  },
  {
    Icon: Lock,
    title: "Criptografia em todo o caminho",
    text: "Na transmissão, no servidor e também no aparelho, quando os dados ficam guardados para o modo offline.",
  },
  {
    Icon: ShieldCheck,
    title: "LGPD na rotina",
    text: "Consentimento registrado, descadastro de mensagens com um toque e exportação dos dados quando o paciente pedir.",
  },
];

export function Security() {
  return (
    <section id="seguranca" aria-labelledby="seg-title" className="bg-paper py-20 lg:py-28">
      <Container>
        <SectionHeading id="seg-title" title="Dados de saúde pedem mais que senha forte">
          Segurança faz parte da arquitetura desde o primeiro módulo, e não de um ajuste no fim.
        </SectionHeading>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {items.map(({ Icon, title, text }) => (
              <li key={title} className="border-t border-line py-6">
                <Icon className="size-6 text-crm" aria-hidden />
                <h3 className="mt-3 text-lg font-bold">{title}</h3>
                <p className="mt-1.5 text-[0.97rem] text-ink-soft">{text}</p>
              </li>
            ))}
          </ul>

          {/* Isolamento de falhas: ilustra que um módulo parado não derruba os outros */}
          <aside className="self-start rounded-3xl bg-fog p-5 ring-1 ring-line sm:p-7">
            <Workflow className="size-6 text-crm" aria-hidden />
            <h3 className="mt-3 text-xl font-bold">Um módulo parado não derruba os outros</h3>
            <p className="mt-2 text-[0.97rem] text-ink-soft">
              Cada módulo roda como um serviço independente. Se um precisar de manutenção,
              só aquela área avisa; o resto continua normal.
            </p>
            <ul className="mt-5 space-y-2">
              {modules.map((m) => {
                const down = m.id === "erp";
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3 ring-1 ring-line"
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <span className={cn("size-2.5 rounded-full", moduleColor[m.id].dot)} aria-hidden />
                      {m.name}
                    </span>
                    <span className={cn("text-sm font-semibold", down ? "text-erp-ink" : "text-ok-ink")}>
                      {down ? "Em manutenção" : "Funcionando"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-sm text-ink-soft">Exemplo: a Gestão em manutenção não afeta agenda, conversas nem prontuário.</p>
          </aside>
        </div>
      </Container>
    </section>
  );
}
