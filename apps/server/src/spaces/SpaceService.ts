// Space lifecycle behavior adapted from Synara, revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import {
  SPACE_PROJECTS_ASSIGN_MAX_COUNT,
  SPACES_MAX_COUNT,
  Space as SpaceSchema,
  SpaceError,
  SpaceChange as SpaceChangeSchema,
  type SpaceChange,
  type SpaceCommand,
  type SpaceId,
  SpaceCommand as SpaceCommandSchema,
  SpacesSnapshot as SpacesSnapshotSchema,
  type SpaceEvent,
  type SpaceMutationResult,
  type SpacesSnapshot,
  type SpacesStreamItem,
} from "@t3tools/contracts";
import * as NodeUtil from "node:util";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

const StoredSpaceCommand = Schema.fromJsonString(SpaceCommandSchema);
const StoredSpaceChange = Schema.fromJsonString(SpaceChangeSchema);
const decodeIncomingSpaceCommand = Schema.decodeUnknownEffect(SpaceCommandSchema);
const encodeSpaceCommand = Schema.encodeEffect(StoredSpaceCommand);
const decodeStoredSpaceCommand = Schema.decodeUnknownEffect(StoredSpaceCommand);
const encodeSpaceChange = Schema.encodeEffect(StoredSpaceChange);
const decodeSpace = Schema.decodeUnknownEffect(SpaceSchema);
const decodeSpacesSnapshot = Schema.decodeUnknownEffect(SpacesSnapshotSchema);
const isSpaceError = Schema.is(SpaceError);

export class SpaceService extends Context.Service<
  SpaceService,
  {
    readonly list: Effect.Effect<SpacesSnapshot, SpaceError>;
    readonly dispatch: (command: SpaceCommand) => Effect.Effect<SpaceMutationResult, SpaceError>;
    readonly streamChanges: Stream.Stream<SpacesStreamItem, SpaceError>;
  }
