import { useDockSpaceProjectView } from "../state/spaces";
import { useProjects } from "../state/entities";
import { SidebarInset } from "./ui/sidebar";

export function DockHubsPage() {
  const view = useDockSpaceProjectView(useProjects());
  const visibleByEnvironment = new Map<string, typeof view.projects>();
  for (const project of view.projects) {
    const current = visibleByEnvironment.get(project.environmentId) ?? [];
    visibleByEnvironment.set(project.environmentId, [...current, project]);
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-auto">
      <header className="border-b px-5 py-4">
        <h1 className="text-base font-semibold">Hubs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Projects are grouped by Hub. Projects without a Hub are in Void.
        </p>
      </header>
      <div className="space-y-6 p-5">
        {!view.isCatalogReady ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading environments…
          </p>
        ) : null}
        {view.environments.map((environment) => {
          const projects = visibleByEnvironment.get(environment.environmentId) ?? [];
          const snapshot = environment.snapshot;
          const assignments = new Map(
            snapshot?.projectAssignments.map((assignment) => [
              assignment.projectId,
              assignment.spaceId,
            ]) ?? [],
          );
          const filtered =
            view.selection.kind !== "all" &&
            view.selection.environmentId === environment.environmentId;
          const selectedSpaceId =
            view.selection.kind === "space" && filtered ? view.selection.spaceId : null;
          const groups =
            selectedSpaceId !== null
              ? (snapshot?.spaces.filter((space) => space.id === selectedSpaceId) ?? [])
              : view.selection.kind === "void" && filtered
                ? []
                : (snapshot?.spaces ?? []);
          const showVoid =
            view.selection.kind === "all" || (view.selection.kind === "void" && filtered);
          const membershipUnavailable = snapshot === null || !environment.hasProjectSnapshot;

          return (
            <section key={environment.environmentId} className="space-y-3">
              <div>
                <h2 className="text-sm font-medium">{environment.label}</h2>
                <p className="text-xs text-muted-foreground">
                  {environment.status === "ready"
                    ? "Connected"
                    : `${environment.status} · cached project membership may be shown`}
                </p>
              </div>
              {membershipUnavailable ? (
                <ProjectGroup
                  title="Projects"
                  projects={projects}
                  emptyMessage={view.emptyMessage}
                />
              ) : (
                <>
                  {groups.map((space) => (
                    <ProjectGroup
                      key={space.id}
                      title={space.name}
                      projects={projects.filter(
                        (project) => assignments.get(project.id) === space.id,
                      )}
                    />
                  ))}
                  {showVoid ? (
                    <ProjectGroup
                      title="Void"
                      projects={projects.filter((project) => !assignments.has(project.id))}
                    />
                  ) : null}
                </>
              )}
            </section>
          );
        })}
        {view.environments.length === 0 && view.isCatalogReady ? (
          <p className="text-sm text-muted-foreground">No environments available.</p>
        ) : null}
      </div>
    </SidebarInset>
  );
}

function ProjectGroup({
  title,
  projects,
  emptyMessage,
}: {
  title: string;
  projects: ReadonlyArray<{ id: string; title: string; workspaceRoot: string }>;
  emptyMessage?: string | null;
}) {
  return (
    <div className="rounded-md border p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {projects.length > 0 ? (
        <ul className="mt-2 divide-y">
          {projects.map((project) => (
            <li key={project.id} className="py-2 first:pt-0 last:pb-0">
              <p className="truncate text-sm">{project.title}</p>
              <p className="truncate text-xs text-muted-foreground">{project.workspaceRoot}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {emptyMessage ?? "No projects in this Hub."}
        </p>
      )}
    </div>
  );
}
