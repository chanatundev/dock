import * as DateTime from "effect/DateTime";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as EventSink from "./EventSink.ts";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { assert, it, vi } from "@effect/vitest";
import {
  CommandId,
  CheckpointId,
  CheckpointScopeId,
  EventId,
  EnvironmentId,
  ComposerContextId,
  MessageId,
  NodeId,
  ProviderSessionId,
  RuntimeRequestId,
  RunId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { SIDECHAT_EXPIRED_EXECUTION_MESSAGE } from "./sidechatLifecycle.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("Metadata tests never start a provider process"),
};
const databaseLayer = SqlitePersistence.layerMemory;
const runtimeLayer = ProviderReplayHarness.layerWithRegistry(
  { name: "sidechat-metadata" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { runEffectWorker: false, databaseLayer },
);

const layer = Layer.mergeAll(
  databaseLayer,
  EffectOutbox.layer.pipe(Layer.provide(databaseLayer)),
  ProjectionStore.layer.pipe(Layer.provide(databaseLayer)),
  runtimeLayer,
);

it.effect.each(["running", "queued", "pending-input"] as const)(
  "does not expire a side chat with $0 work",
  (state) =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const sink = yield* EventSink.EventSinkV2;
      const threadId = ThreadId.make(`protected-sidechat:${state}`);
      yield* createSidechat(threadId);
      if (state === "pending-input") {
        const now = yield* DateTime.now;
        yield* sink.write({
          commandId: CommandId.make("pending-sidechat-input"),
          events: [
            {
              id: EventId.make("pending-sidechat-input-event"),
              type: "runtime-request.updated",
              threadId,
              occurredAt: now,
              payload: {
                id: RuntimeRequestId.make("sidechat-input"),
                nodeId: NodeId.make("sidechat-input-node"),
                providerTurnId: null,
                nativeRequestRef: null,
                kind: "user_input",
                status: "pending",
                responseCapability: { type: "message" },
                createdAt: now,
                resolvedAt: null,
              },
            },
          ],
        });
      } else {
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`sidechat-protected-send:${state}`),
          threadId,
          messageId: MessageId.make(`sidechat-protected-message:${state}`),
          text: "Work",
          attachments: [],
          modelSelection,
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        if (state === "queued") {
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("sidechat-protected-queue"),
            threadId,
            messageId: MessageId.make("sidechat-protected-queued-message"),
            text: "Next",
            attachments: [],
            modelSelection,
            dispatchMode: { type: "queue_after_active" },
            createdBy: "user",
            creationSource: "web",
          });
          const queued = yield* orchestrator.getThreadProjection(threadId);
          const now = yield* DateTime.now;
          yield* sink.write({
            commandId: CommandId.make("sidechat-hold-queue"),
            events: queued.runs.map((run) => ({
              id: EventId.make(`sidechat-hold:${run.id}`),
              type: "run.updated" as const,
              threadId,
              occurredAt: now,
              payload:
                run.status === "queued"
                  ? { ...run, queueHeld: true }
                  : { ...run, status: "completed" as const, completedAt: now },
            })),
          });
          const held = yield* orchestrator.getThreadProjection(threadId);
          assert.isTrue(held.runs.some((run) => run.status === "queued" && run.queueHeld === true));
          assert.isFalse(
            held.runs.some(
              (run) =>
                run.status === "running" ||
                run.status === "starting" ||
                run.status === "waiting" ||
                run.status === "preparing",
            ),
          );
        }
      }
      const thread = yield* projections.getThread(threadId);
      yield* TestClock.adjust("2 hours");
      yield* orchestrator.dispatch({
        type: "thread.sidechat.expire",
        commandId: CommandId.make(`expire-protected:${state}`),
        threadId,
        expectedLastActivityAt: DateTime.formatIso(thread.updatedAt),
      });
      assert.isNull((yield* projections.getThread(threadId)).sidechatExpiredAt);
    }).pipe(Effect.provide(layer)),
);

