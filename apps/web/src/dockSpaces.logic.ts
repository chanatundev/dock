import type { EnvironmentId, ProjectId, SpaceId, SpacesSnapshot } from "@t3tools/contracts";

export type DockSpaceSelection =
  | { readonly kind: "all" }
  | { readonly kind: "void"; readonly environmentId: EnvironmentId }
  | {
      readonly kind: "space";
      readonly environmentId: EnvironmentId;
      readonly spaceId: SpaceId;
    };

export const ALL_DOCK_PROJECTS: DockSpaceSelection = { kind: "all" };

export type DockSpacesStatus = "loading" | "offline" | "unsupported" | "error" | "ready";

export interface DockSpaceEnvironmentState {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: DockSpacesStatus;
  readonly snapshot: SpacesSnapshot | null;
  readonly connectionPhase: string;
  readonly supportsDockSpaces: boolean;
  readonly hasProjectSnapshot: boolean;
}

export function encodeDockSpaceSelection(selection: DockSpaceSelection): string {
  return JSON.stringify(selection);
}

export function decodeDockSpaceSelection(value: unknown): DockSpaceSelection {
  if (typeof value !== "string") return ALL_DOCK_PROJECTS;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return ALL_DOCK_PROJECTS;
    const record = parsed as Record<string, unknown>;
    if (record.kind === "all") return ALL_DOCK_PROJECTS;
    if (
      (record.kind === "void" || record.kind === "space") &&
      typeof record.environmentId === "string" &&
      record.environmentId.trim().length > 0 &&
      record.environmentId.trim() === record.environmentId &&
      (record.kind === "void" ||
        (typeof record.spaceId === "string" &&
          record.spaceId.trim().length > 0 &&
          record.spaceId.trim() === record.spaceId &&
          record.spaceId.length <= 128))
    ) {
      return record.kind === "void"
        ? { kind: "void", environmentId: record.environmentId as EnvironmentId }
        : {
            kind: "space",
            environmentId: record.environmentId as EnvironmentId,
            spaceId: record.spaceId as SpaceId,
          };
    }
  } catch {
    return ALL_DOCK_PROJECTS;
  }
  return ALL_DOCK_PROJECTS;
}

export function sameDockSpaceSelection(
  left: DockSpaceSelection,
  right: DockSpaceSelection,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "all" ||
      (right.kind !== "all" &&
        left.environmentId === right.environmentId &&
        (left.kind === "void" || (right.kind === "space" && left.spaceId === right.spaceId))))
  );
}

export function resolveDockSpaceSelection(
  selection: DockSpaceSelection,
  input: {
    readonly catalogReady: boolean;
    readonly environmentIds: ReadonlySet<EnvironmentId>;
    readonly environments: ReadonlyArray<DockSpaceEnvironmentState>;
  },
): DockSpaceSelection {
  if (selection.kind === "all") return selection;
  if (!input.catalogReady) return selection;
  if (!input.environmentIds.has(selection.environmentId)) return ALL_DOCK_PROJECTS;

  const owner = input.environments.find(
    (environment) => environment.environmentId === selection.environmentId,
  );
  if (owner?.status !== "ready" || owner.snapshot === null) return selection;
  if (selection.kind === "void") return selection;
  return owner.snapshot.spaces.some((space) => space.id === selection.spaceId)
    ? selection
    : ALL_DOCK_PROJECTS;
}

function dockSpaceProjectKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}:${projectId}`;
}

export function filterDockSpaceProjects<T extends { environmentId: EnvironmentId; id: ProjectId }>(
  projects: ReadonlyArray<T>,
  selection: DockSpaceSelection,
  environments: ReadonlyArray<DockSpaceEnvironmentState>,
): {
  readonly projects: ReadonlyArray<T>;
  readonly projectKeys: ReadonlySet<string> | null;
  readonly isApplied: boolean;
} {
  if (selection.kind === "all") return { projects, projectKeys: null, isApplied: false };
  const owner = environments.find(
    (environment) => environment.environmentId === selection.environmentId,
  );
  // Missing data does not mean Void. Keep the current tree until canonical membership arrives.
  if (
    owner?.snapshot === null ||
    owner === undefined ||
    owner.status === "unsupported" ||
    !owner.hasProjectSnapshot
  ) {
    return { projects, projectKeys: null, isApplied: false };
  }

  const assignedSpaceByProject = new Map(
    owner.snapshot.projectAssignments.map((assignment) => [
      assignment.projectId,
      assignment.spaceId,
    ]),
  );
  const visible = projects.filter((project) => {
    if (project.environmentId !== selection.environmentId) return false;
    const assignedSpaceId = assignedSpaceByProject.get(project.id);
    return selection.kind === "void"
      ? assignedSpaceId === undefined
      : assignedSpaceId === selection.spaceId;
  });
  return {
    projects: visible,
    projectKeys: new Set(
      visible.map((project) => dockSpaceProjectKey(project.environmentId, project.id)),
    ),
    isApplied: true,
  };
}

export function dockSpaceProjectEmptyMessage(
  selection: DockSpaceSelection,
  owner: DockSpaceEnvironmentState | undefined,
  projectCount: number,
): string | null {
  if (selection.kind === "all") return null;
  if (owner?.status === "unsupported") return "Hubs are unavailable on this environment.";
  if (owner?.snapshot === null || owner === undefined || !owner.hasProjectSnapshot) {
    return owner?.status === "offline" || owner?.status === "error"
      ? "Connect to this environment to load its projects."
      : "Loading projects…";
  }
  return projectCount === 0 ? "No projects in this view" : null;
}

export function combineDockProjectScopes(
  spaceProjectKeys: ReadonlySet<string> | null,
  projectScopeKeys: ReadonlySet<string> | null,
): ReadonlySet<string> | null {
  if (spaceProjectKeys === null) return projectScopeKeys;
  if (projectScopeKeys === null) return spaceProjectKeys;
  return new Set([...spaceProjectKeys].filter((key) => projectScopeKeys.has(key)));
}

export function resolveDockSpaceThreadReveal(
  selection: DockSpaceSelection,
  thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
  environments: ReadonlyArray<DockSpaceEnvironmentState>,
): DockSpaceSelection | null {
  if (selection.kind === "all") return selection;
  if (thread.environmentId !== selection.environmentId) return ALL_DOCK_PROJECTS;
  const filtered = filterDockSpaceProjects(
    [{ environmentId: thread.environmentId, id: thread.projectId }],
    selection,
    environments,
  );
  if (!filtered.isApplied) return null;
  return filtered.projects.length === 0 ? ALL_DOCK_PROJECTS : selection;
}

export interface DockSpaceRouteRevealState {
  readonly pathname: string;
  readonly selection: DockSpaceSelection;
  readonly handled: boolean;
}

export function planDockSpaceRouteReveal(input: {
  readonly previous: DockSpaceRouteRevealState | null;
  readonly pathname: string;
  readonly selection: DockSpaceSelection;
  readonly isThreadView: boolean;
  readonly project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId } | null;
  readonly environments: ReadonlyArray<DockSpaceEnvironmentState>;
}) {
  const state =
    input.previous?.pathname === input.pathname
      ? input.previous
      : { pathname: input.pathname, selection: input.selection, handled: false };
  if (state.handled) return { state, selection: null };
  // A filter chosen after navigation wins, including while its thread is loading.
  if (!input.isThreadView || !sameDockSpaceSelection(state.selection, input.selection)) {
    return { state: { ...state, handled: true }, selection: null };
  }
  if (input.project === null) return { state, selection: null };
  const selection = resolveDockSpaceThreadReveal(
    input.selection,
    input.project,
    input.environments,
  );
  if (selection === null) return { state, selection: null };
  return {
    state: { ...state, handled: true },
    selection: sameDockSpaceSelection(selection, input.selection) ? null : selection,
  };
}
