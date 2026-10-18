import { addDaysIso, formatWhen, todayIso, zonedToUtc } from "@ecosaude/core/crm";
import { and, asc, desc, eq, gte, inSequence, isNotNull, isNull, schema, withTenant } from "@ecosaude/db";
import type { Metadata } from "next";
import { TasksBoard } from "@/components/crm/tasks/TasksBoard";
import type { TaskItem, TasksData } from "@/components/crm/tasks/types";
import { requireCrm } from "@/lib/auth/dal";
import { now } from "@/lib/clock";
import { ago } from "@/modules/crm/format";

export const metadata: Metadata = { title: "Tarefas" };
export const dynamic = "force-dynamic";

/**
 * TAREFAS DA EQUIPE
 * Lembretes com prazo e responsável: "ligar para saber do exame",
 * "remarcar quem faltou" (criada sozinha), "conferir convênio"...
 *
 * O servidor entrega as tarefas abertas (até 500) e as concluídas nos últimos
 * 30 dias (até 200); a parte interativa (TasksBoard) filtra, agrupa e move
 * tudo na hora, sem recarregar.
 */
export default async function TasksPage() {
  const ctx = await requireCrm("tarefas.ver");
  const current = now();
  const today = todayIso(current);
  const t = schema.tasks;
  const relations = { contact: { columns: { id: true, name: true } }, assignee: { columns: { id: true, name: true } } } as const;

  const [open, done, team] = await withTenant(ctx.user.clinicId, (tx) =>
    inSequence([
      () => tx.query.tasks.findMany({ where: isNull(t.doneAt), with: relations, orderBy: [asc(t.dueDate), asc(t.createdAt)], limit: 500 }),
      () =>
        tx.query.tasks.findMany({
          where: and(isNotNull(t.doneAt), gte(t.doneAt, zonedToUtc(addDaysIso(today, -30), "00:00"))),
          with: relations,
          orderBy: desc(t.doneAt),
          limit: 200,
        }),
      () =>
        tx
          .select({ id: schema.clinicUsers.id, name: schema.clinicUsers.name })
          .from(schema.clinicUsers)
          .where(eq(schema.clinicUsers.active, true))
          .orderBy(asc(schema.clinicUsers.name)),
    ]),
  );

  const toItem = (x: (typeof open)[number]): TaskItem => ({
    id: x.id,
    title: x.title,
    kind: x.kind,
    dueDate: x.dueDate,
    done: !!x.doneAt,
    doneLabel: x.doneAt ? formatWhen(x.doneAt, current) : null,
    contactId: x.contact?.id ?? null,
    contactName: x.contact?.name ?? null,
    assigneeId: x.assignee?.id ?? null,
    assigneeName: x.assignee?.name ?? null,
    createdLabel: ago(x.createdAt, current.getTime()),
  });

  const data: TasksData = {
    tasks: [...open.map(toItem), ...done.map(toItem)],
    team,
    userId: ctx.user.id,
    today,
    canEdit: ctx.can("tarefas.gerir"),
  };
  return <TasksBoard data={data} />;
}