it.effect("persists session detach in the expiry transaction without deleting the transcript", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const sink = yield* EventSink.EventSinkV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const threadId = ThreadId.make("detach-sidechat");
    const thread = yield* createSidechat(threadId);
    const now = yield* DateTime.now;
    const sessionId = ProviderSessionId.make("sidechat-session");
    yield* sink.write({
      commandId: CommandId.make("sidechat-session-open"),
      events: [
        {
          id: EventId.make("sidechat-session-open-event"),
          type: "provider-session.attached",
          threadId,
          occurredAt: now,
          payload: {
            id: sessionId,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: instanceId,
            status: "ready",
            cwd: "/repo",
            model: modelSelection.model,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
        },
      ],
    });
    yield* TestClock.adjust("1 hour");
    const commandId = CommandId.make("expire-detach-sidechat");
    const result = yield* orchestrator.dispatch({
      type: "thread.sidechat.expire",
      commandId,
      threadId,
      expectedLastActivityAt: thread.sidechatLastActivityAt!,
    });
    assert.deepEqual(
      result.storedEvents.map((stored) => stored.event.type),
      ["thread.metadata-updated", "provider-session.detached"],
    );
    const effects = yield* outbox.listByCommandId(commandId);
    assert.lengthOf(effects, 1);
    assert.equal(effects[0]?.threadId, threadId);
    assert.equal(effects[0]?.request.type, "provider-session.detach");
    const detach = effects[0]?.request;
    assert.isTrue(
      detach?.type === "provider-session.detach" && detach.revokeMcpCredential === true,
    );
    const retained = yield* orchestrator.getThreadProjection(threadId);
    assert.isNull(retained.thread.deletedAt);
    assert.isString(retained.thread.sidechatExpiredAt);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "rejects rollback and preparation retries on an expired side chat before doing work",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("readonly-sidechat");
      const thread = yield* createSidechat(threadId);
      yield* TestClock.adjust("1 hour");
      yield* orchestrator.dispatch({
        type: "thread.sidechat.expire",
        commandId: CommandId.make("expire-readonly"),
        threadId,
        expectedLastActivityAt: thread.sidechatLastActivityAt!,
      });
      const commands = [
        {
          type: "checkpoint.rollback" as const,
          commandId: CommandId.make("expired-rollback"),
          threadId,
          scopeId: CheckpointScopeId.make("scope"),
          checkpointId: CheckpointId.make("checkpoint"),
        },
        {
          type: "prepared-run.retry" as const,
          commandId: CommandId.make("expired-preparation-retry"),
          threadId,
          runId: RunId.make("failed-preparation"),
        },
      ];
      for (const command of commands) {
        const result = yield* orchestrator.dispatch(command).pipe(Effect.result);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.equal(result.failure._tag, "OrchestratorDispatchError");
          if (result.failure._tag === "OrchestratorDispatchError")
            assert.include(String(result.failure.cause), SIDECHAT_EXPIRED_EXECUTION_MESSAGE);
        }
      }
    }).pipe(Effect.provide(layer)),
);

const createSidechat = Effect.fn("test.createSidechat")(function* (threadId: ThreadId) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const parentId = ThreadId.make("original-parent");
  const parent = yield* projections
    .getThread(parentId)
    .pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }));
  if (parent === null)
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create-original-parent"),
      threadId: parentId,
      projectId: ProjectId.make("sidechat-project"),
      title: "Parent",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make("sidechat-project"),
    title: "Side question",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
    sidechat: {
      kind: "thread",
      threadId: ThreadId.make("original-parent"),
      snapshotSequence: 1,
      capturedAt: "2026-10-25T12:00:00.000Z",
    },
  });
  return yield* (yield* ProjectionStore.ProjectionStoreV2).getThread(threadId);
});

