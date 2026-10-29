import * as Schema from "effect/Schema";
import { CommandId, IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";
import { DockTask, type TasksSnapshot, type TasksStreamItem } from "./tasks.ts";

export const DockTaskSummary = Schema.Struct({
  id: DockTask.fields.id,
  revision: DockTask.fields.revision,
  title: DockTask.fields.title,
  priority: DockTask.fields.priority,
  dueDate: DockTask.fields.dueDate,
  project: DockTask.fields.project,
  thread: DockTask.fields.thread,
  completedAt: DockTask.fields.completedAt,
  archivedAt: DockTask.fields.archivedAt,
  createdAt: DockTask.fields.createdAt,
  updatedAt: DockTask.fields.updatedAt,
});
export type DockTaskSummary = typeof DockTaskSummary.Type;
export const TaskSummariesSnapshot = Schema.Struct({
  sequence: NonNegativeInt,
  tasks: Schema.Array(DockTaskSummary),
});
export type TaskSummariesSnapshot = typeof TaskSummariesSnapshot.Type;
export const TaskSummaryEvent = Schema.Struct({
  sequence: NonNegativeInt,
  commandId: CommandId,
  occurredAt: IsoDateTime,
  change: Schema.Union([
    Schema.Struct({ type: Schema.Literal("task.updated"), task: DockTaskSummary }),
    Schema.Struct({
      type: Schema.Literal("task.release.acknowledged"),
      assignmentId: Schema.String,
    }),
  ]),
});
export type TaskSummaryEvent = typeof TaskSummaryEvent.Type;
export const TaskSummariesStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: TaskSummariesSnapshot }),
  Schema.Struct({ kind: Schema.Literal("event"), event: TaskSummaryEvent }),
]);
export type TaskSummariesStreamItem = typeof TaskSummariesStreamItem.Type;

function summarizeDockTask(task: DockTask): DockTaskSummary {
  return {
    id: task.id,
    revision: task.revision,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    project: task.project,
    thread: task.thread,
    completedAt: task.completedAt,
    archivedAt: task.archivedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function summarizeDockTasks(snapshot: TasksSnapshot): TaskSummariesSnapshot {
  return { sequence: snapshot.sequence, tasks: snapshot.tasks.map(summarizeDockTask) };
}

export function summarizeDockTasksStreamItem(item: TasksStreamItem): TaskSummariesStreamItem {
  if (item.kind === "snapshot")
    return { kind: "snapshot", snapshot: summarizeDockTasks(item.snapshot) };
  const { event } = item;
  return {
    kind: "event",
    event: {
      sequence: event.sequence,
      commandId: event.commandId,
      occurredAt: event.occurredAt,
      change:
        event.change.type === "task.updated"
          ? { type: "task.updated", task: summarizeDockTask(event.change.task) }
          : event.change,
    },
  };
}
