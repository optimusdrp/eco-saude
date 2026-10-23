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
      "Hoje o Tropi precisa de internet. O que já está pronto: quando um canal de mensagens cai, as mensagens esperam na fila e saem sozinhas quando ele volta, e a equipe vê o aviso em todas as telas. O modo offline completo (agenda, cadastro e atendimento salvos no aparelho) está em desenvolvimento.",
  },
  {
    question: "E se duas pessoas marcarem o mesmo horário sem internet?",
    answer:
      "Quando o modo offline chegar, o sistema não vai escolher sozinho: o conflito aparece no painel de contingência para alguém da clínica decidir, com as duas versões lado a lado. Hoje, sem internet, não é possível marcar.",
  },
  {
    question: "Os dados da minha clínica ficam separados das outras?",
    answer:
      "Sim. Cada clínica tem os dados isolados no próprio banco de dados, e não apenas na aplicação: mesmo um erro de programação não expõe informações de outra clínica. Cada abertura de prontuário e as ações sensíveis ficam registradas em uma trilha de auditoria.",
  },
  {
    question: "Funciona no celular e no tablet?",
    answer:
      "Sim. Cada tela foi desenhada para três tamanhos: computador na recepção, tablet no consultório e celular para a gestão. Não é a versão de computador encolhida.",
  },
  {
    question: "Quando os módulos estarão disponíveis?",
    answer:
      "O Tropi Atendimento e o Tropi Prontuário estão em fase de testes. Gestão, Indicadores e Laboratório estão planejados, nessa ordem. Peça uma demonstração para acompanhar as liberações.",
  },
  {
    question: "O Tropi atende laboratórios?",
    answer:
      "Vai atender. O Tropi Laboratório é para laboratórios de análises clínicas, imagem e prótese dentária: pedidos, coleta, bancada, laudo com código de verificação e ligação com as clínicas que usam o Tropi, que pedem o exame pelo prontuário e recebem o laudo de volta. O módulo está planejado; deixe seu contato para ser avisado.",
  },
];
