import type { DockTaskSummary, EnvironmentId, TaskSummariesSnapshot } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEnvironments } from "./environments";
import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface DockTaskEnvironmentState {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: "ready" | "loading" | "offline" | "unsupported" | "error";
  readonly snapshot: TaskSummariesSnapshot | null;
}

const dockTaskEnvironmentAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): DockTaskEnvironmentState => {
    const previous = Option.getOrNull(get.self<DockTaskEnvironmentState>());
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    const config = get(serverEnvironment.configValueAtom(environmentId));
    const label = presentation?.entry.target.label ?? environmentId;
    const cached = previous?.snapshot ?? null;
    if (
      presentation?.connection.phase === "unsupported" ||
      (config !== null && config.environment.capabilities.dockTasks !== true)
    )
      return {
        environmentId,
        label,
        status: "unsupported",
        snapshot: cached,
      };
    if (presentation === null || config === null || presentation.connection.phase !== "connected") {
      const phase = presentation?.connection.phase;
      return {
        environmentId,
        label,
        status:
          phase === "offline" || phase === "error" || phase === "reconnecting"
            ? "offline"
            : "loading",
        snapshot: cached,
      };
    }
    const result = get(serverEnvironment.tasksLive({ environmentId, input: {} }));
    return AsyncResult.isSuccess(result)
      ? { environmentId, label, status: "ready", snapshot: result.value }
      : {
          environmentId,
          label,
          status: AsyncResult.isFailure(result) ? "error" : "loading",
          snapshot: cached,
        };
  }).pipe(Atom.withLabel(`web-dock-tasks:${environmentId}`)),
);

const taskEnvironmentStates = environmentAtomList(
  "web-dock-task-environments",
  dockTaskEnvironmentAtom,
);
export const dockTaskMutationPermissions = environmentAtomList(
  "web-dock-task-mutation-permissions",
  serverEnvironment.dispatchTaskCommand.permissionAtom,
);

export function useDockTaskEnvironments() {
  const catalog = useEnvironments();
  const environmentIds = catalog.environments.map((environment) => environment.environmentId);
  const environments = useAtomValue(taskEnvironmentStates(environmentIdsKey(environmentIds)));
  return { isCatalogReady: catalog.isReady, environmentIds, environments };
}

export interface ScopedDockTask {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly ownerStatus: DockTaskEnvironmentState["status"];
  readonly task: DockTaskSummary;
}

export function useDockTasks() {
  const state = useDockTaskEnvironments();
  const tasks: ScopedDockTask[] = state.environments.flatMap((environment) =>
    (environment.snapshot?.tasks ?? []).map((task) => ({
      environmentId: environment.environmentId,
      environmentLabel: environment.label,
      ownerStatus: environment.status,
      task,
    })),
  );
  return { ...state, tasks };
}
