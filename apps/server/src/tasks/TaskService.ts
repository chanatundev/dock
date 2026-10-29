// Task lifecycle and event persistence adapted from Synara, revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import {
  DockTask as DockTaskSchema,
  DockTaskError,
  TaskChange as TaskChangeSchema,
  TaskCommand as TaskCommandSchema,
  TaskEvent as TaskEventSchema,
  TaskHistoryInput as TaskHistoryInputSchema,
  TaskHistoryResult as TaskHistoryResultSchema,
  TaskMutationProvenance as TaskMutationProvenanceSchema,
  TasksSnapshot as TasksSnapshotSchema,
  type DockTask,
  type DockTaskId,
  type TaskCommand,
  type TaskEvent,
  type TaskHistoryInput,
  type TaskHistoryResult,
  type TaskMutationProvenance,
  type TaskMutationResult,
  type TasksSnapshot,
  type TasksStreamItem,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeUtil from "node:util";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

const TaskReceipt = Schema.Struct({
  command: TaskCommandSchema,
  provenance: TaskMutationProvenanceSchema,
});
const StoredTaskReceipt = Schema.fromJsonString(TaskReceipt);
const StoredDockTask = Schema.fromJsonString(DockTaskSchema);
const StoredTaskEvent = Schema.fromJsonString(TaskEventSchema);
const decodeCommand = Schema.decodeUnknownEffect(TaskCommandSchema);
const decodeProvenance = Schema.decodeUnknownEffect(TaskMutationProvenanceSchema);
const decodeTask = Schema.decodeUnknownEffect(DockTaskSchema);
const decodeEvent = Schema.decodeUnknownEffect(TaskEventSchema);
const decodeHistoryInput = Schema.decodeUnknownEffect(TaskHistoryInputSchema);
const decodeHistoryResult = Schema.decodeUnknownEffect(TaskHistoryResultSchema);
const decodeSnapshot = Schema.decodeEffect(TasksSnapshotSchema);
const decodeChange = Schema.decodeEffect(TaskChangeSchema);
const decodeReceipt = Schema.decodeUnknownEffect(StoredTaskReceipt);
const encodeReceipt = Schema.encodeEffect(StoredTaskReceipt);
const decodeStoredTask = Schema.decodeUnknownEffect(StoredDockTask);
const encodeStoredTask = Schema.encodeEffect(StoredDockTask);
const decodeStoredEvent = Schema.decodeUnknownEffect(StoredTaskEvent);
const encodeStoredEvent = Schema.encodeEffect(StoredTaskEvent);
const isDockTaskError = Schema.is(DockTaskError);
export class TaskService extends Context.Service<
  TaskService,
  {
    readonly list: Effect.Effect<TasksSnapshot, DockTaskError>;
    readonly get: (taskId: DockTaskId) => Effect.Effect<DockTask, DockTaskError>;
    readonly history: (input: TaskHistoryInput) => Effect.Effect<TaskHistoryResult, DockTaskError>;
    readonly dispatch: (
      command: TaskCommand,
      provenance: TaskMutationProvenance,
    ) => Effect.Effect<TaskMutationResult, DockTaskError>;
    readonly streamChanges: Stream.Stream<TasksStreamItem, DockTaskError>;
  }
