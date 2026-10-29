// Adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import {
  CommandId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type SidechatExpiry,
} from "@t3tools/contracts";
import {
  SIDECHAT_INACTIVITY_EXPIRY_MS,
  SIDECHAT_VISIBLE_ACTIVITY_HEARTBEAT_MS,
  createSidechatExpiryTimer,
  sidechatExpiryMs,
  type SidechatExpiryTimerClock,
} from "@t3tools/shared/sidechatExpiry";
import { isSidechatThread } from "@t3tools/shared/sidechatThread";
import { turnItemUpdateCanEndBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import type * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const EXPIRY_RETRY_DELAY_MS = 5_000;
const ACTIVE_RUN_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);

export interface SidechatExpiryReactorRuntime<
  TimerHandle,
> extends SidechatExpiryTimerClock<TimerHandle> {
  readonly runFork: (
    effect: Effect.Effect<void>,
    context: Context.Context<never>,
    scope: Scope.Scope,
  ) => void;
}

export class SidechatExpiryReactor extends Context.Service<
  SidechatExpiryReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration-v2/SidechatExpiryReactor") {}

const serverCommandId = Effect.fn("SidechatExpiryReactor.commandId")(function* (tag: string) {
  return CommandId.make(`server:${tag}:${yield* randomUuidV4}`);
});

function effectiveActivityAtMs(shell: OrchestrationV2ThreadShell): number {
  const updatedAtMs = DateTime.toEpochMillis(shell.updatedAt);
  const sidechatActivityAtMs = shell.sidechatLastActivityAt
    ? Date.parse(shell.sidechatLastActivityAt)
    : Number.NaN;
  return Number.isFinite(sidechatActivityAtMs)
    ? Math.max(updatedAtMs, sidechatActivityAtMs)
    : updatedAtMs;
}

function isBusyFromShell(shell: OrchestrationV2ThreadShell): boolean {
  return (
    ACTIVE_RUN_STATUSES.has(shell.status) ||
    shell.status === "queued" ||
    shell.activeRunId != null ||
    shell.activityRunStatus != null ||
    shell.pendingRuntimeRequest != null ||
    (shell.pendingBackgroundTasks?.length ?? 0) > 0
  );
}

function mayAffectExpiry(event: OrchestrationV2DomainEvent): boolean {
  switch (event.type) {
    case "turn-item.updated":
      return turnItemUpdateCanEndBackgroundWork(event.payload);
    case "thread.created":
    case "thread.archived":
    case "thread.unarchived":
    case "thread.deleted":
    case "thread.settled":
    case "thread.unsettled":
    case "thread.snoozed":
    case "thread.unsnoozed":
    case "thread.pinned":
    case "thread.auto-settle-set":
    case "thread.unpinned":
    case "thread.pin-reordered":
    case "thread.active-reordered":
    case "thread.visited":
    case "thread.marked-unread":
    case "thread.metadata-updated":
    case "thread.runtime-mode-updated":
    case "thread.interaction-mode-updated":
    case "thread.model-selection-updated":
    case "thread.provider-switched":
    case "run.created":
    case "run.updated":
    case "run.background-work-cancelled":
    case "runtime-request.updated":
    case "provider-session.attached":
    case "provider-session.updated":
    case "provider-session.detached":
    case "provider-thread.updated":
    case "subagent.updated":
      return true;
    default:
      return false;
  }
}

