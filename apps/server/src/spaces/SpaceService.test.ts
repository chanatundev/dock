// Space vocabulary and lifecycle behavior adapted from Synara, revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  SPACES_MAX_COUNT,
  SpaceError,
  SpaceId,
  type ApplicationProjectEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { ensureDockSpacesSchema } from "../persistence/ensureDockSpacesSchema.ts";
import * as SpaceService from "./SpaceService.ts";

const layerSchemaDatabase = Layer.effectDiscard(ensureDockSpacesSchema()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layerTest = SpaceService.layer.pipe(
  Layer.provideMerge(ProjectStore.layer),
  Layer.provideMerge(layerSchemaDatabase),
);

const commandId = (id: string) => CommandId.make(`command:${id}`);
const spaceId = (id: string) => SpaceId.make(`space:${id}`);
const projectId = (id: string) => ProjectId.make(`project:${id}`);

const createSpace = (id: string, name: string, icon: "bag" | "rocket" | "star" = "bag") => ({
  type: "space.create" as const,
  commandId: commandId(`create-${id}`),
  spaceId: spaceId(id),
  name,
  icon,
});

const seedProject = Effect.fn("SpaceServiceTest.seedProject")(function* (
  projects: ProjectStore.ProjectStoreV2["Service"],
  id: ProjectId,
  title = "Space test project",
) {
  const createdAt = "2026-10-01T00:00:00.000Z";
  yield* projects.apply({
    sequence: 1,
    eventId: EventId.make(`project-created:${id}`),
    aggregateKind: "project",
    aggregateId: id,
    occurredAt: createdAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId: id,
      title,
      workspaceRoot: `/tmp/${id}`,
      defaultModelSelection: null,
      scripts: [],
      createdAt,
      updatedAt: createdAt,
    },
  } satisfies ApplicationProjectEvent);
});

