import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ensureDockSidechatSnapshotsSchema = Effect.fn("ensureDockSidechatSnapshotsSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
        CREATE TABLE IF NOT EXISTS dock_projection_sidechat_snapshots (
          thread_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL
        )
      `;
      }),
    );
  },
);
