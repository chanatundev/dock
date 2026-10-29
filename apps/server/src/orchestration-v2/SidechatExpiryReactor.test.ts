import {
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadShellSnapshot,
  type ServerSettings as ContractServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";

import * as ProjectionStore from "./ProjectionStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as SidechatExpiryReactor from "./SidechatExpiryReactor.ts";
import * as ServerSettings from "../serverSettings.ts";

const BASE_MS = Date.parse("2026-10-20T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;
const RETRY_MS = 5_000;

type ExpiryOutcome = "fail" | "noop" | "expire";

interface ManualClock {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => number;
  readonly cancel: (handle: number) => void;
  readonly advanceTo: (atMs: number) => void;
  readonly waitForScheduleAt: (atMs: number) => Promise<void>;
  readonly waitForCancelAt: (atMs: number) => Promise<void>;
  readonly activeTimerCount: () => number;
}

function makeManualClock(startAtMs: number): ManualClock {
  let nowMs = startAtMs;
  let nextTimerId = 1;
  const timers = new Map<number, { readonly callback: () => void; readonly dueAtMs: number }>();
  const scheduledAt: Array<number> = [];
  const cancelledAt: Array<number> = [];
  const scheduleWaiters = new Map<number, Array<() => void>>();
  const cancelWaiters = new Map<number, Array<() => void>>();

  const signal = (waiters: Map<number, Array<() => void>>, atMs: number) => {
    for (const resolve of waiters.get(atMs) ?? []) resolve();
    waiters.delete(atMs);
  };

  const waitFor = (
    history: ReadonlyArray<number>,
    waiters: Map<number, Array<() => void>>,
    atMs: number,
  ) =>
    history.includes(atMs)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const pending = waiters.get(atMs) ?? [];
          pending.push(resolve);
          waiters.set(atMs, pending);
        });

  return {
    now: () => nowMs,
    schedule: (callback, delayMs) => {
      const timerId = nextTimerId++;
      const dueAtMs = nowMs + delayMs;
      timers.set(timerId, { callback, dueAtMs });
      scheduledAt.push(dueAtMs);
      signal(scheduleWaiters, dueAtMs);
      return timerId;
    },
    cancel: (timerId) => {
      const timer = timers.get(timerId);
      if (timer === undefined) return;
      timers.delete(timerId);
      cancelledAt.push(timer.dueAtMs);
      signal(cancelWaiters, timer.dueAtMs);
    },
    advanceTo: (targetMs) => {
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.dueAtMs <= targetMs)
          .toSorted((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
        if (next === undefined) break;
        nowMs = next[1].dueAtMs;
        timers.delete(next[0]);
        next[1].callback();
      }
      nowMs = targetMs;
    },
    waitForScheduleAt: (atMs) => waitFor(scheduledAt, scheduleWaiters, atMs),
    waitForCancelAt: (atMs) => waitFor(cancelledAt, cancelWaiters, atMs),
    activeTimerCount: () => timers.size,
  };
}

function makeSidechatShell(
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  const timestamp = DateTime.formatIso(DateTime.makeUnsafe(BASE_MS));
  return {
    id: ThreadId.make(id),
    createdBy: "user",
    creationSource: "web",
    projectId: ProjectId.make("sidechat-expiry-test"),
    title: id,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: {
      relationshipToParent: null,
      parentThreadId: null,
      rootThreadId: ThreadId.make(id),
    },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    activeRunId: null,
    activityRunStatus: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: DateTime.makeUnsafe(timestamp),
    updatedAt: DateTime.makeUnsafe(timestamp),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    sidechatSourceThreadId: ThreadId.make("source-thread"),
    sidechatLastActivityAt: timestamp,
    sidechatExpiredAt: null,
    ...overrides,
  };
}

function makeShellSnapshot(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  snapshotSequence = 7,
): OrchestrationV2ThreadShellSnapshot {
  return {
    schemaVersion: 1,
    snapshotSequence,
    threads,
    archivedThreads: [],
  };
}

function storedEvent(sequence: number, event: Record<string, unknown>): OrchestrationV2StoredEvent {
  return { sequence, event } as unknown as OrchestrationV2StoredEvent;
}

interface HarnessOptions {
  readonly snapshotFailures?: number;
  readonly nowMs?: number;
  readonly shells?: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly runs?: Readonly<Record<string, ReadonlyArray<{ readonly status: string }>>>;
  readonly expiry?: "1h" | "24h" | "never";
  readonly expiryOutcomes?: ReadonlyArray<ExpiryOutcome>;
  readonly snapshotSequence?: number;
}