it.effect("freezes the bounded issue card without adding its body to thread metadata", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = ThreadId.make("issue-ask-snapshot");
    const reference = {
      version: 1 as const,
      kind: "github-issue" as const,
      contextId: ComposerContextId.make("issue-opening"),
      label: "#42 Cache problem",
      environmentId: EnvironmentId.make("issue-owner"),
      projectId: ProjectId.make("issue-checkout"),
      host: "github.com",
      repository: "acme/app",
      number: 42,
      url: "https://github.com/acme/app/issues/42",
      title: "Cache problem",
      state: "open" as const,
      capturedAt: "2026-10-27T12:00:00.000Z",
      sourceUpdatedAt: "2026-10-26T12:00:00.000Z",
      body: "Opening issue description",
      bodyTruncated: false,
      comments: [
        {
          id: "comment-1",
          author: null,
          url: "https://github.com/acme/app/issues/42#comment-1",
          createdAt: "2026-10-26T12:00:00.000Z",
          body: "Opening comment",
          bodyTruncated: false,
        },
      ],
      totalComments: 1,
      omittedComments: 0,
    };
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create-issue-ask"),
      threadId,
      projectId: ProjectId.make("execution-project"),
      title: "Ask about issue",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
      sidechat: {
        kind: "github-issue",
        context: {
          kind: "github-issue",
          sourceEnvironmentId: reference.environmentId,
          projectId: reference.projectId,
          host: reference.host,
          repository: reference.repository,
          number: reference.number,
          title: reference.title,
          url: reference.url,
          updatedAt: reference.sourceUpdatedAt,
        },
        reference,
      },
    });
    const frozen = yield* projections.getSidechatSnapshot(threadId);
    assert.include(frozen!.referenceText, "Opening issue description");
    assert.include(frozen!.referenceText, "Opening comment");
    assert.deepEqual(frozen!.issueContext, reference);
    assert.notProperty(frozen!.source, "reference");
    assert.notInclude(
      JSON.stringify((yield* projections.getThread(threadId)).sidechatContext),
      "Opening issue description",
    );
    assert.lengthOf((yield* orchestrator.getThreadProjection(threadId)).runs, 0);
    const refreshed = {
      ...reference,
      capturedAt: "2026-10-27T13:00:00.000Z",
      body: "Refreshed issue description",
    };
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("send-refreshed-issue"),
      threadId,
      messageId: MessageId.make("refreshed-issue-message"),
      text: "Compare this newer reference",
      context: { version: 1, records: [refreshed] },
      attachments: [],
      modelSelection,
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    assert.deepEqual(yield* projections.getSidechatSnapshot(threadId), frozen);
    const updated = yield* orchestrator.getThreadProjection(threadId);
    assert.deepEqual(updated.messages[0]?.context?.records, [refreshed]);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "freezes committed partial output at creation and survives parent edits, deletion and replay",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const sink = yield* EventSink.EventSinkV2;
      const parentId = ThreadId.make("original-parent");
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("capture-parent"),
        threadId: parentId,
        projectId: ProjectId.make("sidechat-project"),
        title: "Parent",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("parent-active-prompt"),
        threadId: parentId,
        messageId: MessageId.make("parent-work"),
        text: "Parent work",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      const parentProjection = yield* projections.getThreadProjection(parentId);
      const parentRun = parentProjection.runs[0]!;
      assert.include(["preparing", "starting", "running"], parentRun.status);
      const now = yield* DateTime.now;
      const partial = {
        id: TurnItemId.make("parent-partial"),
        threadId: parentId,
        runId: parentRun.id,
        nodeId: parentRun.rootNodeId,
        providerThreadId: parentRun.providerThreadId,
        providerTurnId: null,
        type: "assistant_message" as const,
        messageId: MessageId.make("partial-message"),
        text: "Committed partial answer",
        streaming: true,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        title: null,
        status: "running" as const,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
      };
      yield* sink.write({
        events: [
          {
            id: EventId.make("partial-capture-source"),
            threadId: parentId,
            type: "turn-item.updated",
            occurredAt: now,
            payload: partial,
          },
        ],
      });
      const source = yield* projections.getThreadSnapshot(parentId);
      const sideId = ThreadId.make("frozen-side");
      yield* createSidechat(sideId);
      const captured = yield* projections.getSidechatSnapshot(sideId);
      assert.isNotNull(captured);
      assert.deepEqual(
        captured?.items.map((item) => item.id),
        source.projection.visibleTurnItems.map((row) => row.item.id),
      );
      assert.equal(
        captured?.source.kind === "thread" ? captured.source.snapshotSequence : -1,
        source.snapshotSequence,
      );
      yield* sink.write({
        events: [
          {
            id: EventId.make("partial-later-update"),
            threadId: parentId,
            type: "turn-item.updated",
            occurredAt: now,
            payload: { ...partial, text: "Changed later", streaming: false },
          },
        ],
      });
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("delete-capture-parent"),
        threadId: parentId,
      });
      yield* createSidechat(sideId);
      assert.deepEqual(yield* projections.getSidechatSnapshot(sideId), captured);
      assert.equal(
        (yield* projections.getThreadShell(sideId))?.sidechatSnapshotSequence,
        source.snapshotSequence,
      );
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("frozen-side-prompt"),
        threadId: sideId,
        messageId: MessageId.make("side-prompt"),
        text: "Explain the partial answer",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      const projection = yield* projections.getThreadProjection(sideId);
      assert.lengthOf(projection.contextHandoffs, 1);
      assert.equal(projection.contextHandoffs[0]?.strategy, "manual_context");
      assert.isNull(projection.contextHandoffs[0]?.transferId);
      assert.equal(
        projection.contextHandoffs[0]?.history?.messages.find((item) => item.itemId === partial.id)
          ?.text,
        partial.text,
      );
      assert.equal(projection.messages[0]?.text, "Explain the partial answer");
      assert.isNull(projection.thread.forkedFrom);
    }).pipe(Effect.provide(layer)),
);

