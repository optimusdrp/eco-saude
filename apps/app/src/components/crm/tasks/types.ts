/**
 * Tipos e padrões da tela de TAREFAS.
 */
export interface TaskItem {
  id: string;
  title: string;
  /** manual, falta (criada ao marcar falta), nps_baixo (satisfação baixa)... */
  kind: string;
  dueDate: string;
  done: boolean;
  doneLabel: string | null;
  contactId: string | null;
  contactName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdLabel: string;
}

export interface TasksData {
  tasks: TaskItem[];
  team: { id: string; name: string }[];
  userId: string;
  today: string;
  canEdit: boolean;
}

export type TasksView = "lista" | "semana" | "equipe";

export interface TasksPrefs {
  view: TasksView;
  density: "confortavel" | "compacta";
  /** Escopo ao abrir a tela */
  scope: "minhas" | "todas" | "sem_dono";
}

export const DEFAULT_TASKS_PREFS: TasksPrefs = { view: "lista", density: "confortavel", scope: "minhas" };

export const KIND_LABEL: Record<string, string> = {
  manual: "Manual",
  falta: "Faltou",
  nps_baixo: "Satisfação baixa",
  sentimento: "Paciente insatisfeito",
  promessa: "Promessa",
  retorno: "Retorno",
};
