import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ensureDockTasksSchema = Effect.fn("ensureDockTasksSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS dock_task_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          command_id TEXT NOT NULL UNIQUE,
          task_id TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          event_json TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS dock_task_events_task_sequence_idx
        ON dock_task_events(task_id, sequence DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS dock_task_projection (
          task_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          task_json TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS dock_task_projection_created_idx
        ON dock_task_projection(created_at, task_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS dock_task_command_receipts (
          command_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          sequence INTEGER NOT NULL
        )
      `;
    }),
  );
});
