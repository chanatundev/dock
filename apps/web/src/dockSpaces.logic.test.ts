import { EnvironmentId, ProjectId, SpaceId, type SpacesSnapshot } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";
import { buildSidebarProjectSnapshots } from "./sidebarProjectGrouping";
import {
  ALL_DOCK_PROJECTS,
  combineDockProjectScopes,
  dockSpaceProjectEmptyMessage,
  decodeDockSpaceSelection,
  encodeDockSpaceSelection,
  filterDockSpaceProjects,
  resolveDockSpaceSelection,
  resolveDockSpaceThreadReveal,
  planDockSpaceRouteReveal,
  type DockSpaceEnvironmentState,
  type DockSpaceSelection,
} from "./dockSpaces.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const work = SpaceId.make("work");
const timestamp = "2026-10-24T00:00:00.000Z";
const snapshot: SpacesSnapshot = {
  sequence: 2,
  spaces: [
    {
      id: work,
      name: "Work",
      icon: "bag",
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  projectAssignments: [{ projectId: ProjectId.make("checkout"), spaceId: work }],
};
const environment = (
  environmentId: EnvironmentId,
  overrides: Partial<DockSpaceEnvironmentState> = {},
): DockSpaceEnvironmentState => ({
  environmentId,
  label: environmentId,
  status: "ready",
  snapshot,
  connectionPhase: "connected",
  supportsDockSpaces: true,
  hasProjectSnapshot: true,
  ...overrides,
});
const project = (environmentId: EnvironmentId, id: string): EnvironmentProject => ({
  environmentId,
  id: ProjectId.make(id),
  title: id,
  workspaceRoot: "/" + environmentId + "/" + id,
  repositoryIdentity: {
    canonicalKey: "github.com/example/repo",
    provider: "github",
    owner: "example",
    name: "repo",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://github.com/example/repo.git",
    },
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
});
const selected: DockSpaceSelection = { kind: "space", environmentId: local, spaceId: work };

describe("Dock Space project scope", () => {
  it("reveals only new navigation and preserves a manually selected filter on the same route", () => {
    const project = { environmentId: local, projectId: ProjectId.make("checkout") };
    const initial = planDockSpaceRouteReveal({
      previous: null,
      pathname: "/thread",
      selection: ALL_DOCK_PROJECTS,
      isThreadView: true,
      project,
      environments: [environment(local)],
    });
    const manual = planDockSpaceRouteReveal({
      previous: initial.state,
      pathname: "/thread",
      selection: selected,
      isThreadView: true,
      project: { ...project, projectId: ProjectId.make("outside") },
      environments: [environment(local)],
    });
    expect(manual.selection).toBeNull();
    const settings = planDockSpaceRouteReveal({
      previous: manual.state,
      pathname: "/settings",
      selection: selected,
      isThreadView: false,
      project: null,
      environments: [environment(local)],
    });
    const reopened = planDockSpaceRouteReveal({
      previous: settings.state,
      pathname: "/thread",
      selection: selected,
      isThreadView: true,
      project: { ...project, projectId: ProjectId.make("outside") },
      environments: [environment(local)],
    });
    expect(reopened.selection).toEqual(ALL_DOCK_PROJECTS);
  });

  it("lets a manual filter chosen while a navigation is loading override its eventual reveal", () => {
    const loading = planDockSpaceRouteReveal({
      previous: null,
      pathname: "/loading",
      selection: ALL_DOCK_PROJECTS,
      isThreadView: true,
      project: null,
      environments: [],
    });
    const manual = planDockSpaceRouteReveal({
      previous: loading.state,
      pathname: "/loading",
      selection: selected,
      isThreadView: true,
      project: { environmentId: remote, projectId: ProjectId.make("outside") },
      environments: [environment(local)],
    });
    expect(manual.selection).toBeNull();
    expect(manual.state.handled).toBe(true);
  });
  it("broadens explicit outside-thread navigation and waits for same-environment membership", () => {
    expect(
      resolveDockSpaceThreadReveal(
        selected,
        { environmentId: local, projectId: ProjectId.make("checkout") },
        [environment(local)],
      ),
    ).toEqual(selected);
    expect(
      resolveDockSpaceThreadReveal(
        selected,
        { environmentId: local, projectId: ProjectId.make("unassigned") },
        [environment(local)],
      ),
    ).toEqual(ALL_DOCK_PROJECTS);
    expect(
      resolveDockSpaceThreadReveal(
        selected,
        { environmentId: remote, projectId: ProjectId.make("checkout") },
        [],
      ),
    ).toEqual(ALL_DOCK_PROJECTS);
    expect(
      resolveDockSpaceThreadReveal(
        selected,
        { environmentId: local, projectId: ProjectId.make("checkout") },
        [environment(local, { snapshot: null })],
      ),
    ).toBeNull();
  });
  it("distinguishes unhydrated or offline project data from an actually empty Space", () => {
    expect(
      dockSpaceProjectEmptyMessage(selected, environment(local, { hasProjectSnapshot: false }), 0),
    ).toBe("Loading projects…");
    expect(
      dockSpaceProjectEmptyMessage(
        selected,
        environment(local, { hasProjectSnapshot: false, status: "offline" }),
        0,
      ),
    ).toBe("Connect to this environment to load its projects.");
    expect(dockSpaceProjectEmptyMessage(selected, environment(local), 0)).toBe(
      "No projects in this view",
    );
    expect(
      dockSpaceProjectEmptyMessage(selected, environment(local, { status: "offline" }), 1),
    ).toBeNull();
  });
  it("does not treat a Space snapshot as an authoritative empty project list", () => {
    const result = filterDockSpaceProjects([], selected, [
      environment(local, { hasProjectSnapshot: false }),
    ]);
    expect(result.isApplied).toBe(false);
    expect(result.projectKeys).toBeNull();
  });
  it("scopes colliding project and Space IDs to their owning environment", () => {
    const projects = [
      project(local, "checkout"),
      project(remote, "checkout"),
      project(local, "unassigned"),
    ];
    expect(
      filterDockSpaceProjects(projects, selected, [environment(local), environment(remote)])
        .projects,
    ).toEqual([projects[0]]);
    expect(
      filterDockSpaceProjects(projects, { kind: "void", environmentId: local }, [
        environment(local),
      ]).projects,
    ).toEqual([projects[2]]);
    expect(filterDockSpaceProjects(projects, ALL_DOCK_PROJECTS, []).projects).toBe(projects);
  });

  it("groups repository checkouts only after applying Space membership", () => {
    const projects = [
      project(local, "checkout"),
      project(local, "other-checkout"),
      project(remote, "checkout"),
    ];
    const group = (items: ReadonlyArray<EnvironmentProject>) =>
      buildSidebarProjectSnapshots({
        projects: items,
        settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
        primaryEnvironmentId: local,
        resolveEnvironmentLabel: (id) => id,
      });
    expect(group(projects)[0]?.memberProjects).toHaveLength(3);
    const visible = filterDockSpaceProjects(projects, selected, [
      environment(local),
      environment(remote),
    ]);
    expect(group(visible.projects)[0]?.memberProjects).toEqual([
      expect.objectContaining(projects[0]!),
    ]);
  });

  it("keeps an offline cached membership but never infers Void from missing data or an old server", () => {
    const projects = [project(local, "checkout"), project(local, "unassigned")];
    const offline = environment(local, { status: "offline", connectionPhase: "offline" });
    expect(filterDockSpaceProjects(projects, selected, [offline]).projects).toEqual([projects[0]]);
    for (const status of ["loading", "offline", "unsupported", "error"] as const) {
      const unavailable = environment(local, { status, snapshot: null });
      expect(
        filterDockSpaceProjects(projects, { kind: "void", environmentId: local }, [unavailable]),
      ).toMatchObject({ projects, isApplied: false, projectKeys: null });
    }
    expect(
      filterDockSpaceProjects(projects, selected, [environment(local, { status: "unsupported" })])
        .isApplied,
    ).toBe(false);
  });

  it("preserves restored selections until the owner is authoritative and clears a deleted Space", () => {
    const resolve = (
      environments: DockSpaceEnvironmentState[],
      catalogReady = true,
      environmentIds = new Set([local]),
    ) => resolveDockSpaceSelection(selected, { environments, catalogReady, environmentIds });
    expect(resolve([], false)).toEqual(selected);
    expect(resolve([environment(local, { status: "offline", snapshot: null })])).toEqual(selected);
    expect(resolve([environment(local)])).toEqual(selected);
    expect(resolve([environment(local, { snapshot: { ...snapshot, spaces: [] } })])).toEqual(
      ALL_DOCK_PROJECTS,
    );
    expect(resolve([], true, new Set())).toEqual(ALL_DOCK_PROJECTS);
  });

  it("intersects the existing project filter with the Space filter", () => {
    expect(
      combineDockProjectScopes(new Set(["local:a", "local:b"]), new Set(["local:b", "remote:b"])),
    ).toEqual(new Set(["local:b"]));
    expect(combineDockProjectScopes(null, null)).toBeNull();
  });
});

describe("Dock Space presentation persistence", () => {
  it("restores only valid environment-scoped selection references", () => {
    expect(decodeDockSpaceSelection(encodeDockSpaceSelection(selected))).toEqual(selected);
    for (const value of [
      null,
      "{",
      "[]",
      "null",
      '{"kind":"space","environmentId":"local"}',
      '{"kind":"void","environmentId":" "}',
      '{"kind":"space","environmentId":"local","spaceId":""}',
    ]) {
      expect(decodeDockSpaceSelection(value)).toEqual(ALL_DOCK_PROJECTS);
    }
  });
});
