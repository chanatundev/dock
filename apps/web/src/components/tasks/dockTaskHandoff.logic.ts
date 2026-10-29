import {
  CommandId,
  ThreadId,
  type DockTaskId,
  type EnvironmentId,
  type OrchestrationV2ThreadLaunchInput,
  type RunId,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type TaskCommand,
} from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";

export type DockTaskLinkCommand = Extract<TaskCommand, { type: "task.link" }>;

export interface DockTaskHandoffIntent {
  readonly launchCommandId: CommandId;
  readonly threadId: ThreadId;
  readonly linkCommandId: CommandId;
  launchInput: OrchestrationV2ThreadLaunchInput | null;
  createdThreadId: ThreadId | null;
  linkCommand: DockTaskLinkCommand | null;
  promptStaged: boolean;
}

export function createDockTaskHandoffIntent(): DockTaskHandoffIntent {
  return {
    launchCommandId: CommandId.make(randomUUID()),
    threadId: ThreadId.make(randomUUID()),
    linkCommandId: CommandId.make(randomUUID()),
    launchInput: null,
    createdThreadId: null,
    linkCommand: null,
    promptStaged: false,
  };
}

export async function performDockTaskHandoff(args: {
  readonly intent: DockTaskHandoffIntent;
  readonly task: {
    readonly id: DockTaskId;
    readonly revision: number;
    readonly title: string;
    readonly notes: string;
  };
  readonly ownerEnvironmentId: EnvironmentId;
  readonly project: ScopedProjectRef;
  readonly target:
    | { readonly type: "new"; readonly launchInput: OrchestrationV2ThreadLaunchInput }
    | { readonly type: "existing"; readonly threadId: ThreadId; readonly baseRunId?: RunId };
  readonly launch: (input: OrchestrationV2ThreadLaunchInput) => Promise<ThreadId>;
  readonly dispatch: (environmentId: EnvironmentId, command: DockTaskLinkCommand) => Promise<void>;
  readonly composer: {
    readonly getComposerDraft: (thread: ScopedThreadRef) => { readonly prompt: string } | null;
    readonly setPrompt: (thread: ScopedThreadRef, prompt: string) => void;
  };
  readonly navigate: (thread: ScopedThreadRef) => Promise<void> | void;
  readonly onThreadCreated?: (threadId: ThreadId) => void;
  readonly now?: () => string;
}): Promise<ScopedThreadRef> {
  const { intent, target, task, project } = args;
  let threadId = intent.linkCommand?.link.thread.threadId;
  let baseRunId = intent.linkCommand?.link.baseRunId ?? undefined;

  if (threadId === undefined && target.type === "existing") {
    threadId = target.threadId;
    baseRunId = target.baseRunId;
  }
  if (threadId === undefined && target.type === "new") {
    intent.launchInput ??= target.launchInput;
    if (intent.createdThreadId === null) {
      intent.createdThreadId = await args.launch(intent.launchInput);
      args.onThreadCreated?.(intent.createdThreadId);
    }
    threadId = intent.createdThreadId;
  }
  if (threadId === undefined) throw new Error("The Task handoff thread could not be resolved.");

  const command =
    intent.linkCommand ??
    (intent.linkCommand = {
      type: "task.link",
      commandId: intent.linkCommandId,
      taskId: task.id,
      expectedRevision: task.revision,
      link: {
        project,
        thread: { environmentId: project.environmentId, threadId },
        ...(baseRunId === undefined ? {} : { baseRunId }),
        linkedAt: (args.now ?? (() => new Date().toISOString()))(),
      },
    });

  await args.dispatch(args.ownerEnvironmentId, command);
  const threadRef = { environmentId: project.environmentId, threadId };
  if (!intent.promptStaged) {
    const existingPrompt = args.composer.getComposerDraft(threadRef)?.prompt ?? "";
    const taskPrompt = `Task: ${task.title}${task.notes ? `\n\n${task.notes}` : ""}`;
    args.composer.setPrompt(
      threadRef,
      existingPrompt ? `${existingPrompt}\n\n${taskPrompt}` : taskPrompt,
    );
    intent.promptStaged = true;
  }
  await args.navigate(threadRef);
  return threadRef;
}
