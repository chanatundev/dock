import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  DockTask,
  DockTaskId,
  TaskCommand,
  TaskDueDate,
  TaskEvent,
  TaskThreadLink,
} from "./tasks.ts";
import { summarizeDockTasksStreamItem } from "./taskSummary.ts";

const decodeCommand = Schema.decodeUnknownSync(TaskCommand);
const decodeDueDate = Schema.decodeUnknownSync(TaskDueDate);
const decodeTask = Schema.decodeUnknownSync(DockTask);
const decodeTaskEvent = Schema.decodeUnknownSync(TaskEvent);
const isCommand = Schema.is(TaskCommand);
const isTaskThreadLink = Schema.is(TaskThreadLink);

describe("Dock Task contract", () => {
  it("accepts metadata without a project or thread", () => {
    const command = {
      type: "task.create",
      commandId: "create",
      taskId: "task",
      title: "  Investigate layout  ",
    };
    expect(decodeCommand(command)).toMatchObject({ title: "Investigate layout" });
  });

  it("validates due dates as calendar days", () => {
    expect(decodeDueDate("2024-02-29")).toBe("2024-02-29");
    for (const date of ["2026-02-29", "2026-13-01", "2026-01-01T00:00:00Z"])
      expect(() => decodeDueDate(date)).toThrow();
  });

  it("requires revisions for edits and validates scoped thread links", () => {
    const edit = { type: "task.edit", commandId: "edit", taskId: "task", title: "Changed" };
    expect(isCommand(edit)).toBe(false);
    expect(isCommand({ ...edit, expectedRevision: 0 })).toBe(true);
    const link = {
      project: { environmentId: "environment", projectId: "project" },
      thread: { environmentId: "environment", threadId: "thread" },
      linkedAt: "2026-10-24T00:00:00.000Z",
    };
    expect(isTaskThreadLink(link)).toBe(true);
    expect(isTaskThreadLink({ ...link, thread: { ...link.thread, environmentId: "other" } })).toBe(
      false,
    );
  });

  it("ignores removed execution fields when reading legacy task rows", () => {
    const task = {
      id: DockTaskId.make("task"),
      revision: 0,
      title: "Task",
      notes: "",
      priority: "none",
      dueDate: null,
      project: null,
      thread: null,
      completedAt: null,
      archivedAt: null,
      createdAt: "2026-10-24T00:00:00.000Z",
      updatedAt: "2026-10-24T00:00:00.000Z",
      hubId: "old-hub",
      assignment: { old: true },
    };
    expect(decodeTask(task)).not.toHaveProperty("assignment");
  });

  it("keeps legacy release acknowledgements readable in compact history streams", () => {
    const event = decodeTaskEvent({
      sequence: 3,
      commandId: "legacy-release",
      occurredAt: "2026-10-24T00:00:00.000Z",
      change: { type: "task.release.acknowledged", assignmentId: "old-assignment" },
      createdBy: "user",
      creationSource: "web",
      executionLimit: null,
    });
    expect(summarizeDockTasksStreamItem({ kind: "event", event })).toMatchObject({
      kind: "event",
      event: { change: { type: "task.release.acknowledged", assignmentId: "old-assignment" } },
    });
  });
});