interface Harness {
  readonly dependencies: Layer.Layer<
    | Orchestrator.OrchestratorV2
    | ProjectionStore.ProjectionStoreV2
    | ServerSettings.ServerSettingsService
  >;
  readonly reactor: SidechatExpiryReactor.SidechatExpiryReactor["Service"];
  readonly settings: ServerSettings.ServerSettingsService["Service"];
  readonly clock: ManualClock;
  readonly shellSnapshot: Ref.Ref<OrchestrationV2ThreadShellSnapshot>;
  readonly viewedSidechatIds: Ref.Ref<ReadonlyArray<ThreadId>>;
  readonly viewChanges: Queue.Queue<ThreadId>;
  readonly domainEvents: Queue.Queue<OrchestrationV2StoredEvent>;
  readonly eventsRead: Queue.Queue<OrchestrationV2StoredEvent>;
  readonly snapshotReadAttempts: Queue.Queue<number>;
  readonly commands: Queue.Queue<OrchestrationV2ServerCommand>;
  readonly forkCompletions: Queue.Queue<void>;
  readonly streamCursors: Array<number | undefined>;
  readonly recordReads: Array<ReadonlyArray<string>>;
  readonly getShellSnapshotCalls: () => number;
  readonly expiryCalls: () => number;
}

function makeHarness(options: HarnessOptions = {}): Effect.Effect<Harness, never, Scope.Scope> {
  return Effect.gen(function* () {
    const clock = makeManualClock(options.nowMs ?? BASE_MS);
    const shellSnapshot = yield* Ref.make(
      makeShellSnapshot(options.shells ?? [], options.snapshotSequence ?? 7),
    );
    const viewedSidechatIds = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
    const viewChanges = yield* Queue.unbounded<ThreadId>();
    const domainEvents = yield* Queue.unbounded<OrchestrationV2StoredEvent>();
    const eventsRead = yield* Queue.unbounded<OrchestrationV2StoredEvent>();
    const snapshotReadAttempts = yield* Queue.unbounded<number>();
    const commands = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
    const forkCompletions = yield* Queue.unbounded<void>();
    const expiryJobs = yield* Queue.unbounded<Effect.Effect<void>>();
    yield* Stream.runForEach(Stream.fromQueue(expiryJobs), (job) =>
      job.pipe(Effect.ensuring(Queue.offer(forkCompletions, undefined))),
    ).pipe(Effect.forkScoped);
    const settingsChanges = yield* Queue.unbounded<ContractServerSettings>();
    const settingsState = yield* Ref.make<ContractServerSettings>({
      sidechatExpiry: options.expiry ?? "1h",
    } as ContractServerSettings);
    const runs = new Map(Object.entries(options.runs ?? {}));
    const streamCursors: Array<number | undefined> = [];
    const recordReads: Array<ReadonlyArray<string>> = [];
    let shellSnapshotCalls = 0;
    let expiryCalls = 0;

    const getShell = (threadId: ThreadId) =>
      Ref.get(shellSnapshot).pipe(
        Effect.map(
          (snapshot) =>
            [...snapshot.threads, ...snapshot.archivedThreads].find(
              (shell) => shell.id === threadId,
            ) ?? null,
        ),
      );

    const orchestrator = {
      dispatch: (command: OrchestrationV2ServerCommand) => {
        if (command.type !== "thread.sidechat.expire") {
          return Queue.offer(commands, command).pipe(Effect.as({ sequence: 8, storedEvents: [] }));
        }
        expiryCalls += 1;
        const outcome = options.expiryOutcomes?.[expiryCalls - 1] ?? "expire";
        const storedEvents = outcome === "expire" ? [storedEvent(8, {})] : [];
        return Queue.offer(commands, command).pipe(
          Effect.andThen(
            outcome === "fail"
              ? Effect.fail(
                  new Orchestrator.OrchestratorProjectionError({
                    threadId: command.threadId,
                    cause: "temporary expiry failure",
                  }),
                )
              : Effect.succeed({ sequence: 8, storedEvents }),
          ),
        );
      },
      getShellSnapshot: () =>
        Effect.gen(function* () {
          shellSnapshotCalls += 1;
          yield* Queue.offer(snapshotReadAttempts, shellSnapshotCalls);
          if (shellSnapshotCalls <= (options.snapshotFailures ?? 0))
            return yield* new Orchestrator.OrchestratorProjectionError({
              threadId: ThreadId.make("shell"),
              cause: "Temporary snapshot read failure",
            });
          return yield* Ref.get(shellSnapshot);
        }),
      getThreadShell: getShell,
      getViewedSidechatIds: Ref.get(viewedSidechatIds),
      streamSidechatViewChanges: Stream.fromQueue(viewChanges),
      streamStoredEventsFrom: (input?: { readonly afterSequence?: number }) => {
        streamCursors.push(input?.afterSequence);
        return Stream.fromQueue(domainEvents).pipe(
          Stream.rechunk(1),
          Stream.tap((event) => Queue.offer(eventsRead, event)),
        );
      },
    } as unknown as Orchestrator.OrchestratorV2["Service"];

    const projectionStore = {
      getThreadRecords: (threadId: ThreadId, fields: ReadonlyArray<string>) => {
        recordReads.push(fields);
        return getShell(threadId).pipe(
          Effect.map((thread) => ({ thread, runs: runs.get(threadId) ?? [] })),
        );
      },
    } as unknown as ProjectionStore.ProjectionStoreV2["Service"];

    const serverSettings = {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Ref.get(settingsState),
      updateSettings: (patch: ServerSettingsPatch) =>
        Effect.gen(function* () {
          const next = { ...(yield* Ref.get(settingsState)), ...patch } as ContractServerSettings;
          yield* Ref.set(settingsState, next);
          yield* Queue.offer(settingsChanges, next);
          return next;
        }),
      updateProviderInstance: () => Effect.die("unused test setting mutation"),
      withSettingsSnapshot: (use: (settings: ContractServerSettings) => Effect.Effect<unknown>) =>
        Ref.get(settingsState).pipe(Effect.flatMap(use)),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.succeed(Stream.fromQueue(settingsChanges)),
    } as unknown as ServerSettings.ServerSettingsService["Service"];

    const dependencies = Layer.mergeAll(
      Layer.succeed(Orchestrator.OrchestratorV2, orchestrator),
      Layer.succeed(ProjectionStore.ProjectionStoreV2, projectionStore),
      Layer.succeed(ServerSettings.ServerSettingsService, serverSettings),
    );

    return yield* Effect.gen(function* () {
      const reactor = yield* SidechatExpiryReactor.make({
        now: clock.now,
        schedule: clock.schedule,
        cancel: clock.cancel,
        runFork: (effect) => {
          Queue.offerUnsafe(expiryJobs, effect);
        },
      });
      return {
        dependencies,
        reactor,
        settings: serverSettings,
        clock,
        shellSnapshot,
        viewedSidechatIds,
        viewChanges,
        domainEvents,
        eventsRead,
        snapshotReadAttempts,
        commands,
        forkCompletions,
        streamCursors,
        recordReads,
        getShellSnapshotCalls: () => shellSnapshotCalls,
        expiryCalls: () => expiryCalls,
      } satisfies Harness;
    }).pipe(Effect.provide(dependencies));
  });
}

