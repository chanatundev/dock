import { assert, it } from "@effect/vitest";
import {
  CommandId,
  DockTaskError,
  DockTaskId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ScopedProjectRef,
  type TaskCommand,
  type TaskMutationProvenance,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { ensureDockTasksSchema } from "../persistence/ensureDockTasksSchema.ts";
import * as TaskServiceModule from "./TaskService.ts";

const layerSchemaDatabase = Layer.effectDiscard(ensureDockTasksSchema()).pipe(
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);
const layerTest = TaskServiceModule.layer.pipe(Layer.provideMerge(layerSchemaDatabase));
const provenance: TaskMutationProvenance = { createdBy: "user", creationSource: "web" };
const commandId = (value: string) => CommandId.make(`command:${value}`);
const taskId = (value: string) => DockTaskId.make(`task:${value}`);
const project = (env = "env"): ScopedProjectRef => ({
  environmentId: EnvironmentId.make(env),
  projectId: ProjectId.make(`project:${env}`),
});
const taskLink = (env = "env") => ({
  project: project(env),
  thread: { environmentId: EnvironmentId.make(env), threadId: ThreadId.make(`thread:${env}`) },
  linkedAt: "2026-10-29T00:00:00.000Z",
});
const create = (
  key: string,
  title = key,
  fields: Partial<Extract<TaskCommand, { readonly type: "task.create" }>> = {},
): Extract<TaskCommand, { readonly type: "task.create" }> => ({
  type: "task.create",
  commandId: commandId(`create-${key}`),
  taskId: taskId(key),
  title,
  ...fields,
});
const expectReason = <A>(effect: Effect.Effect<A, DockTaskError>, reason: string) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(effect);
    assert.equal(error.reason, reason);
  });

