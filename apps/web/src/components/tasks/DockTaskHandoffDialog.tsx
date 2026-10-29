import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ThreadId,
  type DockTask,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationV2ThreadLaunchInput,
  type RunId,
  type ScopedProjectRef,
  type TaskCommand,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { isSidechatThread } from "@t3tools/shared/sidechatThread";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useComposerDraftStore } from "../../composerDraftStore";
import { orchestrationEnvironment } from "../../state/orchestration";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useDockTaskEnvironments } from "../../state/tasks";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { toastManager } from "../ui/toast";
import { scopedProjectRefKey } from "./dockTaskEditor.logic";
import { createDockTaskHandoffIntent, performDockTaskHandoff } from "./dockTaskHandoff.logic";

export function DockTaskHandoffDialog({
  task,
  ownerEnvironmentId,
  run,
  onClose,
}: {
  readonly task: DockTask;
  readonly ownerEnvironmentId: EnvironmentId;
  readonly run: (environmentId: EnvironmentId, command: TaskCommand) => Promise<void>;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const catalog = useDockTaskEnvironments();
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [projectKey, setProjectKey] = useState(
    task.project ? scopedProjectRefKey(task.project) : "",
  );
  const [threadId, setThreadId] = useState("");
  const [modelOverride, setModelOverride] = useState<ModelSelection | null>(null);
  const [createdThreadId, setCreatedThreadId] = useState<ThreadId | null>(null);
  const [intentStarted, setIntentStarted] = useState(false);
  const ownerAllowed = useAtomValue(
    serverEnvironment.dispatchTaskCommand.permissionAtom(ownerEnvironmentId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const intent = useRef(createDockTaskHandoffIntent());
  const resetIntent = () => {
    intent.current = createDockTaskHandoffIntent();
  };
  const project = projects.find(
    (candidate) =>
      scopedProjectRefKey({ environmentId: candidate.environmentId, projectId: candidate.id }) ===
      projectKey,
  );
  const environmentId = project?.environmentId ?? null;
  const environmentState = catalog.environments.find(
    (candidate) => candidate.environmentId === environmentId,
  );
  const config = useAtomValue(
    serverEnvironment.configValueAtom(environmentId ?? ownerEnvironmentId),
  );
  const settings = useEnvironmentSettings(environmentId ?? ownerEnvironmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId ?? ownerEnvironmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const launch = useAtomCommand(orchestrationEnvironment.v2.launchThread, { reportFailure: false });
  const launchAllowed = useAtomValue(
    orchestrationEnvironment.v2.launchThread.permissionAtom(environmentId ?? ownerEnvironmentId),
  );
  const operateAllowed = useAtomValue(
    orchestrationEnvironment.v2.dispatchCommand.permissionAtom(environmentId ?? ownerEnvironmentId),
  );
  const projectRecord = project ?? null;
  const instances = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      project?.id ?? null,
    ),
  );
  const selection = modelOverride ?? scheduledTaskDefaultModel(settings, projectRecord, instances);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const eligibleThreads = threads.filter(
    (thread) =>
      project !== undefined &&
      thread.environmentId === project.environmentId &&
      thread.projectId === project.id &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      !isSidechatThread(thread) &&
      thread.sidechatExpiredAt == null,
  );
  const selectedThread = eligibleThreads.find((thread) => thread.id === threadId);
  const projectItems = projects
    .filter((candidate) =>
      catalog.environments.some(
        (entry) => entry.environmentId === candidate.environmentId && entry.status === "ready",
      ),
    )
    .map((candidate) => ({
      value: scopedProjectRefKey({
        environmentId: candidate.environmentId,
        projectId: candidate.id,
      }),
      label: `${candidate.title} · ${catalog.environments.find((entry) => entry.environmentId === candidate.environmentId)?.label ?? candidate.environmentId}`,
    }));
  const disabled =
    busy ||
    !project ||
    environmentState?.status !== "ready" ||
    !config ||
    !ownerAllowed ||
    (targetMode === "new"
      ? createdThreadId === null && (!launchAllowed || !selection)
      : !operateAllowed || (!selectedThread && !intentStarted));

  const handoff = async () => {
    if (disabled || busyRef.current || !project || !environmentId) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setIntentStarted(true);
    let createdInThisAttempt = false;
    try {
      const projectRef: ScopedProjectRef = { environmentId, projectId: project.id };
      let target:
        | { readonly type: "new"; readonly launchInput: OrchestrationV2ThreadLaunchInput }
        | { readonly type: "existing"; readonly threadId: ThreadId; readonly baseRunId?: RunId };
      if (targetMode === "existing") {
        const linked = intent.current.linkCommand?.link;
        const selectedThreadId = linked?.thread.threadId ?? selectedThread?.id;
        if (!selectedThreadId) return;
        const baseRunId = linked?.baseRunId ?? selectedThread?.latestRun?.runId;
        target = {
          type: "existing",
          threadId: selectedThreadId,
          ...(baseRunId ? { baseRunId } : {}),
        };
      } else {
        if (!selection) return;
        const resolved = resolveProjectSettings(settings, project.id, project).settings;
        target = {
          type: "new",
          launchInput: {
            commandId: intent.current.launchCommandId,
            threadId: intent.current.threadId,
            creationSource: "web",
            projectId: project.id,
            title: task.title,
            generateTitle: false,
            modelSelection: selection,
            runtimeMode: resolved.defaultRuntimeMode,
            interactionMode: "default",
            workspaceStrategy: { type: "root" },
          },
        };
      }
      await performDockTaskHandoff({
        intent: intent.current,
        task,
        ownerEnvironmentId,
        project: projectRef,
        target,
        launch: async (input) => {
          const result = await launch({ environmentId, input });
          if (result._tag !== "Success") throw squashAtomCommandFailure(result);
          return result.value.threadId;
        },
        dispatch: run,
        composer: {
          getComposerDraft: (threadRef) =>
            useComposerDraftStore.getState().getComposerDraft(threadRef),
          setPrompt: (threadRef, prompt) =>
            useComposerDraftStore.getState().setPrompt(threadRef, prompt),
        },
        navigate: (threadRef) =>
          navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
          }),
        onThreadCreated: (createdId) => {
          createdInThisAttempt = true;
          setCreatedThreadId(createdId);
        },
      });
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toastManager.add({
        type: "error",
        title: "Task handoff failed",
        description:
          createdInThisAttempt || createdThreadId !== null
            ? `${message} The new thread is still available; retry to finish linking the Task.`
            : message,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Prepare Task in a thread</DialogTitle>
          <DialogDescription>
            The Task details will be added to the composer for you to review and send.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="dock-task-handoff-project">Project and environment</Label>
              <Select
                items={projectItems}
                value={projectKey}
                disabled={busy || intentStarted || createdThreadId !== null}
                onValueChange={(value) => {
                  resetIntent();
                  setProjectKey(value ?? "");
                  setThreadId("");
                  setModelOverride(null);
                }}
              >
                <SelectTrigger id="dock-task-handoff-project">
                  <SelectValue placeholder="Choose a connected project" />
                </SelectTrigger>
                <SelectPopup>
                  {projectItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dock-task-handoff-target">Thread</Label>
              <Select
                value={targetMode}
                disabled={busy || intentStarted || createdThreadId !== null}
                items={[
                  { value: "new", label: "Create a new empty thread" },
                  { value: "existing", label: "Use an existing thread" },
                ]}
                onValueChange={(value) => {
                  if (value === "new" || value === "existing") {
                    resetIntent();
                    setTargetMode(value);
                    setThreadId("");
                  }
                }}
              >
                <SelectTrigger id="dock-task-handoff-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="new">Create a new empty thread</SelectItem>
                  <SelectItem value="existing">Use an existing thread</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            {targetMode === "existing" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="dock-task-handoff-thread">Existing thread</Label>
                <Select
                  items={eligibleThreads.map((thread) => ({
                    value: thread.id,
                    label: thread.title,
                  }))}
                  value={threadId}
                  disabled={busy || intentStarted || !project}
                  onValueChange={(value) => {
                    resetIntent();
                    setThreadId(value ?? "");
                  }}
                >
                  <SelectTrigger id="dock-task-handoff-thread">
                    <SelectValue placeholder="Choose an ordinary thread" />
                  </SelectTrigger>
                  <SelectPopup>
                    {eligibleThreads.map((thread) => (
                      <SelectItem key={thread.id} value={thread.id}>
                        {thread.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ) : project && selection ? (
              <div className="grid gap-2">
                <Label>New thread model</Label>
                <ProviderModelPicker
                  environmentId={environmentId!}
                  activeInstanceId={selection.instanceId}
                  model={selection.model}
                  lockedProvider={null}
                  instanceEntries={instances}
                  modelOptionsByInstance={modelOptions}
                  disabled={busy || intentStarted || createdThreadId !== null}
                  isComposerOwned={false}
                  onInstanceModelChange={(instanceId, model) => {
                    resetIntent();
                    setModelOverride({ instanceId, model });
                  }}
                />
              </div>
            ) : null}
            {project && environmentState?.status !== "ready" ? (
              <p role="status" className="text-sm text-muted-foreground">
                Connect this environment to prepare the Task thread.
              </p>
            ) : null}
            {targetMode === "existing" && !eligibleThreads.length ? (
              <p className="text-sm text-muted-foreground">
                No ordinary threads are available in this project.
              </p>
            ) : null}
            {targetMode === "new" && project && !selection ? (
              <p role="status" className="text-sm text-muted-foreground">
                No available provider model is configured for this environment.
              </p>
            ) : null}
            {createdThreadId || intentStarted ? (
              <p role="status" className="text-sm text-muted-foreground">
                {createdThreadId
                  ? "Empty thread created. Retry to finish linking this Task."
                  : "Retry will reuse the same empty-thread creation request."}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={disabled} onClick={() => void handoff()}>
            {busy ? "Preparing…" : intentStarted ? "Retry handoff" : "Prepare thread"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