it.effect("rolls back thread creation when its frozen context cannot be persisted", () =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* createSidechat(ThreadId.make("seed-atomic-source"));
    const apply = projections.apply;
    using failure = vi
      .spyOn(projections, "apply")
      .mockImplementation((event) =>
        event.type === "sidechat.context-captured"
          ? Effect.fail(
              new ProjectionStore.ProjectionStoreApplyEventError({ eventType: event.type }),
            )
          : apply(event),
      );
    const id = ThreadId.make("atomic-side");
    const failed = yield* createSidechat(id).pipe(Effect.result);
    assert.isTrue(Result.isFailure(failed));
    const thread = yield* projections
      .getThread(id)
      .pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }));
    assert.isNull(thread);
    assert.isNull(yield* projections.getSidechatSnapshot(id));
    failure.mockRestore();
    yield* createSidechat(id);
    assert.isNotNull(yield* projections.getSidechatSnapshot(id));
  }).pipe(Effect.provide(layer)),
);

it.effect("does not restart inactivity when an old activity write is retried later", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = ThreadId.make("delayed-activity-sidechat");
    yield* createSidechat(threadId);
    yield* TestClock.adjust("30 minutes");
    const activityAt = DateTime.formatIso(yield* DateTime.now);
    yield* TestClock.adjust("2 hours");
    yield* orchestrator.dispatch({
      type: "thread.sidechat.activity.record",
      commandId: CommandId.make("delayed-activity-write"),
      threadId,
      activityAt,
    });
    yield* orchestrator.dispatch({
      type: "thread.sidechat.expire",
      commandId: CommandId.make("expire-after-delayed-write"),
      threadId,
      expectedLastActivityAt: activityAt,
    });
    assert.isString((yield* projections.getThread(threadId)).sidechatExpiredAt);
  }).pipe(Effect.provide(layer)),
);

it.effect("releases a view and publishes its closure even if the activity write fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const threadId = ThreadId.make("failed-view-activity");
      yield* createSidechat(threadId);
      const viewScope = yield* Scope.make();
      yield* orchestrator
        .acquireSidechatView(threadId)
        .pipe(Effect.provideService(Scope.Scope, viewScope));
      yield* TestClock.adjust("30 minutes");
      const closure = yield* Stream.runHead(orchestrator.streamSidechatViewChanges).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      using failure = vi.spyOn(sink, "commitCommand").mockImplementationOnce(() =>
        Effect.fail(
          new EventSink.EventSinkWriteError({
            eventCount: 1,
            cause: "Transient test write failure",
          }),
        ),
      );
      yield* Scope.close(viewScope, Exit.void);
      assert.deepEqual(yield* orchestrator.getViewedSidechatIds, []);
      assert.deepEqual(yield* Fiber.join(closure), Option.some(threadId));
      assert.equal(failure.mock.calls.length, 1);
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect(
  "requires a side chat to start independently rather than importing a native conversation",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("sidechat-native-reuse");
      const result = yield* orchestrator
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make("sidechat-native-reuse-create"),
          threadId,
          projectId: ProjectId.make("sidechat-project"),
          title: "Side question",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
          sidechat: {
            kind: "thread",
            threadId: ThreadId.make("original-parent"),
            snapshotSequence: 1,
            capturedAt: "2026-10-25T12:00:00.000Z",
          },
          importedNativeThread: {
            ref: {
              driver: ProviderDriverKind.make("codex"),
              nativeId: "existing-native-conversation",
              strength: "strong",
            },
          },
        })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      assert.isNull(yield* orchestrator.getThreadShell(threadId));
    }).pipe(Effect.provide(layer)),
);

