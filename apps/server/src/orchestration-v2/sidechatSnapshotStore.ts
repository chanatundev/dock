import {
  type OrchestrationV2SidechatSnapshot,
  OrchestrationV2SidechatSnapshotJson,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class SidechatSnapshotWriteError extends Schema.TaggedError<SidechatSnapshotWriteError>()(
  "SidechatSnapshotWriteError",
  {
    threadId: ThreadId,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to write sidechat snapshot for thread ${this.threadId}: ${this.reason}.`;
  }
}

export class SidechatSnapshotReadError extends Schema.TaggedError<SidechatSnapshotReadError>()(
  "SidechatSnapshotReadError",
  {
    threadId: ThreadId,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to read sidechat snapshot for thread ${this.threadId}: ${this.reason}.`;
  }
}

const encodeSnapshotPayload = Schema.encodeEffect(
  Schema.fromJsonString(OrchestrationV2SidechatSnapshotJson),
);

const decodeSnapshotPayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2SidechatSnapshotJson),
);

export const writeSidechatSnapshot = Effect.fn("writeSidechatSnapshot")(function* (
  threadId: ThreadId,
  snapshot: OrchestrationV2SidechatSnapshot,
) {
  const sql = yield* SqlClient.SqlClient;

  const payloadJson = yield* encodeSnapshotPayload(snapshot).pipe(
    Effect.mapError(
      (cause) =>
        new SidechatSnapshotWriteError({
          threadId,
          reason: "serialization",
          cause,
        }),
    ),
  );

  const existing = yield* sql<{ readonly payload_json: string }>`
    SELECT payload_json FROM dock_projection_sidechat_snapshots WHERE thread_id = ${threadId}
  `.pipe(
    Effect.mapError(
      (cause) =>
        new SidechatSnapshotWriteError({
          threadId,
          reason: "sql",
          cause,
        }),
    ),
  );

  if (existing.length > 0) {
    const existingRaw = existing[0]!.payload_json;
    if (existingRaw === payloadJson) {
      return;
    }

    const existingSnapshot = yield* decodeSnapshotPayload(existingRaw).pipe(
      Effect.mapError(
        (cause) =>
          new SidechatSnapshotWriteError({
            threadId,
            reason: "malformed",
            cause,
          }),
      ),
    );

    if (Equal.equals(existingSnapshot, snapshot)) {
      return;
    }

    return yield* Effect.fail(
      new SidechatSnapshotWriteError({
        threadId,
        reason: "conflict",
      }),
    );
  }

  yield* sql`
    INSERT INTO dock_projection_sidechat_snapshots (thread_id, payload_json)
    VALUES (${threadId}, ${payloadJson})
  `.pipe(
    Effect.mapError(
      (cause) =>
        new SidechatSnapshotWriteError({
          threadId,
          reason: "sql",
          cause,
        }),
    ),
  );
});

export const readSidechatSnapshot = Effect.fn("readSidechatSnapshot")(function* (
  threadId: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<{ readonly payload_json: string }>`
    SELECT payload_json FROM dock_projection_sidechat_snapshots WHERE thread_id = ${threadId}
  `.pipe(
    Effect.mapError(
      (cause) =>
        new SidechatSnapshotReadError({
          threadId,
          reason: "sql",
          cause,
        }),
    ),
  );

  if (rows.length === 0) {
    return null;
  }

  const snapshot = yield* decodeSnapshotPayload(rows[0]!.payload_json).pipe(
    Effect.mapError(
      (cause) =>
        new SidechatSnapshotReadError({
          threadId,
          reason: "malformed",
          cause,
        }),
    ),
  );

  return snapshot;
});
