// Inbox behavior tests adapted from Synara's apps/web/src/components/inbox/inbox.logic.test.ts,
// revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import {
  DockTaskId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type DockTaskSummary,
} from "@t3tools/contracts";
import type { TaskActivityStatus } from "@t3tools/client-runtime/task-board";
import type {
  EnvironmentThreadShell,
  ThreadRuntimeSummary,
} from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadFixture, type ThreadFixtureOverrides } from "./test-fixtures";
import { groupDockInboxThreads, selectDockInboxTasks, type DockInboxTask } from "./dockInbox.logic";

const NOW = "2026-10-24T12:00:00.000Z";

function runtime(status: ThreadRuntimeSummary["status"], updatedAt = NOW): ThreadRuntimeSummary {
  return {
    status,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "codex",
    lastError: status === "failed" ? "Run failed" : null,
    updatedAt,
  };
}

function settledThread(
  id: string,
  status: "completed" | "failed",
  completedAt: string,
  overrides: ThreadFixtureOverrides = {},
): EnvironmentThreadShell {
  const runId = RunId.make(`run-${id}-${status}`);
  return makeThreadFixture({
    id: ThreadId.make(id),
    latestRun: {
      runId,
      status,
      requestedAt: "2026-10-24T08:00:00.000Z",
      startedAt: "2026-10-24T08:01:00.000Z",
      completedAt,
      assistantMessageId: null,
    },
    runtime: runtime(status, completedAt),
    lastVisitedAt: status === "completed" ? "2026-10-24T08:00:00.000Z" : null,
    ...overrides,
  });
}

function workingThread(id: string, environmentId: string, sentAt: string): EnvironmentThreadShell {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make(environmentId),
    latestUserAuthoredMessageAt: sentAt,
    runtime: runtime("running", sentAt),
  });
}

