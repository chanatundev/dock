import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as SidechatService from "./SidechatService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as Receipts from "./CommandReceiptStore.ts";
import { DispatchModeLimit } from "./DispatchModeLimit.ts";

const now = DateTime.makeUnsafe("2026-10-26T12:00:00.000Z");
const parentId = ThreadId.make("parent-side-service");
const childId = ThreadId.make("child-side-service");
const instanceId = ProviderInstanceId.make("codex");
const parent: OrchestrationV2AppThread = {
  id: parentId,
  projectId: ProjectId.make("source-project"),
  title: "Parent work",
  modelSelection: { instanceId, model: "test-model" },
  providerInstanceId: instanceId,
  runtimeMode: "auto-accept-edits",
  interactionMode: "plan",
  branch: "working-branch",
  worktreePath: "/source/checkout",
  activeProviderThreadId: null,
  pullRequests: [],
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: parentId },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

function setup(options?: { readonly replay?: boolean; readonly missingParent?: boolean }) {
  const launches: ThreadLaunch.ThreadLaunchInput[] = [];
  const sends: ThreadManagement.ThreadManagementSendInput[] = [];
  const child = {
    ...parent,
    id: childId,
    sidechatSourceThreadId: parentId,
    sidechatCapturedAt: DateTime.formatIso(now),
    sidechatExpiredAt: DateTime.formatIso(now),
  };
  const layer = SidechatService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: (id) =>
            id === childId
              ? Effect.succeed(child)
              : options?.missingParent
                ? Effect.fail(
                    new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId: id }),
                  )
                : Effect.succeed(parent),
        }),
        Layer.mock(Receipts.CommandReceiptStoreV2)({
          getByCommandId: (commandId) =>
            Effect.succeed(
              options?.replay
                ? Option.some({
                    commandId,
                    threadId: childId,
                    commandType: "thread.create",
                    acceptedAt: now,
                    resultSequence: 4,
                    status: "accepted",
                    error: null,
                  })
                : Option.none(),
            ),
        }),
        Layer.mock(ThreadLaunch.ThreadLaunchService)({
          launch: (input) =>
            Effect.sync(() => {
              launches.push(input);
              return {
                threadId: childId,
                projection: { thread: child },
                resumed: false,
              } as ThreadLaunch.ThreadLaunchResult;
            }),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          sendToThread: (input) =>
            Effect.sync(() => {
              sends.push(input);
              return {
                dispatch: { sequence: 5, storedEvents: [] },
              } as unknown as ThreadManagement.ThreadManagementSendResult;
            }),
        }),
      ),
    ),
  );
  return { layer, launches, sends };
}

it.effect("opens an independent conversation with parent model, modes and checkout", () => {
  const test = setup();
  return Effect.gen(function* () {
    const service = yield* SidechatService.SidechatService;
    assert.deepEqual(
      yield* service.open(
        { commandId: CommandId.make("open-side"), sourceThreadId: parentId },
        { createdBy: "user", creationSource: "web" },
      ),
      { threadId: childId },
    );
    assert.lengthOf(test.launches, 1);
    const launch = test.launches[0]!;
    assert.deepEqual(launch.modelSelection, parent.modelSelection);
    assert.equal(launch.runtimeMode, parent.runtimeMode);
    assert.equal(launch.interactionMode, parent.interactionMode);
    assert.equal(launch.projectId, parent.projectId);
    assert.deepEqual(launch.workspaceStrategy, {
      type: "existing_worktree",
      worktreePath: "/source/checkout",
      branch: "working-branch",
    });
    assert.deepEqual(launch.sidechat, { kind: "thread", threadId: parentId });
    assert.isUndefined(launch.initialMessage);
    assert.isUndefined(launch.importedNativeThread);
  }).pipe(Effect.provide(test.layer));
});

it.effect("allows an explicit model choice without changing inherited permissions", () => {
  const test = setup();
  return Effect.gen(function* () {
    const service = yield* SidechatService.SidechatService;
    const modelSelection = { instanceId: ProviderInstanceId.make("other"), model: "other-model" };
    yield* service.open(
      { commandId: CommandId.make("open-other"), sourceThreadId: parentId, modelSelection },
      { createdBy: "user", creationSource: "web" },
    );
    assert.deepEqual(test.launches[0]?.modelSelection, modelSelection);
    assert.equal(test.launches[0]?.runtimeMode, parent.runtimeMode);
  }).pipe(Effect.provide(test.layer));
});

it.effect("replays an accepted open after the parent was deleted without launching twice", () => {
  const test = setup({ replay: true, missingParent: true });
  return Effect.gen(function* () {
    const service = yield* SidechatService.SidechatService;
    assert.equal(
      (yield* service.open(
        { commandId: CommandId.make("open-replay"), sourceThreadId: parentId },
        { createdBy: "user", creationSource: "web" },
      )).threadId,
      childId,
    );
    assert.lengthOf(test.launches, 0);
  }).pipe(Effect.provide(test.layer));
});

it.effect("refuses inherited modes above an issuing agent's ceiling", () => {
  const test = setup();
  return Effect.gen(function* () {
    const service = yield* SidechatService.SidechatService;
    const error = yield* service
      .open(
        { commandId: CommandId.make("open-refused"), sourceThreadId: parentId },
        { createdBy: "agent", creationSource: "mcp" },
      )
      .pipe(Effect.flip);
    assert.equal(error.reason, "mode-limit");
    assert.lengthOf(test.launches, 0);
  }).pipe(
    Effect.provideService(DispatchModeLimit, {
      runtimeMode: "approval-required",
      interactionMode: "plan",
    }),
    Effect.provide(test.layer),
  );
});

it.effect("queues reviewed text from a retained expired transcript into its parent", () => {
  const test = setup();
  return Effect.gen(function* () {
    const service = yield* SidechatService.SidechatService;
    yield* service.sendToParent(
      {
        commandId: CommandId.make("side-return"),
        sidechatThreadId: childId,
        text: "Reviewed finding",
      },
      { createdBy: "user", creationSource: "web" },
    );
    assert.lengthOf(test.sends, 1);
    assert.equal(test.sends[0]?.threadId, parentId);
    assert.equal(test.sends[0]?.mode, "queue");
    assert.equal(test.sends[0]?.text, "Reviewed finding");
    assert.deepEqual(test.sends[0]?.attachments, []);
  }).pipe(Effect.provide(test.layer));
});
