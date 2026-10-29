import { DockTaskId, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface DockTasksSearch {
  readonly environmentId?: EnvironmentId;
  readonly taskId?: DockTaskId;
  readonly q?: string;
  readonly archived: boolean;
}

const isEnvironmentId = Schema.is(EnvironmentId);
const isTaskId = Schema.is(DockTaskId);

export function validateDockTasksSearch(raw: Record<string, unknown>): DockTasksSearch {
  const selected =
    isEnvironmentId(raw.environmentId) && isTaskId(raw.taskId)
      ? { environmentId: raw.environmentId, taskId: raw.taskId }
      : {};
  return {
    ...selected,
    ...(typeof raw.q === "string" && raw.q.length ? { q: raw.q.slice(0, 200) } : {}),
    archived: raw.archived === true || raw.archived === "true",
  };
}