export const make = Effect.fn("SidechatExpiryReactor.make")(function* <TimerHandle>(
  runtime: SidechatExpiryReactorRuntime<TimerHandle>,
) {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const started = yield* Ref.make(false);
  const stateLock = yield* Semaphore.make(1);
  const sidechatIds = new Set<ThreadId>();
  const viewedIds = new Set<ThreadId>();
  const expiringIds = new Set<ThreadId>();
  let expiryMs: number | null = SIDECHAT_INACTIVITY_EXPIRY_MS;
  let forkExpiry: ((effect: Effect.Effect<void>) => void) | undefined;
  let timer: ReturnType<typeof createSidechatExpiryTimer<TimerHandle>>;

  const recordActivity = Effect.fn("SidechatExpiryReactor.recordActivity")(function* (
    threadId: ThreadId,
    activityAtMs: number,
  ) {
    yield* engine
      .dispatch({
        type: "thread.sidechat.activity.record",
        commandId: yield* serverCommandId("sidechat-activity"),
        threadId,
        activityAt: DateTime.formatIso(DateTime.makeUnsafe(activityAtMs)),
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("failed to persist side chat activity", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      );
  });

  const setPolicy = (setting: SidechatExpiry) => {
    expiryMs = sidechatExpiryMs(setting);
    timer.setPolicy(setting);
  };

  const isProtected = Effect.fn("SidechatExpiryReactor.isProtected")(function* (
    shell: OrchestrationV2ThreadShell,
  ) {
    if (isBusyFromShell(shell)) return true;

    // The shell omits held queue entries when it selects the latest unheld run.
    const { runs } = yield* projections.getThreadRecords(shell.id, ["runs"]);
    return runs.some((run) => run.status === "queued" || ACTIVE_RUN_STATUSES.has(run.status));
  });

  const restoreShell = Effect.fn("SidechatExpiryReactor.restoreShell")(function* (
    shell: OrchestrationV2ThreadShell,
  ) {
    const threadId = shell.id;
    if (!isSidechatThread(shell)) {
      timer.remove(threadId);
      sidechatIds.delete(threadId);
      return;
    }
    sidechatIds.add(threadId);
    if (shell.archivedAt !== null || shell.deletedAt !== null) {
      timer.remove(threadId);
      return;
    }
    if (shell.sidechatExpiredAt != null) {
      timer.markExpired(threadId);
      return;
    }

    const wasViewed = timer.getViewedThreadIds().includes(threadId);
    timer.restore({
      threadId,
      lastActivityAtMs: effectiveActivityAtMs(shell),
      running: yield* isProtected(shell),
      expired: false,
    });
    if (viewedIds.has(threadId) && !wasViewed) timer.beginView(threadId, runtime.now());
  });

  const refreshThread = Effect.fn("SidechatExpiryReactor.refreshThread")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* engine.getThreadShell(threadId);
    if (shell === null) {
      timer.remove(threadId);
      return;
    }
    yield* restoreShell(shell);
  });

  const synchronizeViews = Effect.fn("SidechatExpiryReactor.synchronizeViews")(function* (
    changedThreadId?: ThreadId,
  ) {
    const nextViewedIds = new Set(yield* engine.getViewedSidechatIds);
    const activityAtMs = runtime.now();
    const toPersist = new Set<ThreadId>();

    for (const threadId of nextViewedIds) {
      if (viewedIds.has(threadId)) continue;
      if (timer.beginView(threadId, activityAtMs)) {
        toPersist.add(threadId);
        continue;
      }
      const shell = yield* engine.getThreadShell(threadId);
      if (shell === null || !isSidechatThread(shell)) continue;
      yield* restoreShell(shell);
      if (timer.beginView(threadId, activityAtMs)) toPersist.add(threadId);
    }

    for (const threadId of viewedIds) {
      if (!nextViewedIds.has(threadId) && timer.endView(threadId, activityAtMs)) {
        toPersist.add(threadId);
      }
    }

    if (changedThreadId !== undefined && !toPersist.has(changedThreadId)) {
      let tracked = timer.recordActivity(changedThreadId, activityAtMs);
      if (!tracked) {
        const shell = yield* engine.getThreadShell(changedThreadId);
        if (shell !== null && isSidechatThread(shell)) {
          yield* restoreShell(shell);
          tracked = timer.recordActivity(changedThreadId, activityAtMs);
        }
      }
      if (tracked) toPersist.add(changedThreadId);
    }

    viewedIds.clear();
    for (const threadId of nextViewedIds) viewedIds.add(threadId);
    for (const threadId of toPersist) yield* recordActivity(threadId, activityAtMs);
  });

  const refreshAfterExpiry = Effect.fn("SidechatExpiryReactor.refreshAfterExpiry")(function* (
    threadId: ThreadId,
    expectedLastActivityAtMs: number,
  ) {
    const recover = Effect.gen(function* () {
      yield* synchronizeViews();
      const shell = yield* engine.getThreadShell(threadId);
      if (
        shell === null ||
        !isSidechatThread(shell) ||
        shell.deletedAt !== null ||
        shell.archivedAt !== null
      ) {
        timer.remove(threadId);
        return;
      }
      if (shell.sidechatExpiredAt != null) {
        timer.markExpired(threadId);
        return;
      }

      const persistedActivityAtMs = effectiveActivityAtMs(shell);
      const activityAtMs = Math.max(persistedActivityAtMs, expectedLastActivityAtMs);
      if (persistedActivityAtMs < expectedLastActivityAtMs) {
        yield* recordActivity(threadId, expectedLastActivityAtMs);
      }

      const running = yield* isProtected(shell);
      timer.recordActivity(threadId, activityAtMs);
      timer.setRunning(threadId, running, activityAtMs);

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to refresh side chat expiry policy", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(null)),
        ),
      );
      if (settings !== null) setPolicy(settings.sidechatExpiry);

      if (
        viewedIds.has(threadId) ||
        running ||
        expiryMs === null ||
        activityAtMs + expiryMs > runtime.now()
      ) {
        return;
      }
      timer.retryExpiry(threadId, EXPIRY_RETRY_DELAY_MS);
    });

    yield* recover.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("failed to refresh side chat after expiry attempt", {
              threadId,
              cause: Cause.pretty(cause),
            }).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (!viewedIds.has(threadId)) timer.retryExpiry(threadId, EXPIRY_RETRY_DELAY_MS);
                }),
              ),
            ),
      ),
    );
  });

  const expireSidechat = Effect.fn("SidechatExpiryReactor.expireSidechat")(function* (
    threadIdValue: string,
    expectedLastActivityAtMs: number,
  ) {
    const threadId = ThreadId.make(threadIdValue);
    const result = yield* engine
      .dispatch({
        type: "thread.sidechat.expire",
        commandId: yield* serverCommandId("sidechat-expire"),
        threadId,
        expectedLastActivityAt: DateTime.formatIso(DateTime.makeUnsafe(expectedLastActivityAtMs)),
      })
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("failed to expire inactive side chat", {
                threadId,
                cause: Cause.pretty(cause),
              }).pipe(
                Effect.andThen(refreshAfterExpiry(threadId, expectedLastActivityAtMs)),
                Effect.as(null),
              ),
        ),
      );

    if (result === null) return;
    if (result.storedEvents.length > 0) {
      timer.markExpired(threadId);
      return;
    }
    yield* refreshAfterExpiry(threadId, expectedLastActivityAtMs);
  });

  const handleEvent = Effect.fn("SidechatExpiryReactor.handleEvent")(function* (
    event: OrchestrationV2DomainEvent,
  ) {
    if (event.type === "thread.deleted") {
      sidechatIds.delete(event.threadId);
      viewedIds.delete(event.threadId);
      timer.remove(event.threadId);
      return;
    }
    if (event.type === "thread.archived") {
      timer.remove(event.threadId);
      return;
    }
    if (event.type === "thread.created" && isSidechatThread(event.payload)) {
      sidechatIds.add(event.threadId);
    }
    if (
      event.type === "thread.metadata-updated" &&
      isSidechatThread(event.payload) &&
      event.payload.sidechatExpiredAt != null
    ) {
      sidechatIds.add(event.threadId);
      timer.markExpired(event.threadId);
      return;
    }
    if (!mayAffectExpiry(event)) return;

    if (!sidechatIds.has(event.threadId)) {
      if (event.type !== "thread.created") return;
      if (!isSidechatThread(event.payload)) return;
    }
    yield* synchronizeViews();
    yield* refreshThread(event.threadId);
  });

  timer = createSidechatExpiryTimer<TimerHandle>({
    now: runtime.now,
    schedule: runtime.schedule,
    cancel: runtime.cancel,
    onExpire: (threadId, expectedLastActivityAtMs) => {
      const id = ThreadId.make(threadId);
      if (expiringIds.has(id)) return;
      expiringIds.add(id);
      const work = expireSidechat(threadId, expectedLastActivityAtMs).pipe(
        stateLock.withPermit,
        Effect.ensuring(Effect.sync(() => expiringIds.delete(id))),
      );
      forkExpiry?.(work);
    },
  });

  const persistVisibleActivity = Effect.fn("SidechatExpiryReactor.persistVisibleActivity")(
    function* () {
      const activityAtMs = runtime.now();
      for (const threadId of timer.getViewedThreadIds()) {
        if (timer.recordActivity(threadId, activityAtMs)) {
          yield* recordActivity(ThreadId.make(threadId), activityAtMs);
        }
      }
    },
  );

  const recovery = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]);
  const start = Effect.fn("SidechatExpiryReactor.start")(function* () {
    if (yield* Ref.getAndSet(started, true)) return;
    const context = yield* Effect.context<never>();
    const scope = yield* Effect.scope;
    forkExpiry = (effect) => runtime.runFork(effect, context, scope);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        forkExpiry = undefined;
        timer.dispose();
      }),
    );
    const ready = yield* Deferred.make<void>();
    const settingsChanges = yield* serverSettings.subscribeChanges;
    yield* Stream.runForEach(settingsChanges, (settings) =>
      stateLock.withPermit(Effect.sync(() => setPolicy(settings.sidechatExpiry))),
    ).pipe(Effect.forkScoped);
    yield* Stream.runForEach(engine.streamSidechatViewChanges, (threadId) =>
      synchronizeViews(threadId).pipe(stateLock.withPermit, Effect.retry(recovery)),
    ).pipe(Effect.forkScoped);

    const restoreAndFollow = Effect.gen(function* () {
      const snapshot = yield* stateLock.withPermit(
        Effect.gen(function* () {
          const settings = yield* serverSettings.getSettings;
          setPolicy(settings.sidechatExpiry);
          const snapshot = yield* engine.getShellSnapshot();
          for (const shell of [...snapshot.threads, ...snapshot.archivedThreads]) {
            if (isSidechatThread(shell)) yield* restoreShell(shell);
          }
          yield* synchronizeViews();
          return snapshot;
        }),
      );
      const events = engine.streamStoredEventsFrom({ afterSequence: snapshot.snapshotSequence });
      yield* Deferred.succeed(ready, undefined);
      // Replaying from this snapshot's cursor closes the bootstrap gap; a failed
      // read restarts with a fresh snapshot rather than losing old side chats.
      yield* Stream.runForEach(events, (stored) => stateLock.withPermit(handleEvent(stored.event)));
    });
    yield* restoreAndFollow.pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Side-chat expiry will recover from a fresh snapshot", { cause }),
      ),
      Effect.retry(recovery),
      Effect.orDie,
      Effect.forkScoped,
    );
    yield* Deferred.await(ready);
    yield* Effect.forever(
      Effect.sleep(Duration.millis(SIDECHAT_VISIBLE_ACTIVITY_HEARTBEAT_MS)).pipe(
        Effect.andThen(stateLock.withPermit(persistVisibleActivity())),
      ),
    ).pipe(Effect.forkScoped);
  });

  return { start } satisfies SidechatExpiryReactor["Service"];
});

export const layer = Layer.effect(
  SidechatExpiryReactor,
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const scope = yield* Effect.scope;
    const clock = yield* Clock.Clock;
    return yield* make<Fiber.Fiber<void>>({
      now: () => clock.currentTimeMillisUnsafe(),
      schedule: (callback, delayMs) =>
        Effect.runSyncWith(context)(
          Effect.forkIn(
            clock.sleep(Duration.millis(delayMs)).pipe(Effect.andThen(Effect.sync(callback))),
            scope,
            { startImmediately: true },
          ),
        ),
      // The pure timer requires synchronous cancellation before it can re-arm.
      cancel: (fiber) => fiber.interruptUnsafe(),
      runFork: (effect, services, lifetime) => {
        Effect.runSyncWith(services)(Effect.forkIn(effect, lifetime, { startImmediately: true }));
      },
    });
  }),
);
