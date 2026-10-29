import { describe, expect, it } from "vite-plus/test";
import {
  DockTaskId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type DockTaskSummary,
} from "@t3tools/contracts";
import { taskBoardStatus, type TaskThreadActivity } from "./taskBoard.ts";

const at = "2026-10-24T12:00:00.000Z";
const env = EnvironmentId.make("execution");
const task = (): DockTaskSummary => ({
  id: DockTaskId.make("task"),
  revision: 1,
  title: "Investigate",
  priority: "none",
  dueDate: null,
  project: null,
  thread: {
    project: { environmentId: env, projectId: ProjectId.make("project") },
    thread: { environmentId: env, threadId: ThreadId.make("thread") },
    linkedAt: at,
  },
  completedAt: null,
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
});
const thread = (): TaskThreadActivity => ({
  id: ThreadId.make("thread"),
  environmentId: env,
  latestRun: { status: "running" },
  runtime: { activeRunId: null, status: "running" },
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
  hasActionableProposedPlan: false,
});

describe("linked Task activity", () => {
  it("derives activity from its ordinary linked thread and leaves completion explicit", () => {
    expect(taskBoardStatus(task(), thread())).toEqual({ kind: "working", label: "Working" });
    expect(taskBoardStatus(task(), { ...thread(), latestRun: { status: "completed" } })).toEqual({
      kind: "finished",
      label: "Finished",
    });
    expect(taskBoardStatus({ ...task(), completedAt: at }, thread())).toEqual({
      kind: "completed",
      label: "Completed",
    });
  });

  it("shows unavailable and attention states without attributing unrelated thread activity", () => {
    expect(taskBoardStatus(task(), null).label).toBe("Thread unavailable");
    expect(
      taskBoardStatus(task(), { ...thread(), environmentId: EnvironmentId.make("other") }).label,
    ).toBe("Thread unavailable");
    expect(taskBoardStatus({ ...task(), thread: null }, thread()).label).toBe("Not started");
    expect(taskBoardStatus(task(), { ...thread(), hasPendingApprovals: true }).label).toBe(
      "Approval needed",
    );
    expect(taskBoardStatus(task(), { ...thread(), latestRun: { status: "failed" } }).label).toBe(
      "Run failed",
    );
  });
});
