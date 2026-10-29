import {
  DockTaskId,
  OrchestratorMcpFailure,
  summarizeDockTasks,
  type DockTaskError,
  type TaskCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Tasks from "../../../tasks/TaskService.ts";
import * as Inbox from "../../../inbox/InboxRecapService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { newCommandId, readCaller } from "../../threadAccess.ts";
import { TasksToolkit } from "./tools.ts";

const failure = (error: DockTaskError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
const mutate = Effect.fn("mcp.tasks.mutate")(function* (command: TaskCommand) {
  const { scope } = yield* readCaller();
  const tasks = yield* Tasks.TaskService;
  return yield* tasks
    .dispatch(command, {
      createdBy: scope.thread === undefined ? "user" : "agent",
      creationSource: "mcp",
    })
    .pipe(Effect.mapError(failure));
});

export const layer = McpToolAccess.toLayer(TasksToolkit, {
  t3_inbox_recap: McpToolAccess.reads((input) =>
    Inbox.InboxRecapService.pipe(
      Effect.flatMap((inbox) => inbox.read(input)),
      Effect.mapError(
        (error) =>
          new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
      ),
    ),
  ),
  t3_task_list: McpToolAccess.reads(() =>
    Tasks.TaskService.pipe(
      Effect.flatMap((tasks) => tasks.list),
      Effect.map(summarizeDockTasks),
      Effect.mapError(failure),
    ),
  ),
  t3_task_read: McpToolAccess.reads((input) =>
    Tasks.TaskService.pipe(
      Effect.flatMap((tasks) => tasks.get(input.taskId)),
      Effect.mapError(failure),
    ),
  ),
  t3_task_history: McpToolAccess.reads((input) =>
    Tasks.TaskService.pipe(
      Effect.flatMap((tasks) => tasks.history(input)),
      Effect.mapError(failure),
    ),
  ),
  t3_task_create: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const commandId = yield* newCommandId();
      const taskId = DockTaskId.make(commandId);
      return { ...(yield* mutate({ ...input, type: "task.create", commandId, taskId })), taskId };
    }),
  ),
  t3_task_edit: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      return yield* mutate({ ...input, type: "task.edit", commandId: yield* newCommandId() });
    }),
  ),
  t3_task_set_state: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      return yield* mutate({
        type: `task.${input.action}`,
        taskId: input.taskId,
        expectedRevision: input.expectedRevision,
        commandId: yield* newCommandId(),
      });
    }),
  ),
  t3_task_link: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      return yield* mutate({ ...input, type: "task.link", commandId: yield* newCommandId() });
    }),
  ),
});
