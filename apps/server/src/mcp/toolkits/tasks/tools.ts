import {
  DockTask,
  DockTaskId,
  TaskCommand,
  TaskHistoryInput,
  TaskHistoryResult,
  TaskMutationResult,
  TaskSummariesSnapshot,
  OrchestratorMcpFailure,
  InboxRecap,
  InboxRecapInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Crypto from "effect/Crypto";
import { Tool, Toolkit } from "effect/ai";
import * as Tasks from "../../../tasks/TaskService.ts";
import * as Inbox from "../../../inbox/InboxRecapService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    Tasks.TaskService,
    ThreadManagement.ThreadManagementService,
    McpInvocationContext.McpInvocationContext,
    Crypto.Crypto,
  ],
};
const List = Tool.make("t3_task_list", {
  ...shared,
  description:
    "List this environment's canonical Tasks. A Task can exist without a project or linked thread. Use t3_task_read for its notes and link.",
  parameters: Tool.EmptyParams,
  success: TaskSummariesSnapshot,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const Get = Tool.make("t3_task_read", {
  ...shared,
  description: "Read a Task's full notes, project and linked thread.",
  parameters: Schema.Struct({ taskId: DockTaskId }),
  success: DockTask,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const History = Tool.make("t3_task_history", {
  ...shared,
  description: "Read Task history newest first; pass nextBeforeSequence to continue.",
  parameters: TaskHistoryInput,
  success: TaskHistoryResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const create = TaskCommand.members[0];
const edit = TaskCommand.members[1];
const Create = Tool.make("t3_task_create", {
  ...shared,
  description:
    "Create a Task in this environment. A project is optional. Returns the generated Task identity.",
  parameters: Schema.Struct({
    title: create.fields.title,
    notes: create.fields.notes,
    priority: create.fields.priority,
    dueDate: create.fields.dueDate,
    project: create.fields.project,
  }),
  success: Schema.Struct({ taskId: DockTaskId, ...TaskMutationResult.fields }),
}).annotate(Tool.Destructive, false);
const Edit = Tool.make("t3_task_edit", {
  ...shared,
  description:
    "Edit Task metadata using its current revision. Omitted fields are preserved; null clears project or due date.",
  parameters: Schema.Struct({
    taskId: DockTaskId,
    expectedRevision: edit.fields.expectedRevision,
    title: edit.fields.title,
    notes: edit.fields.notes,
    priority: edit.fields.priority,
    dueDate: edit.fields.dueDate,
    project: edit.fields.project,
  }),
  success: TaskMutationResult,
}).annotate(Tool.Destructive, false);
const Lifecycle = Tool.make("t3_task_set_state", {
  ...shared,
  description:
    "Complete/reopen, archive/restore or clear the linked thread using the current revision.",
  parameters: Schema.Struct({
    taskId: DockTaskId,
    expectedRevision: edit.fields.expectedRevision,
    action: Schema.Literals(["complete", "reopen", "archive", "restore", "unassign"]),
  }),
  success: TaskMutationResult,
}).annotate(Tool.Destructive, true);

const link = TaskCommand.members[3];
const Link = Tool.make("t3_task_link", {
  ...shared,
  description: "Link a Task to an existing ordinary T3 thread in the same environment.",
  parameters: Schema.Struct({
    taskId: DockTaskId,
    expectedRevision: edit.fields.expectedRevision,
    link: link.fields.link,
  }),
  success: TaskMutationResult,
}).annotate(Tool.Destructive, true);
export const TasksToolkit = Toolkit.make(
  Tool.make("t3_inbox_recap", {
    ...shared,
    dependencies: [...shared.dependencies, Inbox.InboxRecapService],
    description:
      "Read this environment's recorded-work recap for an explicit time window of at most 48 hours. Supply ordered absolute slot boundaries, normally client-local 04:00, 12:00 and 18:00. Includes human prompts, app runs, overlapping agent work and reported main-agent tokens; missing usage is explicit. This does not scan unrelated provider sessions or modify Inbox read state.",
    parameters: InboxRecapInput,
    success: InboxRecap,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  List,
  Get,
  History,
  Create,
  Edit,
  Lifecycle,
  Link,
);
