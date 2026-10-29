import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  SpaceId,
  type Space,
  type SpaceChange,
  type SpacesSnapshot,
} from "@t3tools/contracts";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { applySpacesStreamItem, projectSpacesStream } from "./spaces.ts";

const timestamp = "2026-10-24T12:00:00.000Z";
const work: Space = {
  id: SpaceId.make("work"),
  name: "Work",
  icon: "bag",
  sortOrder: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const personal: Space = { ...work, id: SpaceId.make("personal"), name: "Personal", sortOrder: 1 };
const projectId = ProjectId.make("project");
const initial: SpacesSnapshot = {
  sequence: 2,
  spaces: [work, personal],
  projectAssignments: [{ projectId, spaceId: work.id }],
};
const event = (sequence: number, change: SpaceChange) => ({
  kind: "event" as const,
  event: {
    sequence,
    commandId: CommandId.make(`command-${sequence}`),
    occurredAt: timestamp,
    change,
  },
});

describe("Space stream projection", () => {
  it("keeps omitted cached Spaces deterministic when a reorder produces equal positions", () => {
    const cached = { ...initial, spaces: [work, { ...personal, sortOrder: 0 }] };
    const next = applySpacesStreamItem(
      cached,
      event(3, { type: "space.reordered", orderedSpaceIds: [work.id] }),
    );
    expect(next.spaces.map((space) => space.id)).toEqual([personal.id, work.id]);
  });

  it.effect("publishes no successful empty value before the first server snapshot", () =>
    Effect.gen(function* () {
      expect(yield* Stream.empty.pipe(projectSpacesStream, Stream.runCollect)).toEqual([]);
      expect(
        yield* Stream.make({ kind: "snapshot" as const, snapshot: initial }).pipe(
          projectSpacesStream,
          Stream.runCollect,
        ),
      ).toEqual([initial]);
    }),
  );
  it("moves and unassigns projects without creating duplicate memberships", () => {
    const moved = applySpacesStreamItem(
      initial,
      event(3, {
        type: "space.projects.assigned",
        spaceId: personal.id,
        projectIds: [projectId, projectId],
      }),
    );
    expect(moved.projectAssignments).toEqual([{ projectId, spaceId: personal.id }]);
    expect(
      applySpacesStreamItem(
        moved,
        event(4, { type: "space.projects.assigned", spaceId: null, projectIds: [projectId] }),
      ).projectAssignments,
    ).toEqual([]);
    expect(initial.projectAssignments).toEqual([{ projectId, spaceId: work.id }]);
  });

  it("returns a deleted Space's members to Void and preserves the other Spaces", () => {
    const next = applySpacesStreamItem(
      initial,
      event(3, { type: "space.deleted", spaceId: work.id }),
    );
    expect(next.spaces).toEqual([personal]);
    expect(next.projectAssignments).toEqual([]);
  });

  it("orders Spaces without duplicating them and ignores already applied deltas", () => {
    const reordered = applySpacesStreamItem(
      initial,
      event(3, { type: "space.reordered", orderedSpaceIds: [personal.id, work.id] }),
    );
    expect(reordered.spaces.map((space) => space.id)).toEqual([personal.id, work.id]);
    const renamed = applySpacesStreamItem(
      reordered,
      event(4, { type: "space.updated", space: { ...work, name: "Projects", sortOrder: 1 } }),
    );
    expect(renamed.spaces).toHaveLength(2);
    expect(
      applySpacesStreamItem(renamed, event(3, { type: "space.deleted", spaceId: work.id })),
    ).toBe(renamed);
  });

  it("replaces cached membership with the authoritative snapshot on reconnect", () => {
    const snapshot: SpacesSnapshot = { sequence: 9, spaces: [personal], projectAssignments: [] };
    expect(applySpacesStreamItem(initial, { kind: "snapshot", snapshot })).toBe(snapshot);
  });
});
