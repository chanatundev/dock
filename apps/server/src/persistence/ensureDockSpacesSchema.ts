// Space persistence schema adapted from Synara, revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ensureDockSpacesSchema = Effect.fn("ensureDockSpacesSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS dock_space_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          command_id TEXT NOT NULL UNIQUE,
          occurred_at TEXT NOT NULL,
          change_json TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS dock_space_command_receipts (
          command_id TEXT PRIMARY KEY,
          command_json TEXT NOT NULL,
          sequence INTEGER NOT NULL
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS dock_projection_spaces (
          space_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL,
          icon TEXT NOT NULL,
          sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS dock_projection_spaces_active_name_idx
        ON dock_projection_spaces(name_key)
        WHERE deleted_at IS NULL
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS dock_projection_spaces_active_order_idx
        ON dock_projection_spaces(sort_order, space_id)
        WHERE deleted_at IS NULL
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS dock_projection_project_spaces (
          project_id TEXT PRIMARY KEY,
          space_id TEXT NOT NULL REFERENCES dock_projection_spaces(space_id)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS dock_projection_project_spaces_space_idx
        ON dock_projection_project_spaces(space_id, project_id)
      `;
    }),
  );
});
