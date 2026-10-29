import { expect, it } from "@effect/vitest";
import { EnvironmentId, type RuntimeMode } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { McpSchema, Tool } from "effect/ai";
import * as Tasks from "../../../tasks/TaskService.ts";
import * as Inbox from "../../../inbox/InboxRecapService.ts";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as TaskHandlers from "./handlers.ts";
import { TasksToolkit } from "./tools.ts";

it("publishes Task tools as valid MCP object schemas", () => {
  const decode = Schema.decodeUnknownSync(McpSchema.ToolJson);
  for (const tool of Object.values(TasksToolkit.tools)) {
    expect(decode(Tool.getJsonSchema(tool)).type).toBe("object");
  }
});

const harness = (access: RuntimeMode | "read-only") =>
  Layer.mergeAll(
    Tasks.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)),
    Layer.mock(Inbox.InboxRecapService)({}),
    NodeCrypto.layer,
    NodeServices.layer,
    Layer.mock(ThreadManagement.ThreadManagementService)({}),
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("task-mcp"),
      requestNamespace: "client:tasks",
      thread: undefined,
      client: { sessionId: "tasks", label: "Task test", access },
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
  );

it.effect("creates standalone Tasks and supports their metadata lifecycle", () =>
  Effect.gen(function* () {
    const toolkit = yield* TasksToolkit.pipe(
      Effect.provide(McpToolAccess.HandlersLayer.layer(TaskHandlers.layer)),
    );
    const created = yield* toolkit
      .handle("t3_task_create", { title: "Investigate layout", notes: "Detailed task" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(created.at(-1)?.result).toMatchObject({ sequence: 1 });
    const tasks = yield* Tasks.TaskService;
    const task = (yield* tasks.list).tasks[0]!;
    expect(task.id.length).toBeGreaterThan(0);
    expect(task.project).toBeNull();
    expect(task.thread).toBeNull();
    expect(task.notes).toBe("Detailed task");
    expect((yield* tasks.history({ taskId: task.id })).events[0]).toMatchObject({
      createdBy: "user",
      creationSource: "mcp",
    });
    const completed = yield* toolkit
      .handle("t3_task_set_state", { taskId: task.id, expectedRevision: 0, action: "complete" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(completed.at(-1)?.result).toMatchObject({ sequence: 2 });
    expect((yield* tasks.get(task.id)).completedAt).not.toBeNull();
    yield* toolkit
      .handle("t3_task_set_state", { taskId: task.id, expectedRevision: 1, action: "reopen" })
      .pipe(Stream.unwrap, Stream.runDrain);
    yield* toolkit
      .handle("t3_task_set_state", { taskId: task.id, expectedRevision: 2, action: "archive" })
      .pipe(Stream.unwrap, Stream.runDrain);
    expect((yield* tasks.get(task.id)).completedAt).toBeNull();
    expect((yield* tasks.get(task.id)).archivedAt).not.toBeNull();
    const stale = yield* toolkit
      .handle("t3_task_edit", { taskId: task.id, expectedRevision: 0, title: "Stale" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(stale.at(-1)?.result).toMatchObject({ code: "orchestration_error" });
    expect((yield* tasks.get(task.id)).title).toBe("Investigate layout");
  }).pipe(Effect.provide(harness("full-access")), Effect.scoped),
);

it.effect("refuses read-only MCP clients before changing canonical Task state", () =>
  Effect.gen(function* () {
    const toolkit = yield* TasksToolkit.pipe(
      Effect.provide(McpToolAccess.HandlersLayer.layer(TaskHandlers.layer)),
    );
    const result = yield* toolkit
      .handle("t3_task_create", { title: "Forbidden" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(result.at(-1)?.result).toMatchObject({ code: "capability_denied" });
    const snapshot = yield* Tasks.TaskService.pipe(Effect.flatMap((tasks) => tasks.list));
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.sequence).toBe(0);
  }).pipe(Effect.provide(harness("read-only")), Effect.scoped),
);