function awaitAt(promise: Promise<void>): Effect.Effect<void> {
  return Effect.promise(() => promise);
}

function waitForExpiryCommand(harness: Harness) {
  return Queue.take(harness.commands).pipe(
    Effect.tap((command) =>
      Effect.sync(() => assert.equal(command.type, "thread.sidechat.expire")),
    ),
  );
}

function waitForActivityCommand(harness: Harness) {
  return Queue.take(harness.commands).pipe(
    Effect.tap((command) =>
      Effect.sync(() => assert.equal(command.type, "thread.sidechat.activity.record")),
    ),
  );
}

describe("SidechatExpiryReactor", () => {
  it.effect("runs the production timer bridge on the scoped Effect clock", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(BASE_MS);
        const harness = yield* makeHarness({ shells: [makeSidechatShell("production-clock")] });
        const services = yield* Layer.build(
          SidechatExpiryReactor.layer.pipe(Layer.provide(harness.dependencies)),
        );
        const reactor = Context.get(services, SidechatExpiryReactor.SidechatExpiryReactor);
        yield* reactor.start();
        yield* TestClock.adjust("1 hour");
        const command = yield* waitForExpiryCommand(harness);
        assert.equal(command.type, "thread.sidechat.expire");
        if (command.type === "thread.sidechat.expire")
          assert.equal(command.threadId, ThreadId.make("production-clock"));
      }),
    ),
  );
  it.effect("restores idle sidechats after restart using the newer shell update time", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const latestUpdateAt = BASE_MS + 90 * 60 * 1_000;
        const harness = yield* makeHarness({
          nowMs: BASE_MS + 2 * HOUR_MS,
          shells: [
            makeSidechatShell("sidechat-restart", {
              sidechatLastActivityAt: DateTime.formatIso(DateTime.makeUnsafe(BASE_MS)),
              updatedAt: DateTime.makeUnsafe(latestUpdateAt),
            }),
          ],
        });

        yield* harness.reactor.start();
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + 150 * 60 * 1_000));
        assert.deepEqual(harness.streamCursors, [7]);

        harness.clock.advanceTo(BASE_MS + 150 * 60 * 1_000 - 1);
        assert.equal(harness.expiryCalls(), 0);
        harness.clock.advanceTo(BASE_MS + 150 * 60 * 1_000);
        const command = yield* waitForExpiryCommand(harness);
        yield* Queue.take(harness.forkCompletions);

        assert.equal(command.type, "thread.sidechat.expire");
        if (command.type === "thread.sidechat.expire") {
          assert.equal(
            command.expectedLastActivityAt,
            DateTime.formatIso(DateTime.makeUnsafe(latestUpdateAt)),
          );
        }
        assert.equal(harness.getShellSnapshotCalls(), 1);
      }),
    ),
  );

  it.effect("recovers startup state after a transient snapshot read failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          snapshotFailures: 1,
          shells: [makeSidechatShell("startup-recovery")],
        });
        const starting = yield* harness.reactor.start().pipe(Effect.forkScoped);
        assert.equal(yield* Queue.take(harness.snapshotReadAttempts), 1);
        assert.isUndefined(starting.pollUnsafe());
        yield* TestClock.adjust("1 second");
        assert.equal(yield* Queue.take(harness.snapshotReadAttempts), 2);
        yield* Fiber.join(starting);
        assert.equal(harness.clock.activeTimerCount(), 1);
      }),
    ),
  );

  it.effect("starts once and restores the startup snapshot once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({ shells: [makeSidechatShell("sidechat-once")] });
        yield* harness.reactor.start();
        yield* harness.reactor.start();

        assert.equal(harness.getShellSnapshotCalls(), 1);
        assert.deepEqual(harness.streamCursors, [7]);
        assert.equal(harness.clock.activeTimerCount(), 1);
      }),
    ),
  );

  it.effect("applies 24 hour and never setting changes to restored timers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          nowMs: BASE_MS + 30 * 60 * 1_000,
          shells: [makeSidechatShell("sidechat-policy")],
        });
        yield* harness.reactor.start();
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + HOUR_MS));

        yield* harness.settings.updateSettings({ sidechatExpiry: "24h" });
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + 24 * HOUR_MS));
        harness.clock.advanceTo(BASE_MS + 2 * HOUR_MS);
        assert.equal(harness.expiryCalls(), 0);

        yield* harness.settings.updateSettings({ sidechatExpiry: "never" });
        yield* awaitAt(harness.clock.waitForCancelAt(BASE_MS + 24 * HOUR_MS));
        harness.clock.advanceTo(BASE_MS + 25 * HOUR_MS);
        assert.equal(harness.expiryCalls(), 0);
        assert.equal(harness.clock.activeTimerCount(), 0);
      }),
    ),
  );

  it.effect("pauses across multiple views and persists visible activity every five minutes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const id = ThreadId.make("sidechat-view");
        const harness = yield* makeHarness({
          shells: [makeSidechatShell("sidechat-view")],
        });
        yield* harness.reactor.start();
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + HOUR_MS));

        harness.clock.advanceTo(BASE_MS + 10 * 60 * 1_000);
        yield* Ref.set(harness.viewedSidechatIds, [id]);
        yield* Queue.offer(harness.viewChanges, id);
        const firstView = yield* waitForActivityCommand(harness);
        if (firstView.type === "thread.sidechat.activity.record") {
          assert.equal(
            firstView.activityAt,
            DateTime.formatIso(DateTime.makeUnsafe(BASE_MS + 10 * 60 * 1_000)),
          );
        }

        harness.clock.advanceTo(BASE_MS + 15 * 60 * 1_000);
        yield* TestClock.adjust(Duration.millis(5 * 60 * 1_000));
        const heartbeat = yield* waitForActivityCommand(harness);
        if (heartbeat.type === "thread.sidechat.activity.record") {
          assert.equal(
            heartbeat.activityAt,
            DateTime.formatIso(DateTime.makeUnsafe(BASE_MS + 15 * 60 * 1_000)),
          );
        }

        harness.clock.advanceTo(BASE_MS + 2 * HOUR_MS);
        yield* Queue.offer(harness.viewChanges, id);
        yield* waitForActivityCommand(harness);
        harness.clock.advanceTo(BASE_MS + 3 * HOUR_MS);
        assert.equal(harness.expiryCalls(), 0);

        // One release leaves a view active; only the final release resumes expiry.
        yield* Queue.offer(harness.viewChanges, id);
        yield* waitForActivityCommand(harness);
        yield* Ref.set(harness.viewedSidechatIds, []);
        yield* Queue.offer(harness.viewChanges, id);
        yield* waitForActivityCommand(harness);
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + 4 * HOUR_MS));

        harness.clock.advanceTo(BASE_MS + 4 * HOUR_MS - 1);
        assert.equal(harness.expiryCalls(), 0);
        harness.clock.advanceTo(BASE_MS + 4 * HOUR_MS);
        yield* waitForExpiryCommand(harness);
        yield* Queue.take(harness.forkCompletions);
      }),
    ),
  );

  it.effect("pauses for held queued runs, pending interaction, and background work", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          nowMs: BASE_MS + 2 * HOUR_MS,
          shells: [
            makeSidechatShell("sidechat-held"),
            makeSidechatShell("sidechat-pending", {
              pendingRuntimeRequest: {
                id: "request:pending",
                kind: "user_input",
                createdAt: DateTime.formatIso(DateTime.makeUnsafe(BASE_MS)),
              } as never,
            }),
            makeSidechatShell("sidechat-background", {
              pendingBackgroundTasks: [{ taskId: "build", description: "Build" }] as never,
            }),
          ],
          runs: { "sidechat-held": [{ status: "queued" }] },
        });
        yield* harness.reactor.start();
        harness.clock.advanceTo(BASE_MS + 4 * HOUR_MS);

        assert.equal(harness.expiryCalls(), 0);
        assert.deepEqual(harness.recordReads, [["runs"]]);
      }),
    ),
  );

  it.effect("resets idle expiry from terminal run activity", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("sidechat-terminal");
        const harness = yield* makeHarness({
          nowMs: BASE_MS + 90 * 60 * 1_000,
          shells: [
            makeSidechatShell("sidechat-terminal", {
              status: "running",
              activeRunId: RunId.make("run:sidechat-terminal"),
              activityRunStatus: "running",
            }),
          ],
        });
        yield* harness.reactor.start();

        const completedAt = BASE_MS + 2 * HOUR_MS;
        harness.clock.advanceTo(completedAt);
        yield* Ref.update(harness.shellSnapshot, (snapshot) => ({
          ...snapshot,
          threads: snapshot.threads.map((shell) =>
            shell.id === threadId
              ? {
                  ...shell,
                  status: "completed" as const,
                  activeRunId: null,
                  activityRunStatus: null,
                  updatedAt: DateTime.makeUnsafe(completedAt),
                }
              : shell,
          ),
        }));
        yield* Queue.offer(
          harness.domainEvents,
          storedEvent(8, {
            type: "run.updated",
            threadId,
            occurredAt: DateTime.formatIso(DateTime.makeUnsafe(completedAt)),
            payload: {},
          }),
        );

        yield* awaitAt(harness.clock.waitForScheduleAt(completedAt + HOUR_MS));
        harness.clock.advanceTo(completedAt + HOUR_MS - 1);
        assert.equal(harness.expiryCalls(), 0);
        harness.clock.advanceTo(completedAt + HOUR_MS);
        const command = yield* waitForExpiryCommand(harness);
        yield* Queue.take(harness.forkCompletions);
        if (command.type === "thread.sidechat.expire") {
          assert.equal(
            command.expectedLastActivityAt,
            DateTime.formatIso(DateTime.makeUnsafe(completedAt)),
          );
        }
      }),
    ),
  );

  it.effect("resumes expiry when background work ends without another run update", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("sidechat-background-finished");
        const harness = yield* makeHarness({
          shells: [
            makeSidechatShell(threadId, {
              pendingBackgroundTasks: [{ kind: "command", taskId: "background-command" }],
            }),
          ],
        });
        yield* harness.reactor.start();
        const completedAt = BASE_MS + 2 * HOUR_MS;
        harness.clock.advanceTo(completedAt);
        yield* Ref.update(harness.shellSnapshot, (snapshot) => ({
          ...snapshot,
          threads: snapshot.threads.map((shell) => ({
            ...shell,
            pendingBackgroundTasks: [],
            updatedAt: DateTime.makeUnsafe(completedAt),
          })),
        }));
        yield* Queue.offer(
          harness.domainEvents,
          storedEvent(8, {
            type: "turn-item.updated",
            threadId,
            payload: { type: "command_execution", status: "completed" },
          }),
        );
        yield* Queue.offer(
          harness.domainEvents,
          storedEvent(9, {
            type: "thread.visited",
            threadId: ThreadId.make("unrelated-thread"),
            payload: {},
          }),
        );
        yield* Queue.take(harness.eventsRead);
        assert.equal((yield* Queue.take(harness.eventsRead)).sequence, 9);
        assert.equal(harness.clock.activeTimerCount(), 1);
        harness.clock.advanceTo(completedAt + HOUR_MS);
        const command = yield* waitForExpiryCommand(harness);
        if (command.type === "thread.sidechat.expire")
          assert.equal(
            command.expectedLastActivityAt,
            DateTime.formatIso(DateTime.makeUnsafe(completedAt)),
          );
      }),
    ),
  );

  it.effect("backs off failed and no-op expiry attempts by five seconds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          nowMs: BASE_MS + HOUR_MS,
          shells: [makeSidechatShell("sidechat-retry")],
          expiryOutcomes: ["fail", "noop", "expire"],
        });
        yield* harness.reactor.start();
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + HOUR_MS));

        harness.clock.advanceTo(BASE_MS + HOUR_MS);
        yield* waitForExpiryCommand(harness);
        yield* Queue.take(harness.forkCompletions);
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + HOUR_MS + RETRY_MS));
        harness.clock.advanceTo(BASE_MS + HOUR_MS + RETRY_MS - 1);
        assert.equal(harness.expiryCalls(), 1);

        harness.clock.advanceTo(BASE_MS + HOUR_MS + RETRY_MS);
        yield* waitForExpiryCommand(harness);
        yield* Queue.take(harness.forkCompletions);
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + HOUR_MS + 2 * RETRY_MS));
        harness.clock.advanceTo(BASE_MS + HOUR_MS + 2 * RETRY_MS);
        yield* waitForExpiryCommand(harness);
        yield* Queue.take(harness.forkCompletions);

        assert.equal(harness.expiryCalls(), 3);
        assert.equal(harness.clock.activeTimerCount(), 0);
      }),
    ),
  );

  it.effect("does not retry a no-op expiry while the view lease is held", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const id = ThreadId.make("sidechat-held-view");
        const harness = yield* makeHarness({
          nowMs: BASE_MS + HOUR_MS,
          shells: [makeSidechatShell("sidechat-held-view")],
          expiryOutcomes: ["noop", "expire"],
        });
        yield* harness.reactor.start();
        yield* awaitAt(harness.clock.waitForScheduleAt(BASE_MS + HOUR_MS));
        yield* Ref.set(harness.viewedSidechatIds, [id]);

        harness.clock.advanceTo(BASE_MS + HOUR_MS);
        yield* waitForExpiryCommand(harness);
        yield* Queue.take(harness.forkCompletions);
        yield* waitForActivityCommand(harness);
        harness.clock.advanceTo(BASE_MS + HOUR_MS + 2 * RETRY_MS);

        assert.equal(harness.expiryCalls(), 1);
        assert.equal(harness.clock.activeTimerCount(), 0);
      }),
    ),
  );

  it.effect("cancels timers when the start scope is disposed", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.scoped(
        Effect.gen(function* () {
          const current = yield* makeHarness({ shells: [makeSidechatShell("sidechat-dispose")] });
          yield* current.reactor.start();
          assert.equal(current.clock.activeTimerCount(), 1);
          return current;
        }),
      );

      harness.clock.advanceTo(BASE_MS + 2 * HOUR_MS);
      assert.equal(harness.clock.activeTimerCount(), 0);
      assert.equal(harness.expiryCalls(), 0);
    }),
  );
});
