import type { SpacesSnapshot, SpacesStreamItem } from "@t3tools/contracts";
import * as Stream from "effect/Stream";

export function projectSpacesStream<E, R>(stream: Stream.Stream<SpacesStreamItem, E, R>) {
  return stream.pipe(
    Stream.scan(
      (): SpacesSnapshot => ({ sequence: 0, spaces: [], projectAssignments: [] }),
      applySpacesStreamItem,
    ),
    // The seed is not a server snapshot and cannot resolve a restored selection.
    Stream.drop(1),
  );
}

export function applySpacesStreamItem(
  current: SpacesSnapshot,
  item: SpacesStreamItem,
): SpacesSnapshot {
  if (item.kind === "snapshot") return item.snapshot;
  const { event } = item;
  if (event.sequence <= current.sequence) return current;
  const { change } = event;
  switch (change.type) {
    case "space.created":
    case "space.updated": {
      const spaces = current.spaces.filter((space) => space.id !== change.space.id);
      spaces.push(change.space);
      spaces.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
      return { ...current, sequence: event.sequence, spaces };
    }
    case "space.reordered": {
      const order = new Map(change.orderedSpaceIds.map((id, index) => [id, index]));
      const spaces = current.spaces
        .map((space) => ({
          ...space,
          sortOrder: order.get(space.id) ?? space.sortOrder,
          updatedAt: event.occurredAt,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
      return { ...current, sequence: event.sequence, spaces };
    }
    case "space.deleted":
      return {
        ...current,
        sequence: event.sequence,
        spaces: current.spaces.filter((space) => space.id !== change.spaceId),
        projectAssignments: current.projectAssignments.filter(
          (item) => item.spaceId !== change.spaceId,
        ),
      };
    case "space.projects.assigned": {
      const moved = new Set(change.projectIds);
      const projectAssignments = current.projectAssignments.filter(
        (item) => !moved.has(item.projectId),
      );
      if (change.spaceId !== null) {
        for (const projectId of moved)
          projectAssignments.push({ projectId, spaceId: change.spaceId });
      }
      return { ...current, sequence: event.sequence, projectAssignments };
    }
  }
}