>()("t3/tasks/TaskService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const dispatchLock = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<TaskEvent>();

  const mapPersistenceError = (operation: string) => (cause: unknown) =>
    isDockTaskError(cause) ? cause : new DockTaskError({ operation, reason: "persistence", cause });

  const currentSequence = Effect.fnUntraced(function* () {
    const rows = yield* sql<{ readonly sequence: number }>`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM dock_task_events
    `;
    return rows[0]?.sequence ?? 0;
  });

  const nextTimestamp = Effect.fnUntraced(function* (minimum?: string) {
    const rows = yield* sql<{ readonly occurredAt: string | null }>`
      SELECT occurred_at AS "occurredAt" FROM dock_task_events ORDER BY sequence DESC LIMIT 1
    `;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const previous = [rows[0]?.occurredAt, minimum]
      .filter((value): value is string => value !== undefined && value !== null)
      .reduce(
        (latest, value) => Math.max(latest, DateTime.toEpochMillis(DateTime.makeUnsafe(value))),
        -1,
      );
    return DateTime.formatIso(DateTime.makeUnsafe(Math.max(now, previous + 1)));
  });

  const readTask = Effect.fnUntraced(function* (taskId: DockTaskId, operation: string) {
    const rows = yield* sql<{ readonly taskJson: string }>`
      SELECT task_json AS "taskJson" FROM dock_task_projection WHERE task_id = ${taskId}
    `;
    const row = rows[0];
    if (row === undefined) return yield* new DockTaskError({ operation, reason: "not-found" });
    return yield* decodeStoredTask(row.taskJson);
  });

  const readSnapshot = Effect.fn("TaskService.readSnapshot")(function* () {
    const sequence = yield* currentSequence();
    const rows = yield* sql<{ readonly taskJson: string }>`
      SELECT task_json AS "taskJson" FROM dock_task_projection ORDER BY created_at, task_id
    `;
    const tasks = yield* Effect.forEach(rows, (row) => decodeStoredTask(row.taskJson));
    return yield* decodeSnapshot({ sequence, tasks });
  });

  const list: TaskService["Service"]["list"] = sql
    .withTransaction(readSnapshot())
    .pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(mapPersistenceError("list")),
      Effect.withSpan("TaskService.list"),
    );

  const get: TaskService["Service"]["get"] = Effect.fn("TaskService.get")(function* (taskId) {
    return yield* sql
      .withTransaction(readTask(taskId, "get"))
      .pipe(NodeSqliteClient.readOnly, Effect.mapError(mapPersistenceError("get")));
  });

  const recordReceipt = Effect.fnUntraced(function* (
    command: TaskCommand,
    sequence: number,
    payloadJson: string,
  ) {
    yield* sql`INSERT INTO dock_task_command_receipts (command_id, payload_json, sequence)
      VALUES (${command.commandId}, ${payloadJson}, ${sequence})`;
  });

  const recordNoOpReceipt = Effect.fnUntraced(function* (
    command: TaskCommand,
    payloadJson: string,
  ) {
    const sequence = yield* currentSequence();
    yield* recordReceipt(command, sequence, payloadJson);
    return { result: { sequence }, event: undefined } as const;
  });

  const persist = Effect.fnUntraced(function* (
    command: TaskCommand,
    provenance: TaskMutationProvenance,
    task: DockTask,
    occurredAt: string,
    payloadJson: string,
  ) {
    const taskJson = yield* encodeStoredTask(task);
    yield* sql`INSERT INTO dock_task_projection (task_id, created_at, updated_at, task_json)
      VALUES (${task.id}, ${task.createdAt}, ${task.updatedAt}, ${taskJson})
      ON CONFLICT (task_id) DO UPDATE SET updated_at = excluded.updated_at, task_json = excluded.task_json`;
    const rows = yield* sql<{ readonly sequence: number }>`
      INSERT INTO dock_task_events (command_id, task_id, occurred_at, event_json)
      VALUES (${command.commandId}, ${task.id}, ${occurredAt}, '{}') RETURNING sequence
    `;
    const sequence = rows[0]?.sequence;
    if (sequence === undefined)
      return yield* new DockTaskError({ operation: command.type, reason: "persistence" });
    const event = yield* decodeEvent({
      sequence,
      commandId: command.commandId,
      occurredAt,
      change: yield* decodeChange({ type: "task.updated", task }),
      ...provenance,
    });
    const eventJson = yield* encodeStoredEvent(event);
    yield* sql`UPDATE dock_task_events SET event_json = ${eventJson} WHERE sequence = ${sequence}`;
    yield* recordReceipt(command, sequence, payloadJson);
    return { result: { sequence }, event } as const;
  });

  const history: TaskService["Service"]["history"] = Effect.fn("TaskService.history")(
    function* (input) {
      const decoded = yield* decodeHistoryInput(input);
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* readTask(decoded.taskId, "history");
            const limit = decoded.limit ?? 50;
            const rows =
              decoded.beforeSequence === undefined
                ? yield* sql<{
                    readonly eventJson: string;
                  }>`SELECT event_json AS "eventJson" FROM dock_task_events
            WHERE task_id = ${decoded.taskId} ORDER BY sequence DESC LIMIT ${limit + 1}`
                : yield* sql<{
                    readonly eventJson: string;
                  }>`SELECT event_json AS "eventJson" FROM dock_task_events
            WHERE task_id = ${decoded.taskId} AND sequence < ${decoded.beforeSequence}
            ORDER BY sequence DESC LIMIT ${limit + 1}`;
            const decodedEvents = yield* Effect.forEach(rows, (row) =>
              decodeStoredEvent(row.eventJson),
            );
            const hasMore = decodedEvents.length > limit;
            const events = decodedEvents.slice(0, limit);
            return yield* decodeHistoryResult({
              events,
              nextBeforeSequence: hasMore ? (events.at(-1)?.sequence ?? null) : null,
            });
          }),
        )
        .pipe(NodeSqliteClient.readOnly);
    },
    Effect.mapError(mapPersistenceError("history")),
  );

  const dispatch: TaskService["Service"]["dispatch"] = Effect.fn("TaskService.dispatch")(
    function* (input, provenanceInput) {
      return yield* dispatchLock
        .withPermits(1)(
          Effect.gen(function* () {
            const command = yield* decodeCommand(input);
            const provenance = yield* decodeProvenance(provenanceInput);
            const payloadJson = yield* encodeReceipt({ command, provenance });
            const committed = yield* sql.withTransaction(
              Effect.gen(function* () {
                const priorRows = yield* sql<{
                  readonly payloadJson: string;
                  readonly sequence: number;
                }>`
            SELECT payload_json AS "payloadJson", sequence FROM dock_task_command_receipts
            WHERE command_id = ${command.commandId}`;
                const priorRow = priorRows[0];
                if (priorRow !== undefined) {
                  const prior = yield* decodeReceipt(priorRow.payloadJson);
                  if (!NodeUtil.isDeepStrictEqual(prior, { command, provenance }))
                    return yield* new DockTaskError({
                      operation: command.type,
                      reason: "command-conflict",
                    });
                  return { result: { sequence: priorRow.sequence }, event: undefined } as const;
                }

                if (command.type === "task.create") {
                  const rows = yield* sql<{ readonly taskId: string }>`SELECT task_id AS "taskId"
              FROM dock_task_projection WHERE task_id = ${command.taskId}`;
                  if (rows.length > 0)
                    return yield* new DockTaskError({
                      operation: command.type,
                      reason: "duplicate-id",
                    });
                  const occurredAt = yield* nextTimestamp();
                  const task = yield* decodeTask({
                    id: command.taskId,
                    revision: 0,
                    title: command.title,
                    notes: command.notes ?? "",
                    priority: command.priority ?? "none",
                    dueDate: command.dueDate ?? null,
                    project: command.project ?? null,
                    thread: null,
                    completedAt: null,
                    archivedAt: null,
                    createdAt: occurredAt,
                    updatedAt: occurredAt,
                  });
                  return yield* persist(command, provenance, task, occurredAt, payloadJson);
                }

                const task = yield* readTask(command.taskId, command.type);
                if (command.expectedRevision !== task.revision)
                  return yield* new DockTaskError({
                    operation: command.type,
                    reason: "revision-conflict",
                  });

                let updated: DockTask | undefined;
                switch (command.type) {
                  case "task.edit": {
                    updated = yield* decodeTask({
                      ...task,
                      ...(command.title === undefined ? {} : { title: command.title }),
                      ...(command.notes === undefined ? {} : { notes: command.notes }),
                      ...(command.priority === undefined ? {} : { priority: command.priority }),
                      ...(command.dueDate === undefined ? {} : { dueDate: command.dueDate }),
                      ...(command.project === undefined ? {} : { project: command.project }),
                    });
                    if (
                      updated.title === task.title &&
                      updated.notes === task.notes &&
                      updated.priority === task.priority &&
                      updated.dueDate === task.dueDate &&
                      NodeUtil.isDeepStrictEqual(updated.project, task.project)
                    )
                      updated = undefined;
                    break;
                  }
                  case "task.link":
                    if (command.link.project.environmentId !== command.link.thread.environmentId)
                      return yield* new DockTaskError({
                        operation: command.type,
                        reason: "thread-scope-mismatch",
                      });
                    if (task.completedAt !== null || task.archivedAt !== null)
                      return yield* new DockTaskError({
                        operation: command.type,
                        reason: "inactive-task",
                      });
                    if (NodeUtil.isDeepStrictEqual(task.thread, command.link)) break;
                    updated = yield* decodeTask({
                      ...task,
                      project: task.project ?? command.link.project,
                      thread: command.link,
                    });
                    break;
                  case "task.unassign":
                    if (task.thread !== null)
                      updated = yield* decodeTask({ ...task, thread: null });
                    break;
                  case "task.complete":
                    if (task.completedAt === null)
                      updated = { ...task, completedAt: task.updatedAt };
                    break;
                  case "task.reopen":
                    if (task.completedAt !== null)
                      updated = yield* decodeTask({ ...task, completedAt: null });
                    break;
                  case "task.archive":
                    if (task.archivedAt === null) updated = { ...task, archivedAt: task.updatedAt };
                    break;
                  case "task.restore":
                    if (task.archivedAt !== null)
                      updated = yield* decodeTask({ ...task, archivedAt: null });
                    break;
                }
                if (updated === undefined) return yield* recordNoOpReceipt(command, payloadJson);
                const occurredAt = yield* nextTimestamp(task.updatedAt);
                updated = yield* decodeTask({
                  ...updated,
                  revision: task.revision + 1,
                  updatedAt: occurredAt,
                  ...(command.type === "task.complete" ? { completedAt: occurredAt } : {}),
                  ...(command.type === "task.archive" ? { archivedAt: occurredAt } : {}),
                });
                return yield* persist(command, provenance, updated, occurredAt, payloadJson);
              }),
            );
            if (committed.event !== undefined) yield* PubSub.publish(changes, committed.event);
            return committed.result;
          }),
        )
        .pipe(Effect.mapError(mapPersistenceError(input.type)));
    },
  );

  const streamChanges: TaskService["Service"]["streamChanges"] = Stream.callback((mailbox) =>
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const snapshot = yield* list;
      let lastSequence = snapshot.sequence;
      Queue.offerUnsafe(mailbox, { kind: "snapshot", snapshot });
      yield* Stream.fromSubscription(subscription).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.sequence <= lastSequence) return;
            lastSequence = event.sequence;
            Queue.offerUnsafe(mailbox, { kind: "event", event });
          }),
        ),
        Effect.forkScoped,
      );
    }),
  );

  return TaskService.of({ list, get, history, dispatch, streamChanges });
});

export const layer = Layer.effect(TaskService, make);
