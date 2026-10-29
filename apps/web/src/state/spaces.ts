import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import { useEnvironments } from "./environments";
import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import { environmentShell } from "./shell";
import {
  filterDockSpaceProjects,
  dockSpaceProjectEmptyMessage,
  resolveDockSpaceSelection,
  sameDockSpaceSelection,
  type DockSpaceEnvironmentState,
} from "../dockSpaces.logic";
import { useDockSpacesStore } from "../dockSpacesStore";

export const dockSpaceEnvironmentAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): DockSpaceEnvironmentState => {
    const previous = Option.getOrNull(get.self<DockSpaceEnvironmentState>());
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    const config = get(serverEnvironment.configValueAtom(environmentId));
    const connectionPhase = presentation?.connection.phase ?? "available";
    const label = presentation?.entry.target.label ?? environmentId;
    const supportsDockSpaces = config?.environment.capabilities.dockSpaces === true;
    const hasProjectSnapshot = get(environmentShell.hasSnapshotAtom(environmentId));
    const cachedSnapshot = previous?.snapshot ?? null;

    if (presentation?.connection.phase === "unsupported") {
      return {
        environmentId,
        label,
        status: "unsupported",
        snapshot: cachedSnapshot,
        connectionPhase,
        supportsDockSpaces,
        hasProjectSnapshot,
      };
    }
    if (config !== null && !supportsDockSpaces) {
      return {
        environmentId,
        label,
        status: "unsupported",
        snapshot: cachedSnapshot,
        connectionPhase,
        supportsDockSpaces,
        hasProjectSnapshot,
      };
    }
    if (presentation === null || config === null) {
      return {
        environmentId,
        label,
        status:
          connectionPhase === "offline" || connectionPhase === "error" ? "offline" : "loading",
        snapshot: cachedSnapshot,
        connectionPhase,
        supportsDockSpaces,
        hasProjectSnapshot,
      };
    }
    if (presentation.connection.phase !== "connected") {
      return {
        environmentId,
        label,
        status: presentation.connection.phase === "connecting" ? "loading" : "offline",
        snapshot: cachedSnapshot,
        connectionPhase,
        supportsDockSpaces,
        hasProjectSnapshot,
      };
    }

    const live = get(serverEnvironment.spacesLive({ environmentId, input: {} }));
    if (AsyncResult.isSuccess(live)) {
      return {
        environmentId,
        label,
        status: hasProjectSnapshot ? "ready" : "loading",
        snapshot: live.value,
        connectionPhase,
        supportsDockSpaces,
        hasProjectSnapshot,
      };
    }
    return {
      environmentId,
      label,
      status: AsyncResult.isFailure(live) ? "error" : "loading",
      snapshot: cachedSnapshot,
      connectionPhase,
      supportsDockSpaces,
      hasProjectSnapshot,
    };
  }).pipe(Atom.withLabel(`web-dock-spaces:${environmentId}`)),
);

const spaceEnvironmentStates = environmentAtomList(
  "web-dock-space-environments",
  dockSpaceEnvironmentAtom,
);

export const dockSpaceMutationPermissions = environmentAtomList(
  "web-dock-space-mutation-permissions",
  serverEnvironment.dispatchSpaceCommand.permissionAtom,
);

export function useDockSpaceEnvironments() {
  const { isReady, environments } = useEnvironments();
  const environmentIds = environments.map((environment) => environment.environmentId);
  const states = useAtomValue(spaceEnvironmentStates(environmentIdsKey(environmentIds)));
  return { isCatalogReady: isReady, environmentIds, environments: states };
}

export function useDockSpaceProjectView<T extends { environmentId: EnvironmentId; id: ProjectId }>(
  projects: ReadonlyArray<T>,
) {
  const { isCatalogReady, environmentIds, environments } = useDockSpaceEnvironments();
  const selection = useDockSpacesStore((store) => store.selection);
  const setSelection = useDockSpacesStore((store) => store.setSelection);
  const resolvedSelection = resolveDockSpaceSelection(selection, {
    catalogReady: isCatalogReady,
    environmentIds: new Set(environmentIds),
    environments,
  });

  useEffect(() => {
    if (!sameDockSpaceSelection(selection, resolvedSelection)) setSelection(resolvedSelection);
  }, [resolvedSelection, selection, setSelection]);

  const owner =
    resolvedSelection.kind === "all"
      ? undefined
      : environments.find(
          (environment) => environment.environmentId === resolvedSelection.environmentId,
        );
  const filter = filterDockSpaceProjects(projects, resolvedSelection, environments);
  return {
    isCatalogReady,
    selection: resolvedSelection,
    environments,
    environmentIds,
    owner,
    ...filter,
    emptyMessage: dockSpaceProjectEmptyMessage(resolvedSelection, owner, filter.projects.length),
  };
}
