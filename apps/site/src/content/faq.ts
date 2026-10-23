import type { FaqItem } from "@/types";

/**
 * Perguntas frequentes.
 * As respostas evitam prometer o que ainda não existe: módulos em
 * desenvolvimento são apresentados como tal.
 */
export const faq: FaqItem[] = [
  {
    question: "Preciso contratar todos os módulos?",
    answer:
      "Não. Cada módulo é contratado separadamente e você pode começar por um só. Ao adicionar outro, ele aparece no mesmo ambiente, com o mesmo login, e as conexões entre os módulos são ativadas automaticamente.",
  },
  {
    question: "O que funciona quando a internet cai?",
    answer:
      "Consultar a agenda e o cadastro dos pacientes, registrar atendimentos e preparar mensagens. Tudo fica salvo no aparelho e é sincronizado quando a conexão volta. Envio de WhatsApp, e-mail e recursos de IA dependem de internet e ficam na fila até lá.",
  },
  {
    question: "E se duas pessoas marcarem o mesmo horário sem internet?",
    answer:
      "Ao sincronizar, o sistema não escolhe sozinho. O conflito aparece no painel de contingência para alguém da clínica decidir, com as duas versões lado a lado.",
  },
  {
    question: "Os dados da minha clínica ficam separados das outras?",
    answer:
      "Sim. Cada clínica tem os dados isolados no próprio banco de dados, e não apenas na aplicação: mesmo um erro de programação não expõe informações de outra clínica. Toda ação fica registrada em uma trilha de auditoria.",
  },
  {
    question: "Funciona no celular e no tablet?",
    answer:
      "Sim. Cada tela foi desenhada para três tamanhos: computador na recepção, tablet no consultório e celular para a gestão. Não é a versão de computador encolhida.",
  },
  {
    question: "Quando os módulos estarão disponíveis?",
    answer:
      "O Tropi Atendimento está em fase de testes. Gestão, Prontuário e Indicadores estão em desenvolvimento, nessa ordem. Peça uma demonstração para acompanhar as liberações.",
  },
];
