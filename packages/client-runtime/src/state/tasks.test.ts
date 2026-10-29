import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  DockTaskId,
  type DockTaskSummary,
  type TaskSummaryEvent,
  type TaskSummariesSnapshot,
  type TaskSummariesStreamItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { applyTasksStreamItem, projectTasksStream } from "./tasks.ts";

const date = "2026-10-20T12:00:00.000Z";
const task = (id: string, createdAt = date, title = id): DockTaskSummary => ({
  id: DockTaskId.make(id),
  revision: 0,
  title,
  priority: "none",
  dueDate: null,
  project: null,
  thread: null,
  completedAt: null,
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
});
const initialTask = task("first");
const laterTask = task("later", "2026-10-21T12:00:00.000Z");
const initial: TaskSummariesSnapshot = { sequence: 2, tasks: [initialTask, laterTask] };
const event = (sequence: number, change: TaskSummaryEvent["change"]): TaskSummariesStreamItem => ({
  kind: "event",
  event: { sequence, commandId: CommandId.make(`command-${sequence}`), occurredAt: date, change },
});

describe("Task summary stream projection", () => {
  it.effect("does not publish a successful empty seed before a server snapshot", () =>
    Effect.gen(function* () {
      expect(yield* Stream.empty.pipe(projectTasksStream, Stream.runCollect)).toEqual([]);
      expect(
        yield* Stream.make({ kind: "snapshot" as const, snapshot: initial }).pipe(
          projectTasksStream,
          Stream.runCollect,
        ),
      ).toEqual([initial]);
    }),
  );

  it("upserts tasks in createdAt/id order and skips stale or duplicate events", () => {
    const updatedFirst = { ...initialTask, title: "Updated", updatedAt: laterTask.createdAt };
    const update = event(3, { type: "task.updated", task: updatedFirst });
    const next = applyTasksStreamItem(initial, update);
    expect(next.tasks).toEqual([updatedFirst, laterTask]);

    const inserted = applyTasksStreamItem(
      next,
      event(4, { type: "task.updated", task: task("before-first") }),
    );
    expect(inserted.tasks.map((entry) => entry.id)).toEqual([
      DockTaskId.make("before-first"),
      initialTask.id,
      laterTask.id,
    ]);
    expect(applyTasksStreamItem(next, update)).toBe(next);
    expect(
      applyTasksStreamItem(
        next,
        event(2, { type: "task.updated", task: { ...initialTask, title: "Stale" } }),
      ),
    ).toBe(next);
  });

  it("keeps the cursor for a legacy release event without retaining release state", () => {
    const legacy = event(3, { type: "task.release.acknowledged", assignmentId: "legacy" });
    expect(applyTasksStreamItem(initial, legacy)).toEqual({ ...initial, sequence: 3 });
  });

  it("treats reconnect snapshots as authoritative even when their sequence resets", () => {
    const reconnect: TaskSummariesSnapshot = { sequence: 1, tasks: [task("reconnected")] };
    const prior: TaskSummariesSnapshot = { sequence: 10, tasks: [task("old")] };
    const reset = applyTasksStreamItem(prior, { kind: "snapshot", snapshot: reconnect });
    expect(reset).toBe(reconnect);
    expect(reset.sequence).toBe(1);
  });
});
