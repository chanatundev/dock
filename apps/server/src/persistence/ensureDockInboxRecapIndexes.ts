import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ensureDockInboxRecapIndexes = Effect.fn("ensureDockInboxRecapIndexes")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`CREATE INDEX IF NOT EXISTS dock_inbox_prompt_time_idx ON orchestration_events(occurred_at, stream_id, command_id)
      WHERE application_event_version=2 AND aggregate_kind='thread' AND event_type='message.updated'`;
      yield* sql`CREATE INDEX IF NOT EXISTS dock_inbox_run_time_idx ON orchestration_v2_projection_runs(requested_at, thread_id)`;
      yield* sql`CREATE INDEX IF NOT EXISTS dock_inbox_turn_end_idx ON orchestration_v2_projection_provider_turns(completed_at, thread_id)`;
      yield* sql`CREATE INDEX IF NOT EXISTS dock_inbox_running_turn_start_idx ON orchestration_v2_projection_provider_turns(started_at)
      WHERE status='running' AND completed_at IS NULL`;
    }),
  );
});