it.effect("expires an idle side chat durably only after the current inactivity window", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = ThreadId.make("idle-sidechat");
    const thread = yield* createSidechat(threadId);
    yield* orchestrator.dispatch({
      type: "thread.sidechat.expire",
      commandId: CommandId.make("expire-too-soon"),
      threadId,
      expectedLastActivityAt: thread.sidechatLastActivityAt!,
    });
    assert.isNull((yield* projections.getThread(threadId)).sidechatExpiredAt);
    yield* TestClock.adjust("1 hour");
    const result = yield* orchestrator.dispatch({
      type: "thread.sidechat.expire",
      commandId: CommandId.make("expire-idle"),
      threadId,
      expectedLastActivityAt: thread.sidechatLastActivityAt!,
    });
    const expired = yield* projections.getThread(threadId);
    assert.isString(expired.sidechatExpiredAt);
    assert.isNull(expired.deletedAt);
    assert.isNull(expired.archivedAt);
    assert.equal(result.storedEvents[0]?.event.type, "thread.metadata-updated");
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "records monotonic activity and rejects an expiry based on an older activity timestamp",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("active-sidechat");
      const thread = yield* createSidechat(threadId);
      yield* TestClock.adjust("30 minutes");
      const activityAt = DateTime.formatIso(yield* DateTime.now);
      yield* orchestrator.dispatch({
        type: "thread.sidechat.activity.record",
        commandId: CommandId.make("record-activity"),
        threadId,
        activityAt,
      });
      yield* orchestrator.dispatch({
        type: "thread.sidechat.activity.record",
        commandId: CommandId.make("old-activity"),
        threadId,
        activityAt: thread.sidechatLastActivityAt!,
      });
      assert.equal((yield* projections.getThread(threadId)).sidechatLastActivityAt, activityAt);
      yield* TestClock.adjust("1 hour");
      yield* orchestrator.dispatch({
        type: "thread.sidechat.expire",
        commandId: CommandId.make("expire-stale"),
        threadId,
        expectedLastActivityAt: thread.sidechatLastActivityAt!,
      });
      assert.isNull((yield* projections.getThread(threadId)).sidechatExpiredAt);
    }).pipe(Effect.provide(layer)),
);

