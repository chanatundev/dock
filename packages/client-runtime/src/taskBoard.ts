import type { DockTaskSummary } from "@t3tools/contracts";
import type {
  EnvironmentThreadShell,
  ThreadRunSummary,
  ThreadRuntimeSummary,
} from "./state/models.ts";

export type TaskActivityKind = "idle" | "working" | "attention" | "finished" | "completed";
export interface TaskActivityStatus {
  readonly kind: TaskActivityKind;
  readonly label: string;
}
export type TaskThreadActivity = Pick<
  EnvironmentThreadShell,
  | "id"
  | "environmentId"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "hasActionableProposedPlan"
> & {
  readonly latestRun: Pick<ThreadRunSummary, "status" | "turnEnded"> | null;
  readonly runtime: Pick<ThreadRuntimeSummary, "status" | "activeRunId"> | null;
  readonly archivedAt?: string | null;
  readonly deletedAt?: string | null;
};

export function taskBoardStatus(
  task: DockTaskSummary,
  thread: TaskThreadActivity | null,
): TaskActivityStatus {
  if (task.completedAt !== null) return { kind: "completed", label: "Completed" };
  const link = task.thread;
  if (link === null) return { kind: "idle", label: "Not started" };
  if (
    thread === null ||
    thread.id !== link.thread.threadId ||
    thread.environmentId !== link.thread.environmentId ||
    thread.deletedAt != null ||
    thread.archivedAt != null
  )
    return { kind: "idle", label: "Thread unavailable" };
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval")
    return { kind: "attention", label: "Approval needed" };
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input")
    return { kind: "attention", label: "Input needed" };
  const run = thread.latestRun;
  if (run === null) return { kind: "idle", label: "Not started" };
  if (run.status === "queued") return { kind: "idle", label: "Queued" };
  if (run.status === "preparing" || run.status === "starting")
    return { kind: "working", label: "Preparing" };
  if (run.status === "running" || run.status === "waiting")
    return { kind: "working", label: run.status === "waiting" ? "Waiting" : "Working" };
  if (thread.hasActionableProposedPlan) return { kind: "attention", label: "Plan ready" };
  if (run.status === "completed" || run.turnEnded === true)
    return { kind: "finished", label: "Finished" };
  if (run.status === "failed") return { kind: "attention", label: "Run failed" };
  return { kind: "attention", label: "Run stopped" };
}
