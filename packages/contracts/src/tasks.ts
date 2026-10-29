// Task fields and calendar-day validation adapted from Synara's contracts/src/todo.ts,
// revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  CommandId,
  IsoDateTime,
  RunId,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ScopedProjectRef, ScopedThreadRef } from "./environment.ts";
import { OrchestrationV2Actor, OrchestrationV2CreationSource } from "./orchestrationV2.ts";

export const DockTaskId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("DockTaskId"),
);
export type DockTaskId = typeof DockTaskId.Type;
export const TASK_TITLE_MAX_LENGTH = 500;
export const TASK_NOTES_MAX_LENGTH = 10_000;
export const TaskTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(TASK_TITLE_MAX_LENGTH));
export const TaskNotes = Schema.String.check(Schema.isMaxLength(TASK_NOTES_MAX_LENGTH));
export const TaskPriority = Schema.Literals(["none", "low", "medium", "high", "urgent"]);
export type TaskPriority = typeof TaskPriority.Type;

function isCalendarDay(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = DateTime.make(value + "T00:00:00.000Z");
  if (Option.isNone(parsed)) return false;
  const parts = DateTime.toPartsUtc(parsed.value);
  return parts.year === year && parts.month === month && parts.day === day;
}

export const TaskDueDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter(isCalendarDay),
);

export const TaskThreadLink = Schema.Struct({
  project: ScopedProjectRef,
  thread: ScopedThreadRef,
  baseRunId: Schema.optional(Schema.NullOr(RunId)),
  linkedAt: IsoDateTime,
}).check(Schema.makeFilter((link) => link.project.environmentId === link.thread.environmentId));
export type TaskThreadLink = typeof TaskThreadLink.Type;

export const DockTask = Schema.Struct({
  id: DockTaskId,
  revision: NonNegativeInt,
  title: TaskTitle,
  notes: TaskNotes,
  priority: TaskPriority,
  dueDate: Schema.NullOr(TaskDueDate),
  project: Schema.NullOr(ScopedProjectRef),
  thread: Schema.NullOr(TaskThreadLink),
  completedAt: Schema.NullOr(IsoDateTime),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DockTask = typeof DockTask.Type;

export const TasksSnapshot = Schema.Struct({
  sequence: NonNegativeInt,
  tasks: Schema.Array(DockTask),
});
export type TasksSnapshot = typeof TasksSnapshot.Type;

const taskMutation = { commandId: CommandId, taskId: DockTaskId, expectedRevision: NonNegativeInt };
export const TaskMutationProvenance = Schema.Struct({
  createdBy: OrchestrationV2Actor,
  creationSource: OrchestrationV2CreationSource,
});
export type TaskMutationProvenance = typeof TaskMutationProvenance.Type;
export const TaskCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("task.create"),
    commandId: CommandId,
    taskId: DockTaskId,
    title: TaskTitle,
    notes: Schema.optional(TaskNotes),
    priority: Schema.optional(TaskPriority),
    dueDate: Schema.optional(Schema.NullOr(TaskDueDate)),
    project: Schema.optional(Schema.NullOr(ScopedProjectRef)),
  }),
  Schema.Struct({
    type: Schema.Literal("task.edit"),
    ...taskMutation,
    title: Schema.optional(TaskTitle),
    notes: Schema.optional(TaskNotes),
    priority: Schema.optional(TaskPriority),
    dueDate: Schema.optional(Schema.NullOr(TaskDueDate)),
    project: Schema.optional(Schema.NullOr(ScopedProjectRef)),
  }),
  Schema.Struct({
    type: Schema.Literals([
      "task.complete",
      "task.reopen",
      "task.archive",
      "task.restore",
      "task.unassign",
    ]),
    ...taskMutation,
  }),
  Schema.Struct({
    type: Schema.Literal("task.link"),
    ...taskMutation,
    link: TaskThreadLink,
  }),
]);
export type TaskCommand = typeof TaskCommand.Type;
export const TaskChange = Schema.Union([
  Schema.Struct({ type: Schema.Literal("task.updated"), task: DockTask }),
  // Older persisted histories include this receipt event; new code never emits it.
  Schema.Struct({
    type: Schema.Literal("task.release.acknowledged"),
    assignmentId: TrimmedNonEmptyString,
  }),
]);
export type TaskChange = typeof TaskChange.Type;
export const TaskEvent = Schema.Struct({
  sequence: NonNegativeInt,
  commandId: CommandId,
  occurredAt: IsoDateTime,
  change: TaskChange,
  ...TaskMutationProvenance.fields,
});
export type TaskEvent = typeof TaskEvent.Type;
export const TasksStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: TasksSnapshot }),
  Schema.Struct({ kind: Schema.Literal("event"), event: TaskEvent }),
]);
export type TasksStreamItem = typeof TasksStreamItem.Type;
export const TaskMutationResult = Schema.Struct({ sequence: NonNegativeInt });
export type TaskMutationResult = typeof TaskMutationResult.Type;
export const TaskReadInput = Schema.Struct({ taskId: DockTaskId });
export const TaskHistoryInput = Schema.Struct({
  taskId: DockTaskId,
  beforeSequence: Schema.optional(NonNegativeInt),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type TaskHistoryInput = typeof TaskHistoryInput.Type;
export const TaskHistoryResult = Schema.Struct({
  events: Schema.Array(TaskEvent),
  nextBeforeSequence: Schema.NullOr(NonNegativeInt),
});
export type TaskHistoryResult = typeof TaskHistoryResult.Type;

export class DockTaskError extends Schema.TaggedError<DockTaskError>()("DockTaskError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "not-found",
    "duplicate-id",
    "revision-conflict",
    "command-conflict",
    "inactive-task",
    "thread-scope-mismatch",
    "persistence",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return "This Task no longer exists.";
      case "duplicate-id":
        return "This Task identity has already been used.";
      case "revision-conflict":
        return "This Task changed elsewhere. Refresh it before trying again.";
      case "command-conflict":
        return "This command identity was already used for a different Task change.";
      case "inactive-task":
        return "Reopen or restore this Task before changing its thread link.";
      case "thread-scope-mismatch":
        return "The linked project and thread must belong to the same environment.";
      case "persistence":
        return "The Task operation could not be saved or read.";
    }
  }
}
