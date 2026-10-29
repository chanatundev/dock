import type { TaskSummariesSnapshot, TaskSummariesStreamItem } from "@t3tools/contracts";
import * as Stream from "effect/Stream";

export function projectTasksStream<E, R>(stream: Stream.Stream<TaskSummariesStreamItem, E, R>) {
  return stream.pipe(
    Stream.scan((): TaskSummariesSnapshot => ({ sequence: 0, tasks: [] }), applyTasksStreamItem),
    // The seed is not a server snapshot and cannot establish the current task list.
    Stream.drop(1),
  );
}

export function applyTasksStreamItem(
  current: TaskSummariesSnapshot,
  item: TaskSummariesStreamItem,
): TaskSummariesSnapshot {
  if (item.kind === "snapshot") return item.snapshot;

  const { event } = item;
  if (event.sequence <= current.sequence) return current;

  const change = event.change;
  if (change.type === "task.release.acknowledged") {
    // Old stored histories can still replay this event; new Task streams never emit it.
    return { ...current, sequence: event.sequence };
  }

  const updatedTask = change.task;
  const tasks = [...current.tasks];
  const index = tasks.findIndex((task) => task.id === updatedTask.id);
  if (index === -1) tasks.push(updatedTask);
  else tasks[index] = updatedTask;
  tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { sequence: event.sequence, tasks };
}
