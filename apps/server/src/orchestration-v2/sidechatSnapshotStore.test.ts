import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  type OrchestrationV2SidechatSnapshot,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { ensureDockSidechatSnapshotsSchema } from "../persistence/ensureDockSidechatSnapshotsSchema.ts";
import { readSidechatSnapshot, writeSidechatSnapshot } from "./sidechatSnapshotStore.ts";

const layerMemoryTest = Layer.effectDiscard(ensureDockSidechatSnapshotsSchema()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const makeSampleSnapshot = (overrides?: {
  readonly referenceText?: string;
  readonly partialText?: string;
  readonly streaming?: boolean;
  readonly status?: "running" | "completed";
}): OrchestrationV2SidechatSnapshot => {
  const started = DateTime.makeUnsafe("2026-10-26T12:00:00.000Z");
  const updated = DateTime.makeUnsafe("2026-10-26T12:00:05.000Z");
  return {
    source: {
      kind: "thread",
      threadId: ThreadId.make("parent-thread-alpha"),
      snapshotSequence: 42,
      capturedAt: "2026-10-26T12:00:00.000Z",
    },
    referenceText: overrides?.referenceText ?? "Frozen snapshot context",
    items: [
      {
        id: TurnItemId.make("turn-item-1"),
        threadId: ThreadId.make("parent-thread-alpha"),
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        title: null,
        type: "assistant_message",
        messageId: MessageId.make("msg-1"),
        text: overrides?.partialText ?? "Committed partial answer stream...",
        streaming: overrides?.streaming ?? true,
        status: overrides?.status ?? "running",
        startedAt: started,
        completedAt: null,
        updatedAt: updated,
      },
    ],
  };
};

describe("sidechatSnapshotStore", () => {
  it.effect(
    "ensureDockSidechatSnapshotsSchema is idempotent and does not modify the migration ledger",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // 1. Ensure table exists
        yield* ensureDockSidechatSnapshotsSchema();

        const tableRows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name = 'dock_projection_sidechat_snapshots'
      `;
        assert.equal(tableRows.length, 1);

        // Verify migration ledger count before 2nd ensure
        const ledgerBefore = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM effect_sql_migrations
      `;

        // 2. Ensure again (idempotent)
        yield* ensureDockSidechatSnapshotsSchema();

        // Verify migration ledger unchanged
        const ledgerAfter = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM effect_sql_migrations
      `;
        assert.equal(ledgerAfter[0]?.count, ledgerBefore[0]?.count);

        // Verify no extra indexes created (only primary key index)
        const indexRows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_schema
        WHERE type = 'index' AND tbl_name = 'dock_projection_sidechat_snapshots'
          AND name NOT LIKE 'sqlite_autoindex_%'
      `;
        assert.equal(indexRows.length, 0);
      }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect("returns null for non-existent sidechat snapshot", () =>
    Effect.gen(function* () {
      const result = yield* readSidechatSnapshot(ThreadId.make("missing-thread"));
      assert.isNull(result);
    }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect(
    "persists and roundtrips sidechat snapshot with active partial text, status, and timestamps",
    () =>
      Effect.gen(function* () {
        const sideThreadId = ThreadId.make("side-thread-roundtrip");
        const snapshot = makeSampleSnapshot();

        yield* writeSidechatSnapshot(sideThreadId, snapshot);

        const retrieved = yield* readSidechatSnapshot(sideThreadId);
        assert.isNotNull(retrieved);
        assert.deepEqual(retrieved, snapshot);
        assert.equal(retrieved?.items[0]?.type, "assistant_message");
        if (retrieved?.items[0]?.type === "assistant_message") {
          assert.equal(retrieved.items[0].streaming, true);
          assert.equal(retrieved.items[0].status, "running");
          assert.equal(retrieved.items[0].text, "Committed partial answer stream...");
          assert.deepEqual(
            retrieved.items[0].startedAt,
            DateTime.makeUnsafe("2026-10-26T12:00:00.000Z"),
          );
          assert.deepEqual(
            retrieved.items[0].updatedAt,
            DateTime.makeUnsafe("2026-10-26T12:00:05.000Z"),
          );
        }
      }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect(
    "persists snapshot independently without requiring parent thread metadata or existence in DB",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const sideThreadId = ThreadId.make("side-thread-no-parent");
        const snapshot = makeSampleSnapshot();

        // Verify parent thread does not exist anywhere in DB
        const parentRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM sqlite_schema
        WHERE type = 'table' AND name = 'projection_threads'
      `;
        if (parentRows.length > 0 && parentRows[0]!.count > 0) {
          const existingParent = yield* sql<{ readonly id: string }>`
          SELECT thread_id AS id FROM projection_threads WHERE thread_id = 'parent-thread-alpha'
        `;
          assert.equal(existingParent.length, 0);
        }

        // Storing sidechat snapshot must succeed purely with threadId and snapshot
        yield* writeSidechatSnapshot(sideThreadId, snapshot);

        const retrieved = yield* readSidechatSnapshot(sideThreadId);
        assert.isNotNull(retrieved);
        assert.deepEqual(retrieved, snapshot);
      }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect("allows replaying the same deep snapshot idempotently", () =>
    Effect.gen(function* () {
      const sideThreadId = ThreadId.make("side-thread-replay");
      const snapshot = makeSampleSnapshot();

      yield* writeSidechatSnapshot(sideThreadId, snapshot);

      // Replaying the exact same snapshot succeeds
      yield* writeSidechatSnapshot(sideThreadId, snapshot);

      const retrieved = yield* readSidechatSnapshot(sideThreadId);
      assert.deepEqual(retrieved, snapshot);
    }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect("accepts semantically identical restored JSON without overwriting it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const id = ThreadId.make("restored-snapshot");
      const snapshot = makeSampleSnapshot();
      yield* writeSidechatSnapshot(id, snapshot);
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM dock_projection_sidechat_snapshots WHERE thread_id=${id}`;
      const restored = JSON.stringify(JSON.parse(rows[0]!.payload_json), null, 2);
      yield* sql`UPDATE dock_projection_sidechat_snapshots SET payload_json=${restored} WHERE thread_id=${id}`;
      yield* writeSidechatSnapshot(id, snapshot);
      assert.equal(
        (yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM dock_projection_sidechat_snapshots WHERE thread_id=${id}`)[0]
          ?.payload_json,
        restored,
      );
    }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect(
    "rejects conflicting snapshot for the same thread with typed SidechatSnapshotWriteError and never overwrites",
    () =>
      Effect.gen(function* () {
        const sideThreadId = ThreadId.make("side-thread-immutable-conflict");
        const originalSnapshot = makeSampleSnapshot({ referenceText: "Original frozen context" });
        yield* writeSidechatSnapshot(sideThreadId, originalSnapshot);

        const conflictingSnapshot = makeSampleSnapshot({
          referenceText: "Tampered modified context",
          partialText: "Different text",
        });

        const error = yield* writeSidechatSnapshot(sideThreadId, conflictingSnapshot).pipe(
          Effect.flip,
        );

        assert.equal(error._tag, "SidechatSnapshotWriteError");
        assert.equal(error.threadId, sideThreadId);
        assert.equal(error.reason, "conflict");

        // Database content MUST remain unchanged (never overwritten)
        const persisted = yield* readSidechatSnapshot(sideThreadId);
        assert.deepEqual(persisted, originalSnapshot);
      }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect("fails with typed SidechatSnapshotReadError when persisted data is malformed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // 1. Invalid JSON
      const corruptedThreadId = ThreadId.make("corrupted-json-thread");
      yield* sql`
        INSERT INTO dock_projection_sidechat_snapshots (thread_id, payload_json)
        VALUES (${corruptedThreadId}, '{{not valid json}')
      `;

      const error1 = yield* readSidechatSnapshot(corruptedThreadId).pipe(Effect.flip);
      assert.equal(error1._tag, "SidechatSnapshotReadError");
      assert.equal(error1.threadId, corruptedThreadId);
      const replayError = yield* writeSidechatSnapshot(
        corruptedThreadId,
        makeSampleSnapshot(),
      ).pipe(Effect.flip);
      assert.equal(replayError._tag, "SidechatSnapshotWriteError");
      assert.equal(replayError.reason, "malformed");

      // 2. Valid JSON but violates schema
      const invalidSchemaThreadId = ThreadId.make("invalid-schema-thread");
      yield* sql`
        INSERT INTO dock_projection_sidechat_snapshots (thread_id, payload_json)
        VALUES (${invalidSchemaThreadId}, '{\"arbitrary\": \"object\", \"missing\": \"fields\"}')
      `;

      const error2 = yield* readSidechatSnapshot(invalidSchemaThreadId).pipe(Effect.flip);
      assert.equal(error2._tag, "SidechatSnapshotReadError");
      assert.equal(error2.threadId, invalidSchemaThreadId);
    }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect("participates in caller transaction and rolls back on transaction failure", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const sideThreadId = ThreadId.make("side-thread-rollback");
      const snapshot = makeSampleSnapshot();

      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* writeSidechatSnapshot(sideThreadId, snapshot);
            return yield* Effect.fail("simulated transaction failure");
          }),
        )
        .pipe(Effect.flip);

      // Verify the write was rolled back with the transaction
      const retrieved = yield* readSidechatSnapshot(sideThreadId);
      assert.isNull(retrieved);
    }).pipe(Effect.provide(layerMemoryTest)),
  );

  it.effect("persists snapshots across database reopen for durability", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "dock-sidechat-durability-" });
      const dbPath = path.join(tempDir, "sidechat-durability.sqlite");

      const sideThreadId = ThreadId.make("side-thread-durable");
      const snapshot = makeSampleSnapshot();

      // Session 1: Create table and write snapshot
      const layer1 = Layer.effectDiscard(ensureDockSidechatSnapshotsSchema()).pipe(
        Layer.provideMerge(
          SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer)),
        ),
      );
      yield* Effect.gen(function* () {
        yield* writeSidechatSnapshot(sideThreadId, snapshot);
      }).pipe(Effect.provide(layer1));

      // Session 2: Reopen database and read snapshot
      const layer2 = Layer.effectDiscard(ensureDockSidechatSnapshotsSchema()).pipe(
        Layer.provideMerge(
          SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer)),
        ),
      );
      const retrieved = yield* Effect.gen(function* () {
        return yield* readSidechatSnapshot(sideThreadId);
      }).pipe(Effect.provide(layer2));

      assert.isNotNull(retrieved);
      assert.deepEqual(retrieved, snapshot);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