describe("groupDockInboxThreads", () => {
  it("places each scoped thread in one group and retains equal IDs from separate environments", () => {
    const id = ThreadId.make("same-thread");
    const first = makeThreadFixture({
      id,
      environmentId: EnvironmentId.make("env-a"),
      hasPendingApprovals: true,
    });
    const second = makeThreadFixture({
      id,
      environmentId: EnvironmentId.make("env-b"),
      hasPendingUserInput: true,
    });
    const busy = workingThread("busy", "env-a", "2026-10-24T11:30:00.000Z");
    const finished = settledThread("finished", "completed", "2026-10-24T10:00:00.000Z", {
      lastVisitedAt: "2026-10-24T09:00:00.000Z",
    });
    const failed = settledThread("failed", "failed", "2026-10-24T10:30:00.000Z");
    const groups = groupDockInboxThreads([first, first, second, busy, finished, failed], NOW);
    const grouped = [
      ...groups.needsYou.map(({ thread }) => thread),
      ...groups.working,
      ...groups.finished,
      ...groups.failed,
    ];
    const keys = grouped.map((thread) => JSON.stringify([thread.environmentId, thread.id]));

    expect(groups.needsYou.map(({ thread, kind }) => [thread.environmentId, kind])).toEqual([
      [EnvironmentId.make("env-a"), "approval"],
      [EnvironmentId.make("env-b"), "input"],
    ]);
    expect(groups.working).toEqual([busy]);
    expect(groups.finished).toEqual([finished]);
    expect(groups.failed).toEqual([failed]);
    expect(new Set(keys).size).toBe(grouped.length);
  });

  it("orders needs-you kinds by priority and each kind by the freshest return", () => {
    const approvalOld = settledThread("approval-old", "completed", "2026-10-24T09:00:00.000Z", {
      hasPendingApprovals: true,
    });
    const approvalFresh = settledThread("approval-fresh", "completed", "2026-10-24T11:00:00.000Z", {
      hasPendingApprovals: true,
    });
    const input = settledThread("input", "completed", "2026-10-24T11:30:00.000Z", {
      hasPendingUserInput: true,
    });
    const plan = settledThread("plan", "completed", "2026-10-24T11:45:00.000Z", {
      interactionMode: "plan",
      hasActionableProposedPlan: true,
    });

    expect(groupDockInboxThreads([approvalOld, input, plan, approvalFresh], NOW).needsYou).toEqual([
      { thread: approvalFresh, kind: "approval" },
      { thread: approvalOld, kind: "approval" },
      { thread: input, kind: "input" },
      { thread: plan, kind: "plan" },
    ]);
  });

  it("keeps sidechat hand-raises in Needs-you and leaves generic activity for the host list", () => {
    const approval = {
      ...settledThread("sidechat-approval", "completed", "2026-10-24T10:00:00.000Z", {
        hasPendingApprovals: true,
      }),
      sidechatSourceThreadId: ThreadId.make("source-approval"),
    };
    const input = {
      ...settledThread("sidechat-input", "completed", "2026-10-24T10:30:00.000Z", {
        hasPendingUserInput: true,
      }),
      sidechatSourceThreadId: ThreadId.make("source-input"),
    };
    const snoozedApproval = {
      ...settledThread("sidechat-snoozed", "completed", "2026-10-24T10:15:00.000Z", {
        hasPendingApprovals: true,
      }),
      sidechatSourceThreadId: ThreadId.make("source-snoozed"),
      snoozedAt: "2026-10-24T11:30:00.000Z",
      snoozedUntil: "2026-10-24T13:00:00.000Z",
    };
    const plan = {
      ...settledThread("sidechat-plan", "completed", "2026-10-24T11:00:00.000Z", {
        interactionMode: "plan",
        hasActionableProposedPlan: true,
      }),
      sidechatSourceThreadId: ThreadId.make("source-plan"),
    };
    const working = {
      ...workingThread("sidechat-working", "env-a", "2026-10-24T11:30:00.000Z"),
      sidechatSourceThreadId: ThreadId.make("source-working"),
    };
    const finished = {
      ...settledThread("sidechat-finished", "completed", "2026-10-24T11:30:00.000Z"),
      sidechatSourceThreadId: ThreadId.make("source-finished"),
    };
    const failed = {
      ...settledThread("sidechat-failed", "failed", "2026-10-24T11:30:00.000Z"),
      sidechatContext: {
        kind: "github-issue" as const,
        sourceEnvironmentId: EnvironmentId.make("env-a"),
        projectId: ProjectId.make("project-issue"),
        host: "github.com",
        repository: "org/repo",
        number: 42,
        title: "Issue",
        url: "https://github.com/org/repo/issues/42",
        updatedAt: "2026-10-24T12:00:00.000Z",
      },
      sidechatExpiredAt: "2026-10-24T11:00:00.000Z",
    };

    const groups = groupDockInboxThreads(
      [approval, input, snoozedApproval, plan, working, finished, failed],
      NOW,
    );

    expect(groups.needsYou.map(({ thread, kind }) => [thread.id, kind])).toEqual([
      [ThreadId.make("sidechat-snoozed"), "approval"],
      [ThreadId.make("sidechat-approval"), "approval"],
      [ThreadId.make("sidechat-input"), "input"],
      [ThreadId.make("sidechat-plan"), "plan"],
    ]);
    expect(groups.working).toEqual([]);
    expect(groups.finished).toEqual([]);
    expect(groups.failed).toEqual([]);
  });

  it("sorts busy work by the shared send ordering", () => {
    const earlier = workingThread("earlier", "env-a", "2026-10-24T10:00:00.000Z");
    const later = workingThread("later", "env-a", "2026-10-24T11:00:00.000Z");

    expect(groupDockInboxThreads([earlier, later], NOW).working).toEqual([later, earlier]);
  });

  it("shows unvisited completions and clears them at the server visit watermark", () => {
    const unseen = settledThread("unseen", "completed", "2026-10-24T10:00:00.000Z", {
      lastVisitedAt: "2026-10-24T09:00:00.000Z",
    });
    const visited = { ...unseen, lastVisitedAt: "2026-10-24T10:00:00.000Z" };
    const unvisited = { ...unseen, lastVisitedAt: null };

    expect(groupDockInboxThreads([unvisited], NOW).finished).toEqual([unvisited]);
    expect(groupDockInboxThreads([unseen], NOW).finished).toEqual([unseen]);
    expect(groupDockInboxThreads([visited], NOW).finished).toEqual([]);
  });

  it("excludes deleted, archived, delegated child, and sleeping threads but includes wakes", () => {
    const hiddenSleep = workingThread("sleep", "env-a", "2026-10-24T11:00:00.000Z");
    const sleeping = {
      ...hiddenSleep,
      snoozedUntil: "2026-10-24T13:00:00.000Z",
      snoozedAt: "2026-10-24T11:30:00.000Z",
    };
    const archived = workingThread("archived", "env-a", "2026-10-24T11:00:00.000Z");
    const deleted = workingThread("deleted", "env-a", "2026-10-24T11:00:00.000Z");
    const parentId = ThreadId.make("parent");
    const delegated = makeThreadFixture({
      id: ThreadId.make("child"),
      environmentId: EnvironmentId.make("env-a"),
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
      runtime: runtime("running"),
    });
    const woke = {
      ...sleeping,
      id: ThreadId.make("woke"),
      snoozedUntil: "2026-10-24T11:00:00.000Z",
    };
    const handRaised = {
      ...sleeping,
      id: ThreadId.make("hand-raised"),
      hasPendingApprovals: true,
    };

    const groups = groupDockInboxThreads(
      [
        sleeping,
        { ...archived, archivedAt: "2026-10-24T11:00:00.000Z" },
        { ...deleted, deletedAt: "2026-10-24T11:00:00.000Z" },
        delegated,
        woke,
        handRaised,
      ],
      NOW,
    );

    expect(groups.working.map((thread) => thread.id)).toEqual([ThreadId.make("woke")]);
    expect(groups.needsYou.map(({ thread, kind }) => [thread.id, kind])).toEqual([
      [ThreadId.make("hand-raised"), "approval"],
    ]);
  });
});