it.effect("refcounts independent viewers and restarts inactivity when the final view closes", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = ThreadId.make("viewed-sidechat");
    const thread = yield* createSidechat(threadId);
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* orchestrator.acquireSidechatView(threadId);
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* orchestrator.acquireSidechatView(threadId);
            assert.deepEqual(yield* orchestrator.getViewedSidechatIds, [threadId]);
          }),
        );
        assert.deepEqual(yield* orchestrator.getViewedSidechatIds, [threadId]);
        yield* TestClock.adjust("2 hours");
        const current = yield* projections.getThread(threadId);
        yield* orchestrator.dispatch({
          type: "thread.sidechat.expire",
          commandId: CommandId.make("expire-viewed"),
          threadId,
          expectedLastActivityAt: current.sidechatLastActivityAt!,
        });
        assert.isNull((yield* projections.getThread(threadId)).sidechatExpiredAt);
      }),
    );
    assert.deepEqual(yield* orchestrator.getViewedSidechatIds, []);
    const closed = yield* projections.getThread(threadId);
    assert.notEqual(closed.sidechatLastActivityAt, thread.sidechatLastActivityAt);
    yield* TestClock.adjust("1 hour");
    yield* orchestrator.dispatch({
      type: "thread.sidechat.expire",
      commandId: CommandId.make("expire-after-view"),
      threadId,
      expectedLastActivityAt: closed.sidechatLastActivityAt!,
    });
    assert.isString((yield* projections.getThread(threadId)).sidechatExpiredAt);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "persists a side chat as its own ordinary thread and exposes its provenance in the shell",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const sourceId = ThreadId.make("sidechat-source");
      const threadId = ThreadId.make("sidechat-child");
      const base = {
        type: "thread.create" as const,
        projectId: ProjectId.make("sidechat-project"),
        title: "Parent",
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        createdBy: "user" as const,
        creationSource: "web" as const,
      };
      yield* orchestrator.dispatch({
        ...base,
        commandId: CommandId.make("sidechat-parent-create"),
        threadId: sourceId,
      });
      yield* orchestrator.dispatch({
        ...base,
        commandId: CommandId.make("sidechat-child-create"),
        threadId,
        title: "Side question",
        sidechat: {
          kind: "thread",
          threadId: sourceId,
          snapshotSequence: 1,
          capturedAt: "2026-10-25T12:00:00.000Z",
        },
      });
      const thread = yield* projections.getThread(threadId);
      assert.equal(thread.sidechatSourceThreadId, sourceId);
      assert.equal(thread.sidechatSnapshotSequence, 1);
      assert.equal(thread.sidechatCapturedAt, DateTime.formatIso(yield* DateTime.now));
      assert.isNull(thread.sidechatExpiredAt);
      assert.isNull(thread.sidechatContext);
      assert.isNull(thread.activeProviderThreadId);
      assert.deepEqual(thread.lineage, {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: threadId,
      });
      assert.isNull(thread.forkedFrom);
      const shell = yield* projections.getThreadShell(threadId);
      assert.equal(shell?.sidechatSourceThreadId, sourceId);
      assert.equal(shell?.sidechatCapturedAt, thread.sidechatCapturedAt);
      assert.equal(shell?.sidechatLastActivityAt, thread.sidechatLastActivityAt);
      assert.isUndefined((yield* projections.getThread(sourceId)).sidechatSourceThreadId);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "rejects execution on an expired side chat while keeping its readable thread record",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("expired-sidechat");
      yield* createSidechat(threadId);
      const thread = yield* projections.getThread(threadId);
      const now = yield* DateTime.now;
      yield* sink.write({
        events: [
          {
            id: EventId.make("expired-sidechat-event"),
            type: "thread.metadata-updated",
            threadId,
            occurredAt: now,
            payload: { ...thread, sidechatExpiredAt: DateTime.formatIso(now) },
          },
        ],
        commandId: CommandId.make("expired-sidechat-mark"),
      });
      const result = yield* orchestrator
        .dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("expired-sidechat-send"),
          threadId,
          messageId: MessageId.make("expired-sidechat-message"),
          text: "Continue",
          attachments: [],
          modelSelection,
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      const retained = yield* orchestrator.getThreadProjection(threadId);
      assert.isNull(retained.thread.deletedAt);
      assert.equal(retained.thread.sidechatSourceThreadId, ThreadId.make("original-parent"));
      assert.lengthOf(retained.messages, 0);
    }).pipe(Effect.provide(layer)),
);

it.effect.each(["ordinary", "expired", "deleted"] as const)(
  "refuses a view lease for a $0 thread instead of acknowledging an unregistered view",
  (state) =>
    Effect.gen(function* () {
      const engine = yield* Orchestrator.OrchestratorV2;
      const child = ThreadId.make(`refused-view:${state}`);
      const thread = yield* createSidechat(child);
      const target = state === "ordinary" ? ThreadId.make("original-parent") : child;
      if (state === "expired") {
        yield* TestClock.adjust("1 hour");
        yield* engine.dispatch({
          type: "thread.sidechat.expire",
          commandId: CommandId.make("refused-view-expire"),
          threadId: child,
          expectedLastActivityAt: thread.sidechatLastActivityAt!,
        });
      } else if (state === "deleted") {
        yield* engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("refused-view-delete"),
          threadId: child,
        });
      }
      const result = yield* engine.acquireSidechatView(target).pipe(Effect.scoped, Effect.result);
      assert.isTrue(Result.isFailure(result));
      assert.deepEqual(yield* engine.getViewedSidechatIds, []);
    }).pipe(Effect.provide(layer)),
);
