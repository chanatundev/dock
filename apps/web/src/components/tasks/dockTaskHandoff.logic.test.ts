import {
  DockTaskId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadLaunchInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  createDockTaskHandoffIntent,
  performDockTaskHandoff,
  type DockTaskLinkCommand,
} from "./dockTaskHandoff.logic";

describe("performDockTaskHandoff", () => {
  it("reuses accepted launch and link payloads after lost responses and stages once without replacing attachments", async () => {
    const environmentId = EnvironmentId.make("env");
    const project = { environmentId, projectId: ProjectId.make("project") };
    const task = {
      id: DockTaskId.make("task"),
      revision: 3,
      title: "Tune the parser",
      notes: "Preserve the existing behavior.",
    };
    const intent = createDockTaskHandoffIntent();
    const launchInput: OrchestrationV2ThreadLaunchInput = {
      commandId: intent.launchCommandId,
      threadId: intent.threadId,
      creationSource: "web",
      projectId: project.projectId,
      title: task.title,
      generateTitle: false,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
    };
    const launchCalls: OrchestrationV2ThreadLaunchInput[] = [];
    let acceptedLaunch: OrchestrationV2ThreadLaunchInput | null = null;
    let acceptedThreadId: ThreadId | null = null;
    const launch = async (input: OrchestrationV2ThreadLaunchInput): Promise<ThreadId> => {
      launchCalls.push(input);
      if (acceptedLaunch === null) {
        acceptedLaunch = input;
        acceptedThreadId = input.threadId!;
        throw new Error("launch response lost after acceptance");
      }
      expect(input).toEqual(acceptedLaunch);
      return acceptedThreadId!;
    };

    const linkCalls: DockTaskLinkCommand[] = [];
    let acceptedLink: DockTaskLinkCommand | null = null;
    const dispatch = async (_owner: EnvironmentId, command: DockTaskLinkCommand) => {
      linkCalls.push(command);
      if (acceptedLink === null) {
        acceptedLink = structuredClone(command);
        throw new Error("link response lost after acceptance");
      }
      expect(command).toEqual(acceptedLink);
    };

    const attachment = { name: "notes.txt", attachmentId: "attachment-1" };
    let draft = { prompt: "Existing unsent prompt", attachments: [attachment] };
    const promptWrites: string[] = [];
    const composer = {
      getComposerDraft: () => draft,
      setPrompt: (
        _thread: { environmentId: EnvironmentId; threadId: ThreadId },
        prompt: string,
      ) => {
        promptWrites.push(prompt);
        draft = { ...draft, prompt };
      },
    };
    let navigationAttempts = 0;
    const navigate = () => {
      navigationAttempts += 1;
      if (navigationAttempts === 1) throw new Error("navigation response lost");
    };
    let createdCallbacks = 0;
    let attempts = 0;
    const changedRetryInput: OrchestrationV2ThreadLaunchInput = {
      ...launchInput,
      modelSelection: { ...launchInput.modelSelection, model: "other-model" },
    };
    const attempt = () => {
      attempts += 1;
      return performDockTaskHandoff({
        intent,
        task,
        ownerEnvironmentId: EnvironmentId.make("owner"),
        project,
        target: { type: "new", launchInput: attempts === 1 ? launchInput : changedRetryInput },
        launch,
        dispatch,
        composer,
        navigate,
        onThreadCreated: () => {
          createdCallbacks += 1;
        },
        now: () => "2026-10-29T12:00:00.000Z",
      });
    };

    await expect(attempt()).rejects.toThrow("launch response lost after acceptance");
    await expect(attempt()).rejects.toThrow("link response lost after acceptance");
    await expect(attempt()).rejects.toThrow("navigation response lost");
    const result = await attempt();

    expect(result).toEqual({ environmentId, threadId: intent.threadId });
    expect(launchCalls).toHaveLength(2);
    expect(launchCalls[0]).toEqual(launchInput);
    expect(launchCalls[1]).toEqual(launchInput);
    expect(linkCalls).toHaveLength(3);
    expect(linkCalls[0]).toEqual(linkCalls[1]);
    expect(linkCalls[1]).toEqual(linkCalls[2]);
    expect(linkCalls[0]).toMatchObject({
      commandId: intent.linkCommandId,
      expectedRevision: task.revision,
      link: {
        project,
        thread: { environmentId, threadId: intent.threadId },
        linkedAt: "2026-10-29T12:00:00.000Z",
      },
    });
    expect(promptWrites).toEqual([
      "Existing unsent prompt\n\nTask: Tune the parser\n\nPreserve the existing behavior.",
    ]);
    expect(draft.attachments).toEqual([attachment]);
    expect(createdCallbacks).toBe(1);
    expect(intent.promptStaged).toBe(true);
  });
});
