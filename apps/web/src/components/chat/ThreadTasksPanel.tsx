import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { CommandId, type EnvironmentId, type TaskCommand, type ThreadId } from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { dockTaskMutationPermissions, useDockTasks } from "../../state/tasks";
import { environmentIdsKey } from "../../state/environmentAtomList";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

export function ThreadTasksPanel({
  environmentId,
  threadId,
  compact,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly compact: boolean;
}) {
  const catalog = useDockTasks();
  const permissions = useAtomValue(
    dockTaskMutationPermissions(environmentIdsKey(catalog.environmentIds)),
  );
  const dispatch = useAtomCommand(serverEnvironment.dispatchTaskCommand, { reportFailure: false });
  const related = catalog.tasks.filter(
    ({ task }) =>
      task.thread?.thread.environmentId === environmentId &&
      task.thread.thread.threadId === threadId,
  );
  if (!related.length) return null;

  const act = async (owner: EnvironmentId, command: TaskCommand) => {
    const result = await dispatch({
      environmentId: owner,
      input: { command, creationSource: "web" },
    });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
  };
  const run = (owner: EnvironmentId, command: TaskCommand) =>
    void act(owner, command).catch((error: unknown) =>
      toastManager.add({
        type: "error",
        title: "Task change failed",
        description: error instanceof Error ? error.message : String(error),
      }),
    );

  return (
    <ThreadDetailsSection headingId="thread-details-tasks-heading" title="Tasks">
      {(compact ? related.slice(0, 1) : related).map(
        ({ environmentId: owner, task, ownerStatus }) => {
          const index = catalog.environmentIds.indexOf(owner);
          const canMutate =
            ownerStatus === "ready" && permissions[index] === true && task.archivedAt === null;
          const busyKey = JSON.stringify([owner, task.id]);
          return (
            <div key={busyKey} className="mb-2 rounded-md border p-2">
              <ThreadDetailsControl
                render={
                  <Link
                    to="/tasks"
                    search={{
                      environmentId: owner,
                      taskId: task.id,
                      archived: task.archivedAt !== null,
                    }}
                  />
                }
                multiline
              >
                <span className="truncate">{task.title}</span>
              </ThreadDetailsControl>
              <p className="px-1.5 text-xs text-muted-foreground">
                {task.priority !== "none" ? `${task.priority} priority` : "No priority"}
                {task.dueDate ? ` · Due ${task.dueDate}` : ""}
                {ownerStatus === "ready" ? "" : ` · ${ownerStatus}`}
              </p>
              <div className="mt-1 flex gap-1 px-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canMutate || task.completedAt !== null}
                  onClick={() =>
                    run(owner, {
                      type: "task.complete",
                      commandId: CommandId.make(randomUUID()),
                      taskId: task.id,
                      expectedRevision: task.revision,
                    })
                  }
                >
                  Complete
                </Button>
                {task.completedAt !== null ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!canMutate}
                    onClick={() =>
                      run(owner, {
                        type: "task.reopen",
                        commandId: CommandId.make(randomUUID()),
                        taskId: task.id,
                        expectedRevision: task.revision,
                      })
                    }
                  >
                    Reopen
                  </Button>
                ) : null}
              </div>
            </div>
          );
        },
      )}
      {related.length > 1 && compact ? (
        <p className="px-1.5 text-xs text-muted-foreground">
          {related.length - 1} more linked Tasks
        </p>
      ) : null}
    </ThreadDetailsSection>
  );
}
