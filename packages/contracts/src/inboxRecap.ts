// Recap vocabulary adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const INBOX_RECAP_MAX_WINDOW_MS = 48 * 60 * 60 * 1_000;
const INBOX_RECAP_MAX_SLOT_BOUNDARIES = 24;
export const InboxRecapInput = Schema.Struct({
  from: IsoDateTime,
  to: IsoDateTime,
  slotBoundaries: Schema.Array(IsoDateTime).check(
    Schema.isMaxLength(INBOX_RECAP_MAX_SLOT_BOUNDARIES),
  ),
});
export type InboxRecapInput = typeof InboxRecapInput.Type;

export const InboxRecapTokens = Schema.Struct({
  user: NonNegativeInt,
  automation: NonNegativeInt,
  agent: NonNegativeInt,
});
export const InboxRecapSlot = Schema.Struct({
  from: IsoDateTime,
  to: IsoDateTime,
  prompts: NonNegativeInt,
  chats: NonNegativeInt,
  turns: NonNegativeInt,
  failedTurns: NonNegativeInt,
  agentWorkMs: NonNegativeInt,
  // Usage belongs to its report/completion instant; work spans can overlap a different slot.
  tokens: InboxRecapTokens,
  cacheReadTokens: NonNegativeInt,
  incompleteUsageTurns: NonNegativeInt,
});
export type InboxRecapSlot = typeof InboxRecapSlot.Type;
export const InboxRecap = Schema.Struct({
  generatedAt: IsoDateTime,
  totals: InboxRecapSlot,
  slots: Schema.Array(InboxRecapSlot),
  projects: Schema.Array(
    Schema.Struct({
      projectId: ProjectId,
      title: TrimmedNonEmptyString,
      prompts: NonNegativeInt,
      chats: NonNegativeInt,
      tokens: NonNegativeInt,
    }),
  ),
  models: Schema.Array(
    Schema.Struct({
      providerInstanceId: ProviderInstanceId,
      driver: ProviderDriverKind,
      model: TrimmedNonEmptyString,
      turns: NonNegativeInt,
      tokens: NonNegativeInt,
    }),
  ),
  unavailableProviders: Schema.Array(ProviderDriverKind),
});
export type InboxRecap = typeof InboxRecap.Type;
export class InboxRecapError extends Schema.TaggedError<InboxRecapError>()("InboxRecapError", {
  reason: Schema.Literals(["invalid-window", "persistence"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason === "invalid-window"
      ? "Choose an Inbox recap window of at most 48 hours with ordered slot boundaries inside it."
      : "The environment could not read its Inbox recap.";
  }
}