const resetState = Effect.fn("SpaceServiceTest.resetState")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM dock_projection_project_spaces`;
  yield* sql`DELETE FROM dock_space_events`;
  yield* sql`DELETE FROM dock_space_command_receipts`;
  yield* sql`DELETE FROM dock_projection_spaces`;
  yield* sql`DELETE FROM sqlite_sequence WHERE name = 'dock_space_events'`;
  yield* sql`DELETE FROM projection_projects`;
  yield* sql`DELETE FROM orchestration_v2_projection_threads`;
});

const expectReason = <A>(effect: Effect.Effect<A, SpaceError>, reason: string) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(effect);
    assert.equal(error.reason, reason);
  });

it.layer(Layer.fresh(layerTest))("SpaceService", (it) => {
  it.effect(
    "creates and edits spaces, rejects reserved or duplicate names, and requires an exact reorder",
    () =>
      Effect.gen(function* () {
        yield* resetState();
        const service = yield* SpaceService.SpaceService;
        yield* TestClock.setTime(0);

        const first = yield* service.dispatch(createSpace("work", "  Work  "));
        const second = yield* service.dispatch(createSpace("side", "Side projects", "rocket"));
        assert.equal(first.sequence, 1);
        assert.equal(second.sequence, 2);
        assert.deepEqual(
          (yield* service.list).spaces.map(({ id, sortOrder }) => [id, sortOrder]),
          [
            [spaceId("work"), 0],
            [spaceId("side"), 1],
          ],
        );
        const createdSpace = (yield* service.list).spaces[0]!;

        yield* expectReason(
          service.dispatch({
            ...createSpace("duplicate", "  work  "),
            commandId: commandId("duplicate-name"),
          }),
          "duplicate-name",
        );
        yield* expectReason(
          service.dispatch({
            ...createSpace("reserved", "Void"),
            commandId: commandId("reserved-name"),
          }),
          "reserved-name",
        );
        yield* expectReason(
          service.dispatch({
            type: "space.meta.update",
            commandId: commandId("rename-to-void"),
            spaceId: spaceId("work"),
            name: "vOiD",
          }),
          "reserved-name",
        );
        yield* expectReason(
          service.dispatch({
            ...createSpace("reserved-id", "Custom"),
            commandId: commandId("reserved-id"),
            spaceId: SpaceId.make("void"),
          }),
          "reserved-name",
        );

        const updated = yield* service.dispatch({
          type: "space.meta.update",
          commandId: commandId("rename-work"),
          spaceId: spaceId("work"),
          name: "Projects",
          icon: "star",
        });
        const updatedSpace = (yield* service.list).spaces[0]!;
        assert.equal(updated.sequence, 3);
        assert.equal(updatedSpace.name, "Projects");
        assert.equal(updatedSpace.icon, "star");
        assert.isAbove(
          DateTime.toEpochMillis(DateTime.makeUnsafe(updatedSpace.updatedAt)),
          DateTime.toEpochMillis(DateTime.makeUnsafe(createdSpace.updatedAt)),
        );

        yield* expectReason(
          service.dispatch({
            type: "space.reorder",
            commandId: commandId("invalid-reorder"),
            orderedSpaceIds: [spaceId("work"), spaceId("work")],
          }),
          "invalid-order",
        );
        const reordered = yield* service.dispatch({
          type: "space.reorder",
          commandId: commandId("reorder"),
          orderedSpaceIds: [spaceId("side"), spaceId("work")],
        });
        assert.equal(reordered.sequence, 4);
        assert.deepEqual(
          (yield* service.list).spaces.map(({ id, sortOrder }) => [id, sortOrder]),
          [
            [spaceId("side"), 0],
            [spaceId("work"), 1],
          ],
        );
        assert.isAbove(updatedSpace.updatedAt.localeCompare("1970-01-01T00:00:00.000Z"), 0);
      }),
  );

  it.effect("keeps concurrent creation within the 50-space limit", () =>
    Effect.gen(function* () {
      yield* resetState();
      const service = yield* SpaceService.SpaceService;
      yield* Effect.forEach(
        Array.from({ length: SPACES_MAX_COUNT }, (_, index) =>
          createSpace(`limit-${index}`, `Space ${index}`),
        ),
        (command) => service.dispatch(command),
        { concurrency: "unbounded" },
      );
      assert.equal((yield* service.list).spaces.length, SPACES_MAX_COUNT);
      yield* expectReason(service.dispatch(createSpace("over-limit", "Over limit")), "limit");
    }),
  );

  it.effect("moves and unassigns one canonical membership per project", () =>
    Effect.gen(function* () {
      yield* resetState();
      const service = yield* SpaceService.SpaceService;
      const projects = yield* ProjectStore.ProjectStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const firstProject = projectId("membership-a");
      const secondProject = projectId("membership-b");
      yield* seedProject(projects, firstProject);
      yield* seedProject(projects, secondProject);
      yield* service.dispatch(createSpace("one", "One"));
      yield* service.dispatch(createSpace("two", "Two", "rocket"));

      yield* service.dispatch({
        type: "space.projects.assign",
        commandId: commandId("assign-first"),
        spaceId: spaceId("one"),
        projectIds: [firstProject, firstProject],
      });
      yield* service.dispatch({
        type: "space.projects.assign",
        commandId: commandId("move-and-assign"),
        spaceId: spaceId("two"),
        projectIds: [firstProject, secondProject],
      });
      assert.deepEqual(
        (yield* service.list).projectAssignments,
        [firstProject, secondProject].map((projectId) => ({ projectId, spaceId: spaceId("two") })),
      );

      yield* service.dispatch({
        type: "space.projects.assign",
        commandId: commandId("unassign"),
        spaceId: null,
        projectIds: [firstProject],
      });
      assert.deepEqual((yield* service.list).projectAssignments, [
        { projectId: secondProject, spaceId: spaceId("two") },
      ]);
      const memberships = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM dock_projection_project_spaces
      `;
      assert.equal(memberships[0]?.count, 1);
    }),
  );

  it.effect(
    "rolls an invalid assignment batch back and leaves projects and threads alone when deleting a space",
    () =>
      Effect.gen(function* () {
        yield* resetState();
        const service = yield* SpaceService.SpaceService;
        const projects = yield* ProjectStore.ProjectStoreV2;
        const sql = yield* SqlClient.SqlClient;
        const activeProject = projectId("delete-active");
        const deletedProject = projectId("delete-soft");
        yield* seedProject(projects, activeProject, "Active project");
        yield* seedProject(projects, deletedProject, "Soft deleted project");
        yield* service.dispatch(createSpace("delete", "Delete me"));
        const threadTime = "2026-10-02T00:00:00.000Z";
        yield* sql`
        INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
          created_at, updated_at, payload_json
        ) VALUES (
          'thread:space-delete', ${activeProject}, 'Preserved thread', 'codex',
          'full-access', 'default', ${threadTime}, ${threadTime}, '{"keep":true}'
        )
      `;
        yield* service.dispatch({
          type: "space.projects.assign",
          commandId: commandId("assign-delete-members"),
          spaceId: spaceId("delete"),
          projectIds: [activeProject, deletedProject],
        });
        const assigned = yield* service.list;
        yield* projects.apply({
          sequence: 2,
          eventId: EventId.make(`project-deleted:${deletedProject}`),
          aggregateKind: "project",
          aggregateId: deletedProject,
          occurredAt: "2026-10-03T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.deleted",
          payload: { projectId: deletedProject, deletedAt: "2026-10-03T00:00:00.000Z" },
        });

        const before = yield* service.list;
        assert.deepEqual(before, assigned);
        const hiddenMembership = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count
          FROM dock_projection_project_spaces WHERE project_id = ${deletedProject}
        `;
        assert.equal(hiddenMembership[0]?.count, 1);
        yield* expectReason(
          service.dispatch({
            type: "space.projects.assign",
            commandId: commandId("invalid-batch"),
            spaceId: null,
            projectIds: [activeProject, projectId("missing")],
          }),
          "project-not-found",
        );
        assert.deepEqual(yield* service.list, before);

        const beforeProjects = yield* sql<{
          readonly project_id: string;
          readonly title: string;
          readonly updated_at: string;
          readonly deleted_at: string | null;
        }>`
        SELECT project_id, title, updated_at, deleted_at FROM projection_projects ORDER BY project_id
      `;
        const beforeThread = yield* sql<{
          readonly thread_id: string;
          readonly title: string;
          readonly payload_json: string;
        }>`
        SELECT thread_id, title, payload_json
        FROM orchestration_v2_projection_threads WHERE thread_id = 'thread:space-delete'
      `;

        yield* service.dispatch({
          type: "space.delete",
          commandId: commandId("delete-space"),
          spaceId: spaceId("delete"),
        });

        const afterProjects = yield* sql<{
          readonly project_id: string;
          readonly title: string;
          readonly updated_at: string;
          readonly deleted_at: string | null;
        }>`
        SELECT project_id, title, updated_at, deleted_at FROM projection_projects ORDER BY project_id
      `;
        const afterThread = yield* sql<{
          readonly thread_id: string;
          readonly title: string;
          readonly payload_json: string;
        }>`
        SELECT thread_id, title, payload_json
        FROM orchestration_v2_projection_threads WHERE thread_id = 'thread:space-delete'
      `;
        assert.deepEqual(afterProjects, beforeProjects);
        assert.deepEqual(afterThread, beforeThread);
        assert.deepEqual((yield* service.list).projectAssignments, []);
        yield* expectReason(
          service.dispatch({
            ...createSpace("delete", "Reused identity"),
            commandId: commandId("reuse-deleted-id"),
          }),
          "duplicate-id",
        );
        const memberships = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM dock_projection_project_spaces
      `;
        assert.equal(memberships[0]?.count, 0);
      }),
  );

  it.effect("keeps no-op and repeated commands idempotent across service reacquisition", () =>
    Effect.gen(function* () {
      yield* resetState();
      const service = yield* SpaceService.SpaceService;
      const sql = yield* SqlClient.SqlClient;
      const original = createSpace("retry", "Retry");
      const created = yield* service.dispatch(original);
      const noOp = yield* service.dispatch({
        type: "space.meta.update",
        commandId: commandId("no-op"),
        spaceId: spaceId("retry"),
        name: "Retry",
        icon: "bag",
      });
      assert.equal(noOp.sequence, created.sequence);

      const reacquiredLayer = Layer.fresh(SpaceService.layer).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(SqlClient.SqlClient, sql),
            Layer.succeed(ProjectStore.ProjectStoreV2, yield* ProjectStore.ProjectStoreV2),
          ),
        ),
      );
      const reacquired = yield* Effect.service(SpaceService.SpaceService).pipe(
        Effect.provide(reacquiredLayer),
      );
      assert.deepEqual(yield* reacquired.dispatch(original), created);
      yield* expectReason(
        reacquired.dispatch({ ...original, name: "Different payload" }),
        "command-conflict",
      );
      const counts = yield* sql<{
        readonly events: number;
        readonly receipts: number;
      }>`
        SELECT
          (SELECT COUNT(*) FROM dock_space_events) AS events,
          (SELECT COUNT(*) FROM dock_space_command_receipts) AS receipts
      `;
      assert.deepEqual(counts[0], { events: 1, receipts: 2 });
    }),
  );

  it.effect(
    "subscribes before the snapshot and publishes concurrent deltas in sequence order",
    () =>
      Effect.gen(function* () {
        yield* resetState();
        const service = yield* SpaceService.SpaceService;
        let createdSequences: ReadonlyArray<number> = [];
        const items = yield* service.streamChanges.pipe(
          Stream.tap((item) =>
            item.kind === "snapshot"
              ? Effect.all(
                  [
                    service.dispatch(createSpace("stream-a", "Stream A")),
                    service.dispatch(createSpace("stream-b", "Stream B", "rocket")),
                  ],
                  { concurrency: "unbounded" },
                ).pipe(
                  Effect.tap((results) =>
                    Effect.sync(() => {
                      createdSequences = results.map((result) => result.sequence);
                    }),
                  ),
                  Effect.asVoid,
                )
              : Effect.void,
          ),
          Stream.take(3),
          Stream.runCollect,
        );
        assert.equal(items.length, 3);
        assert.equal(items[0]?.kind, "snapshot");
        if (items[0]?.kind !== "snapshot") return yield* Effect.die("Expected initial snapshot");
        assert.equal(items[0].snapshot.sequence, 0);
        const events = items.slice(1);
        assert.isTrue(events.every((item) => item.kind === "event"));
        if (!events.every((item) => item.kind === "event")) {
          return yield* Effect.die("Expected committed events");
        }
        const eventSequences = events.map((item) => item.event.sequence);
        assert.deepEqual(
          eventSequences,
          [...createdSequences].toSorted((left, right) => left - right),
        );
        assert.deepEqual(
          events.map((item) => item.event.change.type),
          ["space.created", "space.created"],
        );
      }),
  );
});

it.effect("ensures the fork schema repeatedly without changing the upstream migration ledger", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const before = yield* sql<{
      readonly migration_id: number;
      readonly name: string;
    }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
    yield* ensureDockSpacesSchema();
    yield* ensureDockSpacesSchema();
    const after = yield* sql<{
      readonly migration_id: number;
      readonly name: string;
    }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
    assert.deepEqual(after, before);
  }).pipe(Effect.provide(Layer.fresh(layerSchemaDatabase))),
);
