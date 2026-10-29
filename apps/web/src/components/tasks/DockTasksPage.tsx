import { randomUUID } from "../../lib/utils";
// Task list/detail behavior adapted from Synara's components/tasks,
// revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { taskBoardStatus } from "@t3tools/client-runtime/task-board";
import {
  CommandId,
  DockTaskId,
  type DockTask,
  type EnvironmentId,
  type TaskCommand,
} from "@t3tools/contracts";
import { PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { validateDockTasksSearch } from "../../dockTasks.logic";
import { isElectron } from "../../env";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { dockTaskMutationPermissions, useDockTasks } from "../../state/tasks";
import { environmentIdsKey } from "../../state/environmentAtomList";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { DockTaskEditor, type DockTaskProjectOption } from "./DockTaskEditor";
import { DockTaskHandoffDialog } from "./DockTaskHandoffDialog";

interface TaskRef {
  readonly environmentId: EnvironmentId;
  readonly taskId: DockTaskId;
}

export function DockTasksPage() {
  const search = useSearch({ from: "/tasks" });
  const navigate = useNavigate();
  const catalog = useDockTasks();
  const primary = usePrimaryEnvironmentId();
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const dispatch = useAtomCommand(serverEnvironment.dispatchTaskCommand);
  const [createOwner, setCreateOwner] = useState<EnvironmentId | null>(null);
  const [handoffTask, setHandoffTask] = useState<{
    readonly task: DockTask;
    readonly ownerEnvironmentId: EnvironmentId;
  } | null>(null);
  const grants = useAtomValue(
    dockTaskMutationPermissions(environmentIdsKey(catalog.environmentIds)),
  );
  const permissions = catalog.environmentIds.map((id, index) => ({
    id,
    allowed: grants[index] === true,
  }));
  const projectOptions: DockTaskProjectOption[] = projects.map((project) => ({
    project: { environmentId: project.environmentId, projectId: project.id },
    label: `${project.title} · ${catalog.environments.find((environment) => environment.environmentId === project.environmentId)?.label ?? project.environmentId}`,
  }));
  const readyEnvironments = new Set(
    catalog.environments
      .filter((environment) => environment.status === "ready")
      .map((environment) => environment.environmentId),
  );
  const threadMap = new Map(
    threads
      .filter((thread) => readyEnvironments.has(thread.environmentId))
      .map((thread) => [JSON.stringify([thread.environmentId, thread.id]), thread]),
  );
  const rows = catalog.tasks
    .filter(
      (row) =>
        (search.archived ? row.task.archivedAt !== null : row.task.archivedAt === null) &&
        (!search.q || row.task.title.toLocaleLowerCase().includes(search.q.toLocaleLowerCase())),
    )
    .map((row) => ({
      ...row,
      status: taskBoardStatus(
        row.task,
        row.task.thread
          ? (threadMap.get(
              JSON.stringify([
                row.task.thread.thread.environmentId,
                row.task.thread.thread.threadId,
              ]),
            ) ?? null)
          : null,
      ),
    }));
  const changeSearch = (
    patch: { readonly [Key in keyof typeof search]?: (typeof search)[Key] | undefined },
    replace = false,
  ) =>
    void navigate({
      to: "/tasks",
      search: validateDockTasksSearch({ ...search, ...patch }),
      replace,
    });
  const selected =
    search.environmentId && search.taskId
      ? { environmentId: search.environmentId, taskId: search.taskId }
      : null;
  const run = async (environmentId: EnvironmentId, command: TaskCommand) => {
    const result = await dispatch({ environmentId, input: { command, creationSource: "web" } });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
  };
  const writable = catalog.environments.filter(
    (environment) =>
      environment.status === "ready" &&
      permissions.some(
        (permission) => permission.id === environment.environmentId && permission.allowed,
      ),
  );
  return (
    <SidebarInset className="h-full min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron} reserveNativeControls={false}>
        <h1 className="min-w-0 flex-1 text-sm font-semibold">Tasks</h1>
        <Button
          size="sm"
          disabled={!writable.length}
          onClick={() =>
            setCreateOwner(
              (writable.find((environment) => environment.environmentId === primary) ??
                writable[0])!.environmentId,
            )
          }
        >
          <PlusIcon /> New Task
        </Button>
      </WorkspacePageHeader>
      <div className="flex flex-wrap items-center gap-3 border-y px-4 py-3">
        <Input
          className="w-64"
          aria-label="Search Tasks"
          placeholder="Search Tasks"
          value={search.q ?? ""}
          onChange={(event) => changeSearch({ q: event.target.value }, true)}
        />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={search.archived}
          onClick={() => changeSearch({ archived: !search.archived }, true)}
        >
          {search.archived ? "Show current Tasks" : "Archived Tasks"}
        </Button>
      </div>
      <div
        className="flex flex-wrap gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground"
        role="status"
      >
        {!catalog.isCatalogReady ? "Loading environments…" : null}
        {catalog.environments.map((environment) => (
          <span key={environment.environmentId}>
            {environment.label} ·{" "}
            {environment.status === "ready" ? "connected" : environment.status}
            {environment.status !== "ready" && environment.snapshot ? " · cached Tasks" : ""}
          </span>
        ))}
        {catalog.isCatalogReady && catalog.environments.length === 0
          ? "Connect an environment to use Tasks."
          : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden max-lg:flex-col">
        <div className={`min-h-0 min-w-0 flex-1 overflow-auto ${selected ? "max-lg:hidden" : ""}`}>
          <div className="divide-y">
            {rows.map((row) => (
              <button
                key={JSON.stringify([row.environmentId, row.task.id])}
                type="button"
                onClick={() =>
                  changeSearch({ environmentId: row.environmentId, taskId: row.task.id })
                }
                className="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-accent/30 focus-visible:bg-accent/40"
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 88px" }}
              >
                <span
                  className={`mt-1 size-3 shrink-0 rounded-full border ${row.status.kind === "completed" ? "bg-success" : row.status.kind === "attention" ? "bg-warning" : row.status.kind === "working" ? "bg-primary" : ""}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{row.task.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {row.status.label} · {row.environmentLabel}
                    {row.ownerStatus === "ready" ? "" : ` · ${row.ownerStatus}`}
                    {row.task.dueDate ? ` · Due ${row.task.dueDate}` : ""}
                    {row.task.priority !== "none" ? ` · ${row.task.priority} priority` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {!catalog.isCatalogReady ||
              catalog.environments.some((entry) => entry.status === "loading")
                ? "Loading Tasks…"
                : catalog.environments.length === 0
                  ? "Connect an environment to load or create Tasks."
                  : catalog.environments.some(
                        (entry) => entry.status !== "ready" && entry.status !== "unsupported",
                      )
                    ? "No matching cached Tasks. Connect unavailable environments to refresh their Tasks."
                    : catalog.environments.every((entry) => entry.status === "unsupported")
                      ? "Tasks require a Dock environment that supports them."
                      : search.archived
                        ? "No archived Tasks in the available snapshots."
                        : "No matching Tasks. Create a Task to get started."}
            </p>
          ) : null}
        </div>
        {selected ? (
          <DockTaskDetails
            key={JSON.stringify([selected.environmentId, selected.taskId])}
            taskRef={selected}
            projectOptions={projectOptions}
            ownerStatus={
              catalog.environments.find((entry) => entry.environmentId === selected.environmentId)
                ?.status ?? "offline"
            }
            ownerLabel={
              catalog.environments.find((entry) => entry.environmentId === selected.environmentId)
                ?.label ?? selected.environmentId
            }
            onClose={() => changeSearch({ taskId: undefined, environmentId: undefined })}
            onHandoff={(task) =>
              setHandoffTask({ task, ownerEnvironmentId: selected.environmentId })
            }
            run={run}
          />
        ) : null}
      </div>
      {createOwner ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCreateOwner(null);
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>New Task</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <div className="mb-4 grid gap-1.5">
                <Label htmlFor="dock-task-owner">Owning environment</Label>
                <Select
                  items={writable.map((environment) => ({
                    value: environment.environmentId,
                    label: environment.label,
                  }))}
                  value={createOwner}
                  onValueChange={(value) => {
                    const environment = writable.find((item) => item.environmentId === value);
                    if (environment) setCreateOwner(environment.environmentId);
                  }}
                >
                  <SelectTrigger id="dock-task-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {writable.map((environment) => (
                      <SelectItem key={environment.environmentId} value={environment.environmentId}>
                        {environment.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <DockTaskEditor
                initialValues={{
                  title: "",
                  notes: "",
                  priority: "none",
                  dueDate: null,
                  project: null,
                }}
                projectOptions={projectOptions}
                disabled={!writable.some((entry) => entry.environmentId === createOwner)}
                submitLabel="Create Task"
                onCancel={() => setCreateOwner(null)}
                onSave={async (values) => {
                  const taskId = DockTaskId.make(randomUUID());
                  await run(createOwner, {
                    type: "task.create",
                    commandId: CommandId.make(randomUUID()),
                    taskId,
                    ...values,
                  });
                  changeSearch({ environmentId: createOwner, taskId });
                  setCreateOwner(null);
                }}
              />
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : null}
      {handoffTask ? (
        <DockTaskHandoffDialog
          task={handoffTask.task}
          ownerEnvironmentId={handoffTask.ownerEnvironmentId}
          run={run}
          onClose={() => setHandoffTask(null)}
        />
      ) : null}
    </SidebarInset>
  );
}

function DockTaskDetails({
  taskRef,
  projectOptions,
  ownerStatus,
  ownerLabel,
  onClose,
  onHandoff,
  run,
}: {
  readonly taskRef: TaskRef;
  readonly projectOptions: readonly DockTaskProjectOption[];
  readonly ownerStatus: string;
  readonly ownerLabel: string;
  readonly onClose: () => void;
  readonly onHandoff: (task: DockTask) => void;
  readonly run: (environmentId: EnvironmentId, command: TaskCommand) => Promise<void>;
}) {
  const detail = useEnvironmentQuery(
    serverEnvironment.taskDetail({
      environmentId: taskRef.environmentId,
      input: { taskId: taskRef.taskId },
    }),
  );
  const allowed = useAtomValue(
    serverEnvironment.dispatchTaskCommand.permissionAtom(taskRef.environmentId),
  );
  const [editing, setEditing] = useState<DockTask | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const task = detail.data;
  const disabled = busy || !allowed || ownerStatus !== "ready";
  const act = async (
    type: "task.complete" | "task.reopen" | "task.archive" | "task.restore" | "task.unassign",
  ) => {
    if (!task || disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await run(taskRef.environmentId, {
        type,
        commandId: CommandId.make(randomUUID()),
        taskId: task.id,
        expectedRevision: task.revision,
      });
      detail.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const projectLabel = (ref: DockTask["project"]) =>
    ref === null
      ? "None"
      : (projectOptions.find(
          (option) =>
            option.project.environmentId === ref.environmentId &&
            option.project.projectId === ref.projectId,
        )?.label ?? `${ref.projectId} · ${ref.environmentId} (unavailable)`);

  return (
    <aside
      aria-label="Task details"
      className="min-h-0 w-full shrink-0 overflow-auto border-l bg-card/40 p-5 lg:w-[min(45%,28rem)]"
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Task details</h2>
          <p className="text-xs text-muted-foreground">
            {ownerLabel} · {ownerStatus === "ready" ? "connected" : ownerStatus}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close Task details" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {detail.error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {detail.error}
        </p>
      ) : null}
      {!task ? (
        <p role="status" className="text-sm text-muted-foreground">
          {detail.isPending
            ? "Loading Task…"
            : "Task unavailable. Connect to its owning environment to load its details."}
        </p>
      ) : editing ? (
        <>
          <DockTaskEditor
            key={editing.revision}
            initialValues={editing}
            projectOptions={projectOptions}
            disabled={disabled}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSave={async (values) => {
              await run(taskRef.environmentId, {
                type: "task.edit",
                commandId: CommandId.make(randomUUID()),
                taskId: editing.id,
                expectedRevision: editing.revision,
                ...values,
              });
              setEditing(null);
              detail.refresh();
            }}
          />
          {task.revision !== editing.revision ? (
            <div className="mt-3">
              <p role="status" className="text-sm">
                This Task changed elsewhere. Your draft has been kept.
              </p>
              <Button variant="outline" size="sm" onClick={() => setEditing(task)}>
                Load latest version
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <h3 className="break-words text-xl font-semibold">{task.title}</h3>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm">
            {task.notes || "No notes yet."}
          </p>
          <dl className="my-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Priority</dt>
            <dd>{task.priority}</dd>
            <dt className="text-muted-foreground">Due date</dt>
            <dd>{task.dueDate ?? "None"}</dd>
            <dt className="text-muted-foreground">Project label</dt>
            <dd className="break-words">{projectLabel(task.project)}</dd>
            {task.thread ? (
              <>
                <dt className="text-muted-foreground">Linked project</dt>
                <dd className="break-words">{projectLabel(task.thread.project)}</dd>
              </>
            ) : null}
          </dl>
          {task.thread ? (
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{
                    environmentId: task.thread.thread.environmentId,
                    threadId: task.thread.thread.threadId,
                  }}
                />
              }
            >
              Open linked thread
            </Button>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setEditing(task)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              disabled={disabled || task.completedAt !== null || task.archivedAt !== null}
              onClick={() => onHandoff(task)}
            >
              {task.thread ? "Prepare another thread handoff" : "Prepare in a thread"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || task.archivedAt !== null}
              onClick={() => void act(task.completedAt === null ? "task.complete" : "task.reopen")}
            >
              {task.completedAt === null ? "Complete" : "Reopen"}
            </Button>
            {task.thread ? (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || task.archivedAt !== null}
                onClick={() => void act("task.unassign")}
              >
                Unlink thread
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void act(task.archivedAt === null ? "task.archive" : "task.restore")}
            >
              {task.archivedAt === null ? "Archive" : "Restore"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Preparing a handoff adds an unsent draft. You review and send it in the thread.
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <details className="mt-6 border-t pt-4">
            <summary className="cursor-pointer text-sm font-medium">History</summary>
            <TaskHistory taskRef={taskRef} />
          </details>
        </>
      )}
      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={detail.refresh}>
          Refresh
        </Button>
      </div>
    </aside>
  );
}

function TaskHistory({ taskRef }: { readonly taskRef: TaskRef }) {
  const [cursors, setCursors] = useState<readonly number[]>([]);
  const beforeSequence = cursors.at(-1);
  const query = useEnvironmentQuery(
    serverEnvironment.taskHistory({
      environmentId: taskRef.environmentId,
      input: {
        taskId: taskRef.taskId,
        limit: 20,
        ...(beforeSequence === undefined ? {} : { beforeSequence }),
      },
    }),
  );
  return (
    <div className="mt-3 space-y-3 text-xs">
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.data?.events.map((event) => (
        <div key={event.sequence} className="rounded border p-2">
          <p className="text-muted-foreground">
            {event.occurredAt} · {event.createdBy}
          </p>
          {event.change.type === "task.updated" ? (
            <>
              <p className="mt-1">
                Revision {event.change.task.revision} · {event.change.task.title}
              </p>
              <p>
                {event.change.task.archivedAt
                  ? "Archived"
                  : event.change.task.completedAt
                    ? "Completed"
                    : event.change.task.thread
                      ? "Linked to thread"
                      : "Open"}
              </p>
              {event.change.task.thread ? (
                <Link
                  to="/$environmentId/$threadId"
                  params={{
                    environmentId: event.change.task.thread.thread.environmentId,
                    threadId: event.change.task.thread.thread.threadId,
                  }}
                  className="underline"
                >
                  Open historical thread
                </Link>
              ) : null}
            </>
          ) : (
            <p>Historical Task event</p>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {cursors.length ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursors((current) => current.slice(0, -1))}
          >
            Newer events
          </Button>
        ) : null}
        {query.data?.nextBeforeSequence != null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const cursor = query.data?.nextBeforeSequence;
              if (cursor != null) setCursors((current) => [...current, cursor]);
            }}
          >
            Older events
          </Button>
        ) : null}
      </div>
    </div>
  );
}
