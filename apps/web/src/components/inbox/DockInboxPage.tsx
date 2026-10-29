// Inbox composition adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { Link } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { taskBoardStatus } from "@t3tools/client-runtime/task-board";
import type { InboxRecapInput, EnvironmentId } from "@t3tools/contracts";
import { resolveInboxDay, type InboxDayRange } from "@t3tools/shared/inboxDay";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { aggregateInboxRecaps } from "../../dockInboxRecap.logic";
import {
  groupDockInboxThreads,
  selectDockInboxTasks,
  type DockInboxTask,
} from "../../dockInbox.logic";
import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { useInboxRecaps, type InboxEnvironmentRecap } from "../../state/inbox";
import { serverEnvironment } from "../../state/server";
import { useDockTasks } from "../../state/tasks";
import { useUiStateStore } from "../../uiStateStore";
import { resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const formatNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const threadKey = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  JSON.stringify([thread.environmentId, thread.id]);
function recapInput(day: InboxDayRange): InboxRecapInput {
  return {
    from: new Date(day.fromMs).toISOString(),
    to: new Date(day.toMs).toISOString(),
    slotBoundaries: day.slots.slice(1).map((slot) => new Date(slot.fromMs).toISOString()),
  };
}
function ThreadGroup({
  title,
  threads,
  environments,
  projects,
  reason,
}: {
  readonly title: string;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly environments: readonly InboxEnvironmentRecap[];
  readonly projects: ReadonlyMap<string, string>;
  readonly reason?: ReadonlyMap<string, string>;
}) {
  const [limit, setLimit] = useState(8);
  if (!threads.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={title}>
      <h2 className="mb-3 text-sm font-medium">
        {title} <span className="text-muted-foreground">{threads.length}</span>
      </h2>
      <ul className="space-y-1">
        {threads.slice(0, limit).map((thread) => {
          const environment = environments.find(
            (entry) => entry.environmentId === thread.environmentId,
          );
          return (
            <li key={threadKey(thread)}>
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId: thread.environmentId, threadId: thread.id }}
                className="flex min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="truncate font-medium">{thread.title}</span>
                <span className="text-xs text-muted-foreground">
                  {reason?.get(threadKey(thread)) ??
                    (title === "Working" && !environment?.connected
                      ? "Last seen working"
                      : title)}{" "}
                  ·{" "}
                  {projects.get(JSON.stringify([thread.environmentId, thread.projectId])) ??
                    "Project unavailable"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {environment?.label ?? "Unavailable environment"}
                  {environment?.connected ? "" : " · saved activity"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {limit < threads.length ? (
        <Button variant="ghost" size="sm" onClick={() => setLimit((current) => current + 8)}>
          Show more ({threads.length - limit})
        </Button>
      ) : null}
    </section>
  );
}
function TaskGroup({
  title,
  rows,
  labels,
}: {
  readonly title: string;
  readonly rows: readonly DockInboxTask[];
  readonly labels: ReadonlyMap<EnvironmentId, string>;
}) {
  const [limit, setLimit] = useState(8);
  if (!rows.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={title}>
      <h2 className="mb-3 text-sm font-medium">
        {title} <span className="text-muted-foreground">{rows.length}</span>
      </h2>
      <ul className="space-y-1">
        {rows.slice(0, limit).map(({ task, environmentId, status }) => (
          <li key={JSON.stringify([environmentId, task.id])}>
            <Link
              to="/tasks"
              search={{ environmentId, taskId: task.id, archived: false }}
              className="flex min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="truncate font-medium">{task.title}</span>
              <span className="text-xs text-muted-foreground">
                {status.label}
                {task.dueDate ? ` · Due ${task.dueDate}` : ""} ·{" "}
                {labels.get(environmentId) ?? "Unavailable environment"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {limit < rows.length ? (
        <Button variant="ghost" size="sm" onClick={() => setLimit((current) => current + 8)}>
          Show more ({rows.length - limit})
        </Button>
      ) : null}
    </section>
  );
}

export function DockInboxPage() {
  const minute = useNowMinute();
  const nowMs = Date.parse(`${minute}:00.000Z`);
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = resolveInboxDay(nowMs, timeZone);
  const input = recapInput(day),
    previousInput = recapInput(day.previousDay);
  const current = useInboxRecaps(input),
    previous = useInboxRecaps(previousInput);
  const tasks = useDockTasks();
  const shells = useQuietThreadShells();
  const visits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threads = shells.map((thread) => {
    const visited = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      visits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
    );
    return visited === undefined ? thread : { ...thread, lastVisitedAt: visited };
  });
  const projects = useProjects();
  const projectNames = new Map(
    projects.map((project) => [JSON.stringify([project.environmentId, project.id]), project.title]),
  );
  const labels = new Map(current.environments.map((entry) => [entry.environmentId, entry.label]));
  const taskEnvironments = new Map(tasks.environments.map((entry) => [entry.environmentId, entry]));
  const live = new Set(
    current.environments.filter((entry) => entry.connected).map((entry) => entry.environmentId),
  );
  const threadMap = new Map(threads.map((thread) => [threadKey(thread), thread]));
  const groups = groupDockInboxThreads(threads, new Date(nowMs).toISOString());
  const date = new Date(nowMs);
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const taskRows = selectDockInboxTasks(
    tasks.tasks.map((row) => ({
      environmentId: row.environmentId,
      task: row.task,
      status: taskBoardStatus(
        row.task,
        row.task.thread && live.has(row.task.thread.thread.environmentId)
          ? (threadMap.get(
              JSON.stringify([
                row.task.thread.thread.environmentId,
                row.task.thread.thread.threadId,
              ]),
            ) ?? null)
          : null,
      ),
    })),
    day,
    today,
  );
  const aggregate = aggregateInboxRecaps(
    input,
    current.environments.flatMap((entry) =>
      entry.recap ? [{ environmentId: entry.environmentId, recap: entry.recap }] : [],
    ),
  );
  const yesterday = aggregateInboxRecaps(
    previousInput,
    previous.environments.flatMap((entry) =>
      entry.recap ? [{ environmentId: entry.environmentId, recap: entry.recap }] : [],
    ),
  );
  const refreshAll = () => {
    for (const [window, state] of [
      [input, current],
      [previousInput, previous],
    ] as const)
      for (const environment of state.environments)
        if (environment.connected && environment.status !== "unsupported")
          appAtomRegistry.refresh(
            serverEnvironment.inboxRecap({
              environmentId: environment.environmentId,
              input: window,
            }),
          );
  };
  const refresh = useEffectEvent(refreshAll);
  const observedMinute = useRef(minute);
  useEffect(() => {
    if (observedMinute.current === minute) return;
    observedMinute.current = minute;
    refresh();
  }, [minute]);
  const reason = new Map(
    groups.needsYou.map((item) => [
      threadKey(item.thread),
      item.kind === "approval"
        ? "Approval needed"
        : item.kind === "input"
          ? "Input needed"
          : "Plan ready",
    ]),
  );
  const totalThreads =
    groups.needsYou.length + groups.working.length + groups.finished.length + groups.failed.length;
  const hasAttention = totalThreads + taskRows.open.length + taskRows.doneToday.length > 0;
  const dataKnown =
    current.isReady &&
    current.environments.length > 0 &&
    current.environments.every((entry) => entry.hasThreadSnapshot || !entry.connected) &&
    tasks.environments.every((entry) => entry.status !== "loading");
  const greeting =
    day.currentSlotId === "morning"
      ? "Good morning"
      : day.currentSlotId === "afternoon"
        ? "Good afternoon"
        : "Good evening";
  return (
    <SidebarInset>
      <WorkspacePageHeader electron={isElectron}>
        <h1 className="min-w-0 flex-1 text-sm font-medium">Inbox</h1>
        <div className="[-webkit-app-region:no-drag] flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/tasks" search={{ archived: false }} />}
          >
            Tasks
          </Button>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            Refresh
          </Button>
        </div>
      </WorkspacePageHeader>
      <div className="@container min-h-0 flex-1 overflow-auto scrollbar-gutter-both p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <div>
            <h2 className="text-xl font-medium tracking-tight">{greeting}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(date)}{" "}
              · {timeZone}
            </p>
          </div>
          <div
            className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
            role="status"
          >
            {!current.isReady
              ? "Loading environments…"
              : current.environments.length === 0
                ? "Connect an environment to see its work."
                : current.environments.map((entry) => (
                    <span key={entry.environmentId} className="min-w-0 break-words">
                      {entry.label} · {entry.connected ? "connected" : "unavailable"}
                      {entry.status === "unsupported"
                        ? " · recap unavailable"
                        : entry.status === "error"
                          ? " · recap error"
                          : ""}
                      {!entry.hasThreadSnapshot ? " · thread data pending" : ""}
                      {taskEnvironments.get(entry.environmentId)?.status === "loading"
                        ? " · Tasks loading"
                        : taskEnvironments.get(entry.environmentId)?.status === "error"
                          ? " · Tasks unavailable"
                          : taskEnvironments.get(entry.environmentId)?.status === "unsupported"
                            ? " · Tasks unsupported"
                            : ""}
                    </span>
                  ))}
          </div>
          <div className="grid grid-cols-1 items-start gap-5 @3xl:grid-cols-2">
            <div className="min-w-0 space-y-4">
              {!hasAttention ? (
                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className="text-sm font-medium">Attention and Tasks</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {!dataKnown
                      ? "Waiting for environment data. Available snapshots will appear here."
                      : current.environments.every((entry) => !entry.connected)
                        ? "Environments are unavailable. Open their projects to inspect saved work."
                        : "No attention items or Tasks to show in the available data."}
                  </p>
                </section>
              ) : null}
              <ThreadGroup
                title="Needs you"
                threads={groups.needsYou.map((item) => item.thread)}
                environments={current.environments}
                projects={projectNames}
                reason={reason}
              />
              <ThreadGroup
                title="Working"
                threads={groups.working}
                environments={current.environments}
                projects={projectNames}
              />
              <TaskGroup
                title={taskRows.overdue ? `Tasks · ${taskRows.overdue} overdue` : "Tasks"}
                rows={taskRows.open}
                labels={labels}
              />
              <ThreadGroup
                title="Finished"
                threads={groups.finished}
                environments={current.environments}
                projects={projectNames}
              />
              <ThreadGroup
                title="Failed"
                threads={groups.failed}
                environments={current.environments}
                projects={projectNames}
              />
              <TaskGroup title="Tasks completed today" rows={taskRows.doneToday} labels={labels} />
            </div>
            <section
              className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-5"
              aria-label="Daily recap"
            >
              <div>
                <h2 className="text-sm font-medium">Your day</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  04:00 to 04:00 · {aggregate.environments} environment
                  {aggregate.environments === 1 ? "" : "s"} reporting
                </p>
              </div>
              {aggregate.environments === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {current.environments.some((entry) => entry.status === "loading")
                    ? "Loading the recap…"
                    : "No recap is available from these environments."}
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Prompts</dt>
                      <dd className="mt-1 text-2xl tabular-nums">
                        {formatNumber.format(aggregate.totals.prompts)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Reported tokens</dt>
                      <dd className="mt-1 text-2xl tabular-nums">
                        {formatNumber.format(
                          aggregate.totals.tokens.user +
                            aggregate.totals.tokens.agent +
                            aggregate.totals.tokens.automation,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Turns</dt>
                      <dd className="mt-1 text-lg tabular-nums">
                        {aggregate.totals.turns}
                        {aggregate.totals.failedTurns
                          ? ` · ${aggregate.totals.failedTurns} failed`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Agent work</dt>
                      <dd className="mt-1 text-lg tabular-nums">
                        {(aggregate.totals.agentWorkMs / 3_600_000).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}{" "}
                        h
                      </dd>
                    </div>
                  </dl>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {aggregate.slots.map((slot, index) => (
                      <div key={slot.from} className="rounded-lg border border-border p-3">
                        <h3 className="text-xs font-medium">{day.slots[index]?.label}</h3>
                        <p className="mt-2 text-sm tabular-nums">{slot.prompts} prompts</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatNumber.format(
                            slot.tokens.user + slot.tokens.agent + slot.tokens.automation,
                          )}{" "}
                          tokens
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tokens are reported main-agent usage at completion; work time can span slots.
                    {aggregate.totals.incompleteUsageTurns
                      ? ` ${aggregate.totals.incompleteUsageTurns} usage record(s) are incomplete or exclude subagents.`
                      : ""}
                  </p>
                  {current.environments.some((entry) => entry.recap && entry.status !== "ready") ? (
                    <p className="text-xs text-muted-foreground">
                      Includes saved recap data from unavailable environments.
                    </p>
                  ) : null}
                </>
              )}
              {yesterday.environments > 0 ? (
                <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                  Previous working day: {yesterday.totals.prompts} prompts ·{" "}
                  {formatNumber.format(
                    yesterday.totals.tokens.user +
                      yesterday.totals.tokens.agent +
                      yesterday.totals.tokens.automation,
                  )}{" "}
                  reported tokens.
                </p>
              ) : null}
              {aggregate.projects.length > 0 ? (
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-xs font-medium">Projects with reported activity</h3>
                  <ul className="space-y-2 text-sm">
                    {aggregate.projects.map((project) => (
                      <li key={JSON.stringify([project.environmentId, project.projectId])}>
                        <span>{project.title}</span>
                        <p className="text-xs text-muted-foreground">
                          {labels.get(project.environmentId) ?? project.environmentId} ·{" "}
                          {project.prompts} prompts · {formatNumber.format(project.tokens)} tokens
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {aggregate.models.length > 0 ? (
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-xs font-medium">Selected models</h3>
                  <ul className="space-y-2 text-sm">
                    {aggregate.models.map((model) => (
                      <li key={JSON.stringify([model.driver, model.model])}>
                        {model.model}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatNumber.format(model.tokens)} tokens
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