const resetState = Effect.fn("TaskServiceTest.resetState")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM dock_task_events`;
  yield* sql`DELETE FROM dock_task_projection`;
  yield* sql`DELETE FROM dock_task_command_receipts`;
  yield* sql`DELETE FROM sqlite_sequence WHERE name = 'dock_task_events'`;
});

it.layer(Layer.fresh(layerTest))("TaskService", (it) => {
  it.effect(
    "creates, edits with optimistic revisions, and rejects conflicting command replay",
    () =>
      Effect.gen(function* () {
        yield* resetState();
        const service = yield* TaskServiceModule.TaskService;
        const command = create("basic", "Initial");
        const created = yield* service.dispatch(command, provenance);
        assert.equal(created.sequence, 1);
        assert.deepEqual(yield* service.dispatch(command, provenance), created);
        yield* expectReason(
          service.dispatch({ ...command, title: "Different" }, provenance),
          "command-conflict",
        );
        const edit = {
          type: "task.edit" as const,
          commandId: commandId("edit-basic"),
          taskId: taskId("basic"),
          expectedRevision: 0,
          title: "Updated",
          project: project(),
        };
        const edited = yield* service.dispatch(edit, provenance);
        assert.equal(edited.sequence, 2);
        const task = yield* service.get(taskId("basic"));
        assert.equal(task.revision, 1);
        assert.equal(task.title, "Updated");
        yield* expectReason(
          service.dispatch({ ...edit, commandId: commandId("stale-edit") }, provenance),
          "revision-conflict",
        );
      }),
  );

  it.effect("links and unassigns an ordinary scoped thread without execution dependencies", () =>
    Effect.gen(function* () {
      yield* resetState();
      const service = yield* TaskServiceModule.TaskService;
      yield* service.dispatch(create("link"), provenance);
      const link = taskLink();
      const linked = {
        type: "task.link" as const,
        commandId: commandId("link-task"),
        taskId: taskId("link"),
        expectedRevision: 0,
        link,
      };
      yield* service.dispatch(linked, provenance);
      const linkedTask = yield* service.get(taskId("link"));
      assert.deepEqual(linkedTask.thread, link);
      assert.deepEqual(linkedTask.project, link.project);
      yield* service.dispatch(
        {
          type: "task.unassign",
          commandId: commandId("unlink-task"),
          taskId: taskId("link"),
          expectedRevision: 1,
        },
        provenance,
      );
      assert.equal((yield* service.get(taskId("link"))).thread, null);

      yield* service.dispatch(
        create("independent-project", "Independent", { project: project("label") }),
        provenance,
      );
      yield* service.dispatch(
        {
          type: "task.link",
          commandId: commandId("link-independent"),
          taskId: taskId("independent-project"),
          expectedRevision: 0,
          link,
        },
        provenance,
      );
      assert.deepEqual(
        (yield* service.get(taskId("independent-project"))).project,
        project("label"),
      );
    }),
  );

  it.effect("preserves thread links across complete, reopen, archive, and restore", () =>
    Effect.gen(function* () {
      yield* resetState();
      const service = yield* TaskServiceModule.TaskService;
      yield* service.dispatch(create("lifecycle"), provenance);
      const link = taskLink();
      yield* service.dispatch(
        {
          type: "task.link",
          commandId: commandId("lifecycle-link"),
          taskId: taskId("lifecycle"),
          expectedRevision: 0,
          link,
        },
        provenance,
      );
      const mutate = (
        type: "task.complete" | "task.reopen" | "task.archive" | "task.restore",
        revision: number,
        id: string,
      ) =>
        service.dispatch(
          {
            type,
            commandId: commandId(id),
            taskId: taskId("lifecycle"),
            expectedRevision: revision,
          },
          provenance,
        );
      let revision = 1;
      for (const [type, id] of [
        ["task.complete", "complete"],
        ["task.reopen", "reopen"],
        ["task.archive", "archive"],
        ["task.restore", "restore"],
      ] as const) {
        yield* mutate(type, revision++, id);
        const task = yield* service.get(taskId("lifecycle"));
        assert.deepEqual(task.thread, link);
        assert.equal(task.revision, revision);
        if (type === "task.complete")
          yield* expectReason(
            service.dispatch(
              {
                type: "task.link",
                commandId: commandId("completed-link"),
                taskId: taskId("lifecycle"),
                expectedRevision: revision,
                link,
              },
              provenance,
            ),
            "inactive-task",
          );
      }
      const archived = yield* service.dispatch(
        {
          type: "task.archive",
          commandId: commandId("archive-again"),
          taskId: taskId("lifecycle"),
          expectedRevision: revision,
        },
        provenance,
      );
      revision++;
      yield* expectReason(
        service.dispatch(
          {
            type: "task.link",
            commandId: commandId("inactive-link"),
            taskId: taskId("lifecycle"),
            expectedRevision: revision,
            link,
          },
          provenance,
        ),
        "inactive-task",
      );
      assert.equal(archived.sequence, revision + 1);
    }),
  );

  it.effect("provides ordered snapshots, events, and compact history", () =>
    Effect.gen(function* () {
      yield* resetState();
      const service = yield* TaskServiceModule.TaskService;
      yield* service.dispatch(create("stream"), provenance);
      const items = yield* service.streamChanges.pipe(
        Stream.tap((item) =>
          item.kind === "snapshot"
            ? service.dispatch(create("stream-event"), provenance).pipe(Effect.asVoid)
            : Effect.void,
        ),
        Stream.take(2),
        Stream.runCollect,
      );
      const snapshot = items[0];
      const event = items[1];
      assert.equal(snapshot?.kind, "snapshot");
      assert.equal(event?.kind, "event");
      if (snapshot?.kind !== "snapshot" || event?.kind !== "event")
        return yield* Effect.die("Expected a Task snapshot followed by an event");
      if (event.event.change.type !== "task.updated")
        return yield* Effect.die("Expected a Task update event");
      assert.equal(snapshot.snapshot.sequence, 1);
      assert.equal(event.event.sequence, 2);
      assert.equal(event.event.change.task.id, taskId("stream-event"));
      const history = yield* service.history({ taskId: taskId("stream") });
      assert.equal(history.events.length, 1);
      assert.equal(history.events[0]?.sequence, 1);
    }),
  );
});

it.effect("keeps existing task tables and rows when reopening the schema", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* ensureDockTasksSchema();
    const unusedTables = yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'dock_task_assignment_identities'`;
    assert.deepEqual(unusedTables, []);
    yield* sql`CREATE TABLE IF NOT EXISTS dock_task_claim_releases (assignment_id TEXT PRIMARY KEY)`;
    yield* sql`INSERT INTO dock_task_claim_releases (assignment_id) VALUES ('legacy')`;
    yield* sql`INSERT INTO dock_task_projection (task_id, created_at, updated_at, task_json)
      VALUES ('legacy-task', '2026-10-24T00:00:00Z', '2026-10-24T00:00:00Z', '{"preserve":true}')`;
    yield* ensureDockTasksSchema();
    const rows = yield* sql<{
      readonly assignmentId: string;
    }>`SELECT assignment_id AS "assignmentId" FROM dock_task_claim_releases`;
    const tasks = yield* sql<{
      readonly taskJson: string;
    }>`SELECT task_json AS "taskJson" FROM dock_task_projection`;
    assert.deepEqual(rows, [{ assignmentId: "legacy" }]);
    assert.deepEqual(tasks, [{ taskJson: '{"preserve":true}' }]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
