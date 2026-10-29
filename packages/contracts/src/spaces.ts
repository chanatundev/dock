// Space vocabulary and limits adapted from Synara, revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const SpaceId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("SpaceId"),
);
export type SpaceId = typeof SpaceId.Type;
export const SPACE_NAME_MAX_LENGTH = 32;
export const SPACES_MAX_COUNT = 50;
export const SPACE_PROJECTS_ASSIGN_MAX_COUNT = 200;
export const SpaceName = TrimmedNonEmptyString.check(Schema.isMaxLength(SPACE_NAME_MAX_LENGTH));
export const SpaceIcon = Schema.Literals([
  "bag",
  "home",
  "code-brackets",
  "rocket",
  "light-bulb",
  "color-palette",
  "book",
  "lab",
  "heart",
  "star",
  "globe",
  "cloud",
  "hammer",
  "chart-2",
  "gamecontroller",
  "camera-1",
  "target",
  "tree",
  "school",
  "backpack",
]);

export const Space = Schema.Struct({
  id: SpaceId,
  name: SpaceName,
  icon: SpaceIcon,
  sortOrder: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Space = typeof Space.Type;

export const SpaceProjectAssignment = Schema.Struct({ projectId: ProjectId, spaceId: SpaceId });
export type SpaceProjectAssignment = typeof SpaceProjectAssignment.Type;

export const SpacesSnapshot = Schema.Struct({
  sequence: NonNegativeInt,
  spaces: Schema.Array(Space),
  projectAssignments: Schema.Array(SpaceProjectAssignment),
});
export type SpacesSnapshot = typeof SpacesSnapshot.Type;

export const SpaceCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("space.create"),
    commandId: CommandId,
    spaceId: SpaceId,
    name: SpaceName,
    icon: SpaceIcon,
  }),
  Schema.Struct({
    type: Schema.Literal("space.meta.update"),
    commandId: CommandId,
    spaceId: SpaceId,
    name: Schema.optional(SpaceName),
    icon: Schema.optional(SpaceIcon),
  }),
  Schema.Struct({
    type: Schema.Literal("space.reorder"),
    commandId: CommandId,
    orderedSpaceIds: Schema.Array(SpaceId).check(Schema.isMaxLength(SPACES_MAX_COUNT)),
  }),
  Schema.Struct({ type: Schema.Literal("space.delete"), commandId: CommandId, spaceId: SpaceId }),
  Schema.Struct({
    type: Schema.Literal("space.projects.assign"),
    commandId: CommandId,
    // Null removes membership; Void has no persisted identity.
    spaceId: Schema.NullOr(SpaceId),
    projectIds: Schema.Array(ProjectId).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(SPACE_PROJECTS_ASSIGN_MAX_COUNT),
    ),
  }),
]);
export type SpaceCommand = typeof SpaceCommand.Type;

export const SpaceChange = Schema.Union([
  Schema.Struct({ type: Schema.Literal("space.created"), space: Space }),
  Schema.Struct({ type: Schema.Literal("space.updated"), space: Space }),
  Schema.Struct({
    type: Schema.Literal("space.reordered"),
    orderedSpaceIds: Schema.Array(SpaceId),
  }),
  Schema.Struct({ type: Schema.Literal("space.deleted"), spaceId: SpaceId }),
  Schema.Struct({
    type: Schema.Literal("space.projects.assigned"),
    spaceId: Schema.NullOr(SpaceId),
    projectIds: Schema.Array(ProjectId),
  }),
]);
export type SpaceChange = typeof SpaceChange.Type;

export const SpaceEvent = Schema.Struct({
  sequence: NonNegativeInt,
  commandId: CommandId,
  occurredAt: IsoDateTime,
  change: SpaceChange,
});
export type SpaceEvent = typeof SpaceEvent.Type;
export const SpacesStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: SpacesSnapshot }),
  Schema.Struct({ kind: Schema.Literal("event"), event: SpaceEvent }),
]);
export type SpacesStreamItem = typeof SpacesStreamItem.Type;
export const SpaceMutationResult = Schema.Struct({ sequence: NonNegativeInt });
export type SpaceMutationResult = typeof SpaceMutationResult.Type;

export class SpaceError extends Schema.TaggedError<SpaceError>()("SpaceError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "not-found",
    "project-not-found",
    "duplicate-id",
    "duplicate-name",
    "reserved-name",
    "limit",
    "invalid-order",
    "command-conflict",
    "persistence",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return "This Space no longer exists.";
      case "project-not-found":
        return "A selected project no longer exists in this environment.";
      case "duplicate-id":
        return "This Space identity has already been used.";
      case "duplicate-name":
        return "A Space with this name already exists.";
      case "reserved-name":
        return "Void is reserved for projects without a Space.";
      case "limit":
        return this.operation === "space.projects.assign"
          ? `A Space assignment batch can contain at most ${SPACE_PROJECTS_ASSIGN_MAX_COUNT} projects.`
          : `An environment can have at most ${SPACES_MAX_COUNT} Spaces.`;
      case "invalid-order":
        return "Space order must include every active Space exactly once.";
      case "command-conflict":
        return "This command identity was already used for a different Space change.";
      case "persistence":
        return "The Space operation could not be saved or read.";
    }
  }
}
