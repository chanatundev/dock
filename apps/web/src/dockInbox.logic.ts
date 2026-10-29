// Inbox grouping adapted from Synara's apps/web/src/components/inbox/inbox.logic.ts,
// revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import type { DockTaskSummary, EnvironmentId } from "@t3tools/contracts";
import type { TaskActivityStatus } from "@t3tools/client-runtime/task-board";
import {
  isThreadWorking,
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
} from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { isSidechatThread } from "@t3tools/shared/sidechatThread";
import { filterSidebarV2VisibleThreads, resolveThreadStatusPill } from "./components/Sidebar.logic";

type NeedsYouKind = "approval" | "input" | "plan";

const NEEDS_YOU_KINDS: readonly NeedsYouKind[] = ["approval", "input", "plan"];
const TASK_PRIORITY: Record<DockTaskSummary["priority"], number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

function scopedThreadKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return JSON.stringify([thread.environmentId, thread.id]);
}

function scopedTaskKey(row: DockInboxTask): string {
  return JSON.stringify([row.environmentId, row.task.id]);
}

export function groupDockInboxThreads(
  threads: readonly EnvironmentThreadShell[],
  nowIso: string,
): {
  readonly needsYou: readonly {
    readonly thread: EnvironmentThreadShell;
    readonly kind: NeedsYouKind;
  }[];
  readonly working: readonly EnvironmentThreadShell[];
  readonly finished: readonly EnvironmentThreadShell[];
  readonly failed: readonly EnvironmentThreadShell[];
} {
  const byScopedKey = new Map<string, EnvironmentThreadShell>();
  for (const thread of filterSidebarV2VisibleThreads(threads, null, { includeSidechat: true })) {
    if (thread.deletedAt !== null || effectiveSnoozed(thread, { now: nowIso })) continue;
    const key = scopedThreadKey(thread);
    if (!byScopedKey.has(key)) byScopedKey.set(key, thread);
  }

  const needsYouByKind: Record<NeedsYouKind, EnvironmentThreadShell[]> = {
    approval: [],
    input: [],
    plan: [],
  };
  const working: EnvironmentThreadShell[] = [];
  const finished: EnvironmentThreadShell[] = [];
  const failed: EnvironmentThreadShell[] = [];

  for (const thread of byScopedKey.values()) {
    const status = resolveThreadStatusPill({ thread });
    const kind =
      status?.label === "Pending Approval"
        ? "approval"
        : status?.label === "Awaiting Input"
          ? "input"
          : status?.label === "Plan Ready"
            ? "plan"
            : null;

    if (kind !== null) needsYouByKind[kind].push(thread);
    else if (isSidechatThread(thread)) continue;
    else if (status?.label === "Failed") failed.push(thread);
    else if (status?.label === "Completed") finished.push(thread);
    else if (isThreadWorking(thread)) working.push(thread);
  }

  return {
    needsYou: NEEDS_YOU_KINDS.flatMap((kind) =>
      sortInboxThreadsByReturn(needsYouByKind[kind]).map((thread) => ({ thread, kind })),
    ),
    working: sortWorkingThreadsBySend(working),
    finished: sortInboxThreadsByReturn(finished),
    failed: sortInboxThreadsByReturn(failed),
  };
}

export interface DockInboxTask {
  readonly environmentId: EnvironmentId;
  readonly task: DockTaskSummary;
  readonly status: TaskActivityStatus;
}

export function selectDockInboxTasks(
  rows: readonly DockInboxTask[],
  day: { readonly fromMs: number; readonly toMs: number },
  today: string,
): {
  readonly open: readonly DockInboxTask[];
  readonly doneToday: readonly DockInboxTask[];
  readonly overdue: number;
} {
  const uniqueRows = new Map<string, DockInboxTask>();
  for (const row of rows) {
    if (row.task.archivedAt === null && !uniqueRows.has(scopedTaskKey(row))) {
      uniqueRows.set(scopedTaskKey(row), row);
    }
  }

  const open: DockInboxTask[] = [];
  const doneToday: DockInboxTask[] = [];
  for (const row of uniqueRows.values()) {
    const { task, status } = row;
    if (task.completedAt !== null) {
      const completedAt = Date.parse(task.completedAt);
      if (completedAt >= day.fromMs && completedAt < day.toMs) doneToday.push(row);
      continue;
    }
    if (status.kind === "completed") continue;

    const dueByToday = task.dueDate !== null && task.dueDate <= today;
    const agentActivity =
      status.kind === "working" || status.kind === "attention" || status.kind === "finished";
    if (task.thread !== null || dueByToday || agentActivity) open.push(row);
  }

  open.sort((left, right) => {
    const leftDue = left.task.dueDate;
    const rightDue = right.task.dueDate;
    if (leftDue !== rightDue) {
      if (leftDue === null) return 1;
      if (rightDue === null) return -1;
      return leftDue.localeCompare(rightDue);
    }
    return (
      TASK_PRIORITY[right.task.priority] - TASK_PRIORITY[left.task.priority] ||
      left.task.createdAt.localeCompare(right.task.createdAt) ||
      scopedTaskKey(left).localeCompare(scopedTaskKey(right))
    );
  });

  doneToday.sort(
    (left, right) =>
      Date.parse(right.task.completedAt ?? "") - Date.parse(left.task.completedAt ?? "") ||
      scopedTaskKey(left).localeCompare(scopedTaskKey(right)),
  );

  return {
    open,
    doneToday,
    overdue: open.filter((row) => row.task.dueDate !== null && row.task.dueDate < today).length,
  };
}