>()("t3/spaces/SpaceService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const dispatchLock = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<SpaceEvent>();

  const mapPersistenceError = (operation: string) => (cause: unknown) =>
    isSpaceError(cause) ? cause : new SpaceError({ operation, reason: "persistence", cause });

  const readSnapshot = Effect.fn("SpaceService.readSnapshot")(function* () {
    const sequenceRows = yield* sql<{ readonly sequence: number }>`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM dock_space_events
    `;
    const spaceRows = yield* sql<{
      readonly spaceId: SpaceId;
      readonly name: string;
      readonly icon: string;
      readonly sortOrder: number;
      readonly createdAt: string;
      readonly updatedAt: string;
    }>`
      SELECT
        space_id AS "spaceId",
        name,
        icon,
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM dock_projection_spaces
      WHERE deleted_at IS NULL
      ORDER BY sort_order ASC, space_id ASC
    `;
    // Membership history is independent of project visibility. Clients join the
    // authoritative project shell so reconnects and live deltas agree.
    const assignmentRows = yield* sql<{
      readonly projectId: string;
      readonly spaceId: string;
    }>`
      SELECT membership.project_id AS "projectId", membership.space_id AS "spaceId"
      FROM dock_projection_project_spaces AS membership
      INNER JOIN dock_projection_spaces AS space
        ON space.space_id = membership.space_id AND space.deleted_at IS NULL
      ORDER BY membership.project_id ASC
    `;
    const spaces = yield* Effect.forEach(spaceRows, (row) =>
      decodeSpace({
        id: row.spaceId,
        name: row.name,
        icon: row.icon,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    );
    return yield* decodeSpacesSnapshot({
      sequence: sequenceRows[0]?.sequence ?? 0,
      spaces,
      projectAssignments: assignmentRows,
    });
  });

  const list: SpaceService["Service"]["list"] = sql
    .withTransaction(readSnapshot())
    .pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(mapPersistenceError("list")),
      Effect.withSpan("SpaceService.list"),
    );

  // These SQL helpers run within the enclosing dispatch span.
  const nextTimestamp = Effect.fnUntraced(function* (minimum?: string) {
    const latestRows = yield* sql<{ readonly occurredAt: string | null }>`
      SELECT occurred_at AS "occurredAt"
      FROM dock_space_events
      ORDER BY sequence DESC
      LIMIT 1
    `;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const previous = [latestRows[0]?.occurredAt, minimum]
      .filter((value): value is string => value !== undefined && value !== null)
      .reduce(
        (latest, value) => Math.max(latest, DateTime.toEpochMillis(DateTime.makeUnsafe(value))),
        -1,
      );
    return DateTime.formatIso(DateTime.makeUnsafe(Math.max(now, previous + 1)));
  });

  const activeSpaceRows = Effect.fnUntraced(function* () {
    return yield* sql<{ readonly spaceId: SpaceId; readonly sortOrder: number }>`
      SELECT space_id AS "spaceId", sort_order AS "sortOrder"
      FROM dock_projection_spaces
      WHERE deleted_at IS NULL
      ORDER BY sort_order ASC, space_id ASC
    `;
  });

  const requireActiveSpace = Effect.fnUntraced(function* (spaceId: SpaceId, operation: string) {
    const rows = yield* sql<{
      readonly spaceId: SpaceId;
      readonly name: string;
      readonly icon: string;
      readonly sortOrder: number;
      readonly createdAt: string;
      readonly updatedAt: string;
    }>`
      SELECT
        space_id AS "spaceId",
        name,
        icon,
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM dock_projection_spaces
      WHERE space_id = ${spaceId} AND deleted_at IS NULL
    `;
    const row = rows[0];
    if (row === undefined) return yield* new SpaceError({ operation, reason: "not-found" });
    return yield* decodeSpace({
      id: row.spaceId,
      name: row.name,
      icon: row.icon,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });

  const currentSequence = Effect.fnUntraced(function* () {
    const rows = yield* sql<{ readonly sequence: number }>`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM dock_space_events
    `;
    return rows[0]?.sequence ?? 0;
  });

  const recordReceipt = Effect.fnUntraced(function* (
    command: SpaceCommand,
    sequence: number,
    commandJson: string,
  ) {
    yield* sql`
      INSERT INTO dock_space_command_receipts (command_id, command_json, sequence)
      VALUES (${command.commandId}, ${commandJson}, ${sequence})
    `;
  });

  const dispatch: SpaceService["Service"]["dispatch"] = Effect.fn("SpaceService.dispatch")(
    function* (input: SpaceCommand) {
      return yield* dispatchLock
        .withPermits(1)(
          Effect.gen(function* () {
            const command = yield* decodeIncomingSpaceCommand(input);
            const commandJson = yield* encodeSpaceCommand(command);
            const committed = yield* sql.withTransaction(
              Effect.gen(function* () {
                const priorReceipts = yield* sql<{
                  readonly commandJson: string;
                  readonly sequence: number;
                }>`
              SELECT command_json AS "commandJson", sequence
              FROM dock_space_command_receipts
              WHERE command_id = ${command.commandId}
            `;
                const priorReceipt = priorReceipts[0];
                if (priorReceipt !== undefined) {
                  const storedCommand = yield* decodeStoredSpaceCommand(priorReceipt.commandJson);
                  if (!NodeUtil.isDeepStrictEqual(storedCommand, command)) {
                    return yield* new SpaceError({
                      operation: command.type,
                      reason: "command-conflict",
                    });
                  }
                  return { result: { sequence: priorReceipt.sequence }, event: undefined };
                }

                let change: SpaceChange | undefined;
                let changeOccurredAt: string | undefined;
                switch (command.type) {
                  case "space.create": {
                    if (
                      command.spaceId.toLowerCase() === "void" ||
                      command.name.trim().toLowerCase() === "void"
                    ) {
                      return yield* new SpaceError({
                        operation: command.type,
                        reason: "reserved-name",
                      });
                    }
                    const usedIds = yield* sql<{ readonly found: number }>`
                  SELECT 1 AS found FROM dock_projection_spaces WHERE space_id = ${command.spaceId}
                `;
                    if (usedIds.length > 0) {
                      return yield* new SpaceError({
                        operation: command.type,
                        reason: "duplicate-id",
                      });
                    }
                    const nameKey = command.name.toLowerCase();
                    const matchingNames = yield* sql<{ readonly found: number }>`
                  SELECT 1 AS found
                  FROM dock_projection_spaces
                  WHERE name_key = ${nameKey} AND deleted_at IS NULL
                `;
                    if (matchingNames.length > 0) {
                      return yield* new SpaceError({
                        operation: command.type,
                        reason: "duplicate-name",
                      });
                    }
                    const counts = yield* sql<{ readonly count: number }>`
                  SELECT COUNT(*) AS count FROM dock_projection_spaces WHERE deleted_at IS NULL
                `;
                    if ((counts[0]?.count ?? 0) >= SPACES_MAX_COUNT) {
                      return yield* new SpaceError({ operation: command.type, reason: "limit" });
                    }
                    const sortRows = yield* sql<{ readonly sortOrder: number | null }>`
                  SELECT MAX(sort_order) AS "sortOrder"
                  FROM dock_projection_spaces WHERE deleted_at IS NULL
                `;
                    const occurredAt = yield* nextTimestamp();
                    changeOccurredAt = occurredAt;
                    const space = yield* decodeSpace({
                      id: command.spaceId,
                      name: command.name,
                      icon: command.icon,
                      sortOrder: (sortRows[0]?.sortOrder ?? -1) + 1,
                      createdAt: occurredAt,
                      updatedAt: occurredAt,
                    });
                    yield* sql`
                  INSERT INTO dock_projection_spaces (
                    space_id, name, name_key, icon, sort_order, created_at, updated_at, deleted_at
                  ) VALUES (
                    ${space.id}, ${space.name}, ${nameKey}, ${space.icon}, ${space.sortOrder},
                    ${space.createdAt}, ${space.updatedAt}, NULL
                  )
                `;
                    change = { type: "space.created", space };
                    break;
                  }
                  case "space.meta.update": {
                    const existing = yield* requireActiveSpace(command.spaceId, command.type);
                    const name =
                      command.name !== undefined && command.name !== existing.name
                        ? command.name
                        : undefined;
                    const icon =
                      command.icon !== undefined && command.icon !== existing.icon
                        ? command.icon
                        : undefined;
                    if (name === undefined && icon === undefined) break;
                    if (name?.trim().toLowerCase() === "void") {
                      return yield* new SpaceError({
                        operation: command.type,
                        reason: "reserved-name",
                      });
                    }
                    if (name !== undefined) {
                      const matchingNames = yield* sql<{ readonly found: number }>`
                    SELECT 1 AS found
                    FROM dock_projection_spaces
                    WHERE name_key = ${name.toLowerCase()}
                      AND deleted_at IS NULL AND space_id <> ${command.spaceId}
                  `;
                      if (matchingNames.length > 0) {
                        return yield* new SpaceError({
                          operation: command.type,
                          reason: "duplicate-name",
                        });
                      }
                    }
                    const occurredAt = yield* nextTimestamp(existing.updatedAt);
                    changeOccurredAt = occurredAt;
                    const updated = yield* decodeSpace({
                      ...existing,
                      ...(name === undefined ? {} : { name }),
                      ...(icon === undefined ? {} : { icon }),
                      updatedAt: occurredAt,
                    });
                    yield* sql`
                  UPDATE dock_projection_spaces
                  SET name = ${updated.name}, name_key = ${updated.name.toLowerCase()},
                    icon = ${updated.icon}, updated_at = ${updated.updatedAt}
                  WHERE space_id = ${updated.id} AND deleted_at IS NULL
                `;
                    change = { type: "space.updated", space: updated };
                    break;
                  }
                  case "space.reorder": {
                    const activeSpaces = yield* activeSpaceRows();
                    const activeIds = activeSpaces.map((space) => space.spaceId);
                    const orderedIds = command.orderedSpaceIds;
                    if (
                      orderedIds.length !== activeIds.length ||
                      new Set(orderedIds).size !== activeIds.length ||
                      activeIds.some((id) => !orderedIds.includes(id))
                    ) {
                      return yield* new SpaceError({
                        operation: command.type,
                        reason: "invalid-order",
                      });
                    }
                    if (activeIds.every((id, index) => id === orderedIds[index])) break;
                    const updatedRows = yield* sql<{ readonly updatedAt: string | null }>`
                  SELECT MAX(updated_at) AS "updatedAt"
                  FROM dock_projection_spaces WHERE deleted_at IS NULL
                `;
                    const latestUpdatedAt = updatedRows[0]?.updatedAt ?? undefined;
                    const occurredAt = yield* nextTimestamp(latestUpdatedAt);
                    changeOccurredAt = occurredAt;
                    for (const [sortOrder, id] of orderedIds.entries()) {
                      yield* sql`
                    UPDATE dock_projection_spaces
                    SET sort_order = ${sortOrder}, updated_at = ${occurredAt}
                    WHERE space_id = ${id} AND deleted_at IS NULL
                  `;
                    }
                    change = { type: "space.reordered", orderedSpaceIds: orderedIds };
                    break;
                  }
                  case "space.delete": {
                    const existing = yield* requireActiveSpace(command.spaceId, command.type);
                    const occurredAt = yield* nextTimestamp(existing.updatedAt);
                    changeOccurredAt = occurredAt;
                    yield* sql`DELETE FROM dock_projection_project_spaces WHERE space_id = ${command.spaceId}`;
                    yield* sql`
                  UPDATE dock_projection_spaces SET deleted_at = ${occurredAt}
                  WHERE space_id = ${command.spaceId} AND deleted_at IS NULL
                `;
                    change = { type: "space.deleted", spaceId: command.spaceId };
                    break;
                  }
                  case "space.projects.assign": {
                    if (command.spaceId !== null)
                      yield* requireActiveSpace(command.spaceId, command.type);
                    if (command.projectIds.length > SPACE_PROJECTS_ASSIGN_MAX_COUNT) {
                      return yield* new SpaceError({ operation: command.type, reason: "limit" });
                    }
                    const uniqueProjectIds = [...new Set(command.projectIds)];
                    const existingMemberships = new Map<string, string>();
                    for (const id of uniqueProjectIds) {
                      const project = yield* projects.get(id, { includeDeleted: true });
                      if (Option.isNone(project) || project.value.deletedAt !== null) {
                        return yield* new SpaceError({
                          operation: command.type,
                          reason: "project-not-found",
                        });
                      }
                      const memberships = yield* sql<{ readonly spaceId: string }>`
                    SELECT space_id AS "spaceId"
                    FROM dock_projection_project_spaces WHERE project_id = ${id}
                  `;
                      if (memberships[0] !== undefined) {
                        existingMemberships.set(id, memberships[0].spaceId);
                      }
                    }
                    const changedIds = uniqueProjectIds.filter(
                      (id) =>
                        existingMemberships.get(id) !== command.spaceId &&
                        !(command.spaceId === null && !existingMemberships.has(id)),
                    );
                    if (changedIds.length === 0) break;
                    for (const id of changedIds) {
                      if (command.spaceId === null) {
                        yield* sql`DELETE FROM dock_projection_project_spaces WHERE project_id = ${id}`;
                      } else {
                        yield* sql`
                      INSERT INTO dock_projection_project_spaces (project_id, space_id)
                      VALUES (${id}, ${command.spaceId})
                      ON CONFLICT (project_id) DO UPDATE SET space_id = excluded.space_id
                    `;
                      }
                    }
                    changeOccurredAt = yield* nextTimestamp();
                    change = {
                      type: "space.projects.assigned",
                      spaceId: command.spaceId,
                      projectIds: changedIds,
                    };
                    break;
                  }
                }

                if (change === undefined) {
                  const sequence = yield* currentSequence();
                  yield* recordReceipt(command, sequence, commandJson);
                  return { result: { sequence }, event: undefined };
                }

                const occurredAt = changeOccurredAt ?? (yield* nextTimestamp());
                const changeJson = yield* encodeSpaceChange(change);
                const eventRows = yield* sql<{ readonly sequence: number }>`
              INSERT INTO dock_space_events (command_id, occurred_at, change_json)
              VALUES (${command.commandId}, ${occurredAt}, ${changeJson})
              RETURNING sequence
            `;
                const sequence = eventRows[0]?.sequence;
                if (sequence === undefined) {
                  return yield* new SpaceError({ operation: command.type, reason: "persistence" });
                }
                const event: SpaceEvent = {
                  sequence,
                  commandId: command.commandId,
                  occurredAt,
                  change,
                };
                yield* recordReceipt(command, sequence, commandJson);
                return { result: { sequence }, event };
              }),
            );
            if (committed.event !== undefined) yield* PubSub.publish(changes, committed.event);
            return committed.result;
          }).pipe(
            // Once admitted, commit and publication must finish together even
            // if the requesting connection disappears.
            Effect.uninterruptible,
          ),
        )
        .pipe(Effect.mapError(mapPersistenceError("dispatch")));
    },
  );

  const streamChanges: SpaceService["Service"]["streamChanges"] = Stream.callback((mailbox) =>
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const snapshot = yield* list;
      let lastSequence = snapshot.sequence;
      Queue.offerUnsafe(mailbox, { kind: "snapshot", snapshot });
      yield* Stream.fromSubscription(subscription).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.sequence <= lastSequence) return;
            lastSequence = event.sequence;
            Queue.offerUnsafe(mailbox, { kind: "event", event });
          }),
        ),
        Effect.forkScoped,
      );
    }),
  );

  return SpaceService.of({ list, dispatch, streamChanges });
});

export const layer = Layer.effect(SpaceService, make);