type TaskOverrides = {
  readonly linked?: boolean;
  readonly archivedAt?: string | null;
  readonly completedAt?: string | null;
  readonly createdAt?: string;
  readonly dueDate?: string | null;
  readonly priority?: DockTaskSummary["priority"];
  readonly status?: TaskActivityStatus["kind"];
};

function taskRow(id: string, environment: string, overrides: TaskOverrides = {}): DockInboxTask {
  const environmentId = EnvironmentId.make(environment);
  const status = overrides.status ?? "idle";
  return {
    environmentId,
    task: {
      id: DockTaskId.make(id),
      revision: 0,
      title: id,
      priority: overrides.priority ?? "none",
      dueDate: overrides.dueDate ?? null,
      project: null,
      thread: overrides.linked
        ? {
            project: { environmentId, projectId: ProjectId.make("project-task") },
            thread: { environmentId, threadId: ThreadId.make(`thread-${id}`) },
            linkedAt: NOW,
          }
        : null,
      completedAt: overrides.completedAt ?? null,
      archivedAt: overrides.archivedAt ?? null,
      createdAt: overrides.createdAt ?? "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    },
    status: { kind: status, label: status },
  };
}

describe("selectDockInboxTasks", () => {
  it("keeps a linked empty thread visible for review before the first send", () => {
    const linked = taskRow("linked", "owner", { linked: true });
    expect(
      selectDockInboxTasks(
        [linked],
        { fromMs: Date.parse(NOW), toMs: Date.parse("2026-10-25T12:00:00Z") },
        "2026-10-24",
      ).open,
    ).toEqual([linked]);
  });
  const day = {
    fromMs: Date.parse("2026-10-24T04:00:00.000Z"),
    toMs: Date.parse("2026-10-25T04:00:00.000Z"),
  };
  const today = "2026-10-24";

  it("keeps linked, due, and active tasks, counts overdue, and excludes archived items", () => {
    const rows = [
      taskRow("backlog", "env-a"),
      taskRow("later", "env-a", { dueDate: "2026-10-25" }),
      taskRow("today", "env-a", { dueDate: today }),
      taskRow("overdue", "env-a", { dueDate: "2026-10-23" }),
      taskRow("working", "env-a", { status: "working" }),
      taskRow("needs-you", "env-a", { status: "attention" }),
      taskRow("review", "env-a", { status: "finished" }),
      taskRow("linked", "env-a", { linked: true }),
      taskRow("archived", "env-a", { dueDate: "2026-10-23", archivedAt: NOW }),
    ];

    const result = selectDockInboxTasks(rows, day, today);

    expect(result.open.map(({ task }) => task.id)).toEqual([
      DockTaskId.make("overdue"),
      DockTaskId.make("today"),
      DockTaskId.make("linked"),
      DockTaskId.make("needs-you"),
      DockTaskId.make("review"),
      DockTaskId.make("working"),
    ]);
    expect(result.doneToday).toEqual([]);
    expect(result.overdue).toBe(1);
  });

  it("sorts due date before priority, then priority before creation and scoped identity", () => {
    const rows = [
      taskRow("urgent-tomorrow", "env-a", {
        dueDate: "2026-10-25",
        priority: "urgent",
        status: "working",
      }),
      taskRow("low-today", "env-a", {
        dueDate: today,
        priority: "low",
        createdAt: "2026-10-20T00:00:00.000Z",
      }),
      taskRow("high-later-created", "env-a", {
        dueDate: today,
        priority: "high",
        createdAt: "2026-10-22T00:00:00.000Z",
      }),
      taskRow("high-early-created", "env-a", {
        dueDate: today,
        priority: "high",
        createdAt: "2026-10-20T00:00:00.000Z",
      }),
      taskRow("same", "env-b", {
        dueDate: today,
        priority: "high",
        createdAt: "2026-10-20T00:00:00.000Z",
      }),
      taskRow("same", "env-a", {
        dueDate: today,
        priority: "high",
        createdAt: "2026-10-20T00:00:00.000Z",
      }),
    ];

    expect(
      selectDockInboxTasks(rows, day, today).open.map(({ task, environmentId }) => [
        environmentId,
        task.id,
      ]),
    ).toEqual([
      [EnvironmentId.make("env-a"), DockTaskId.make("high-early-created")],
      [EnvironmentId.make("env-a"), DockTaskId.make("same")],
      [EnvironmentId.make("env-b"), DockTaskId.make("same")],
      [EnvironmentId.make("env-a"), DockTaskId.make("high-later-created")],
      [EnvironmentId.make("env-a"), DockTaskId.make("low-today")],
      [EnvironmentId.make("env-a"), DockTaskId.make("urgent-tomorrow")],
    ]);
  });

  it("counts only explicit task completions in the half-open day and keeps review open", () => {
    const rows = [
      taskRow("review", "env-a", { status: "finished" }),
      taskRow("completed-at-start", "env-a", {
        status: "completed",
        completedAt: "2026-10-24T04:00:00.000Z",
      }),
      taskRow("completed-later", "env-a", {
        status: "completed",
        completedAt: "2026-10-24T10:00:00.000Z",
      }),
      taskRow("completed-at-end", "env-a", {
        status: "completed",
        completedAt: "2026-10-25T04:00:00.000Z",
      }),
      taskRow("completed-before", "env-a", {
        status: "completed",
        completedAt: "2026-10-23T12:00:00.000Z",
      }),
    ];

    const result = selectDockInboxTasks(rows, day, today);

    expect(result.open.map(({ task }) => task.id)).toEqual([DockTaskId.make("review")]);
    expect(result.doneToday.map(({ task }) => task.id)).toEqual([
      DockTaskId.make("completed-later"),
      DockTaskId.make("completed-at-start"),
    ]);
  });
});
